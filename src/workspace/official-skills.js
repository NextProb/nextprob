'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TARGETS = ['.agents/skills', '.claude/skills'];
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const APP_VERSION = /^\d+\.\d+\.\d+$/;

function exists(file) {
  try { fs.lstatSync(file); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

// Inspect every ancestor as well as the final path; never follow a linked parent.
function safePath(file) {
  const absolute = path.resolve(file);
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (exists(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Symlink in skill path: ${current}`);
    }
  }
  return absolute;
}

function inventory(dir) {
  safePath(dir);
  if (!fs.lstatSync(dir).isDirectory()) throw new Error('Skill must be a directory');
  const files = {};
  const directories = [];
  function visit(current, prefix) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Skill resources cannot contain symlinks');
      if (entry.isDirectory()) {
        directories.push(relative);
        visit(absolute, relative);
      } else if (entry.isFile()) {
        files[relative] = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
      } else throw new Error('Unsupported skill resource');
    }
  }
  visit(dir, '');
  return { files, directories: directories.sort() };
}

function sameInventory(a, b) {
  return a && JSON.stringify(a) === JSON.stringify(b);
}

function checkSkill(dir, name) {
  const content = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!frontmatter) throw new Error('Missing SKILL.md frontmatter');
  // A portable, deliberately small frontmatter format: single-line scalar values.
  const values = {};
  for (const line of frontmatter[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = /^([a-z][a-z-]*):\s*(.*?)\s*$/.exec(line);
    if (!match || Object.hasOwn(values, match[1])) throw new Error('Unsupported skill frontmatter');
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  if (values.name !== name || !values.description || /^[>|]/.test(values.description)) throw new Error('Invalid skill name or description');
}

function compatible(info, appVersion, configVersion) {
  const current = appVersion.split('.').map(Number);
  const minimum = info.minAppVersion.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (current[i] !== minimum[i]) return current[i] > minimum[i] && info.configVersion === configVersion;
  }
  return info.configVersion === configVersion;
}

function readManifest(sourceDir) {
  safePath(sourceDir);
  const manifestPath = safePath(path.join(sourceDir, 'manifest.json'));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.formatVersion !== 1 || !manifest.skills || Array.isArray(manifest.skills) || typeof manifest.skills !== 'object') throw new Error('Invalid skills manifest');
  for (const [name, info] of Object.entries(manifest.skills)) {
    if (!NAME.test(name) || name.length > 64 || !info || !Number.isSafeInteger(info.version) || info.version < 1 || !APP_VERSION.test(info.minAppVersion || '') || !Number.isSafeInteger(info.configVersion) || info.configVersion < 1) throw new Error('Invalid skill manifest entry');
  }
  return manifest;
}

/** Install compatible official skills into native agent folders, preserving user content. */
function installOfficialSkills(workspacePath, sourceDir, { appVersion = '0.3.1', configVersion = 1 } = {}) {
  const result = { installed: [], updated: [], skipped: [] };
  let manifest;
  let state;
  let statePath;
  try {
    if (!APP_VERSION.test(appVersion) || !Number.isSafeInteger(configVersion)) throw new Error('Invalid compatibility options');
    // Allow platform aliases (for example macOS /var) and an intentionally
    // opened workspace alias; managed children must still be real directories.
    workspacePath = fs.realpathSync(workspacePath);
    sourceDir = path.join(fs.realpathSync(path.dirname(path.resolve(sourceDir))), path.basename(path.resolve(sourceDir)));
    manifest = readManifest(sourceDir);
    safePath(workspacePath);
    if (!fs.lstatSync(workspacePath).isDirectory()) throw new Error('Workspace must exist');
    statePath = safePath(path.join(workspacePath, '.notes-app', 'official-skills.json'));
    state = exists(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { formatVersion: 1, destinations: {} };
    if (state.formatVersion !== 1 || !state.destinations || Array.isArray(state.destinations) || typeof state.destinations !== 'object') throw new Error('Invalid official skill ownership metadata');
  } catch (error) {
    console.warn('[official-skills]', error.message);
    return result;
  }

  for (const [name, info] of Object.entries(manifest.skills)) {
    let sourceInventory;
    const src = path.join(sourceDir, name);
    try {
      if (!compatible(info, appVersion, configVersion)) throw new Error('Incompatible skill');
      sourceInventory = inventory(src);
      checkSkill(src, name);
    } catch {
      result.skipped.push(...TARGETS.map(target => `${target}/${name}`));
      continue;
    }
    for (const target of TARGETS) {
      const relative = `${target}/${name}`;
      const dest = path.join(workspacePath, relative);
      let stage;
      let backup;
      let tempState;
      let replaced = false;
      let committed = false;
      let record;
      try {
        safePath(dest);
        safePath(statePath);
        record = state.destinations[relative];
        const present = exists(dest);
        if (record && (!Number.isSafeInteger(record.version) || !record.inventory)) throw new Error('Invalid destination metadata');
        if (record && info.version < record.version) throw new Error('Older skill');
        if (present && (!record || !sameInventory(record.inventory, inventory(dest)))) throw new Error('User-owned or modified skill');
        if (present && record.version === info.version) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        const token = crypto.randomBytes(8).toString('hex');
        // Keep staging and backups outside skills/* so native discovery never
        // sees a partial package or a temporary duplicate skill.
        const agentRoot = path.dirname(path.dirname(dest));
        stage = path.join(agentRoot, `.nextprob-stage-${token}`);
        backup = path.join(agentRoot, `.nextprob-backup-${token}`);
        tempState = `${statePath}.stage-${token}`;
        fs.mkdirSync(stage);
        for (const directory of sourceInventory.directories) fs.mkdirSync(path.join(stage, directory), { recursive: true });
        for (const file of Object.keys(sourceInventory.files)) fs.copyFileSync(path.join(src, file), path.join(stage, file));
        if (!sameInventory(sourceInventory, inventory(stage))) throw new Error('Skill source changed during installation');
        if (present) fs.renameSync(dest, backup);
        fs.renameSync(stage, dest);
        replaced = true;
        state.destinations[relative] = { version: info.version, inventory: sourceInventory };
        fs.writeFileSync(tempState, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' });
        fs.renameSync(tempState, statePath);
        committed = true;
        result[record ? 'updated' : 'installed'].push(relative);
      } catch {
        if (record) state.destinations[relative] = record;
        else delete state.destinations[relative];
        try {
          if (replaced) fs.rmSync(dest, { recursive: true, force: true });
          if (backup && exists(backup)) fs.renameSync(backup, dest);
        } catch (error) {
          // Retain the backup if recovery itself fails; never delete user data.
          console.warn('[official-skills] Could not restore skill backup:', error.message);
        }
        result.skipped.push(relative);
      } finally {
        for (const temporary of [stage, tempState, ...(committed ? [backup] : [])]) {
          if (!temporary) continue;
          try { fs.rmSync(temporary, { recursive: true, force: true }); } catch (error) {
            console.warn('[official-skills] Could not remove staging file:', error.message);
          }
        }
      }
    }
  }
  return result;
}

/** Return untouched app-owned skill folders eligible for generated ignores. */
function getManagedSkillPaths(workspacePath) {
  let root;
  let state;
  try {
    root = fs.realpathSync(workspacePath);
    const statePath = safePath(path.join(root, '.notes-app', 'official-skills.json'));
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (state.formatVersion !== 1 || !state.destinations || Array.isArray(state.destinations)
      || typeof state.destinations !== 'object') return [];
  } catch { return []; }
  const managed = [];
  for (const [relative, record] of Object.entries(state.destinations)) {
    const match = /^(\.agents|\.claude)\/skills\/([^/]+)$/.exec(relative);
    if (!match || !NAME.test(match[2]) || match[2].length > 64 || !record
      || !Number.isSafeInteger(record.version) || record.version < 1 || !record.inventory) continue;
    try {
      if (sameInventory(record.inventory, inventory(path.join(root, relative)))) managed.push(relative);
    } catch { /* A missing or unsafe folder is not eligible for app-managed ignores. */ }
  }
  return managed.sort();
}

module.exports = { installOfficialSkills, getManagedSkillPaths };

// Inspect packages without exposing their internal files as settings entries.
// Only identical complete inventories are combined by the presentation layer.
function inspectSkillPackages(workspacePath, relativeRoot, marker = 'SKILL.md') {
  const root = fs.realpathSync(workspacePath);
  const directory = safePath(path.join(root, relativeRoot));
  const managed = new Set(getManagedSkillPaths(root));
  let ownership = {};
  try {
    const state = JSON.parse(fs.readFileSync(safePath(path.join(root,'.notes-app/official-skills.json')), 'utf8'));
    if (state.formatVersion === 1) ownership = state.destinations || {};
  } catch { /* Custom packages have no application ownership record. */ }
  const result = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes:true}).slice(0, 1000)) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const relative = `${relativeRoot}/${entry.name}`;
    try {
      const file = safePath(path.join(directory,entry.name,marker));
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > 1024 * 1024) continue;
      const text = fs.readFileSync(file,'utf8');
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] || '';
      const scalar = key => {
        const value = new RegExp(`^${key}:\\s*(.+)$`,'m').exec(frontmatter)?.[1]?.trim() || '';
        return value.replace(/^(["'])(.*)\1$/, '$2');
      };
      let fingerprint = relative;
      try {
        let bytes = 0, count = 0;
        const hash = crypto.createHash('sha256');
        const walk = (dir, base = '', depth = 0) => {
          if (depth > 12) throw new Error('Package too deep');
          for (const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
            if (++count > 500 || e.isSymbolicLink()) throw new Error('Package inventory limit');
            const name = `${base}/${e.name}`, p = path.join(dir,e.name); hash.update(JSON.stringify([name,e.isDirectory()?'directory':'file',e.isFile()?fs.statSync(p).size:0]));
            if (e.isDirectory()) walk(p,name,depth+1);
            else if (e.isFile()) { bytes += fs.statSync(p).size; if (bytes > 4*1024*1024) throw new Error('Package too large'); hash.update(fs.readFileSync(p)); }
          }
        };
        walk(path.dirname(file)); fingerprint = hash.digest('hex');
      } catch { /* Keep large, linked, or otherwise uncomparable copies separate. */ }
      const record = Object.hasOwn(ownership,relative) ? ownership[relative] : null;
      result.push({path:relative,marker:`${relative}/${marker}`,name:scalar('name') || entry.name,
        description:scalar('description'),fingerprint,status:managed.has(relative) ? 'managed' : record ? 'modified' : 'custom',version:Number.isSafeInteger(record?.version) ? record.version : undefined});
    } catch { /* Missing/linked/invalid packages are not settings packages. */ }
  }
  return result;
}
module.exports.inspectSkillPackages = inspectSkillPackages;
