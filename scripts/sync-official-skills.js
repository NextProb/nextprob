#!/usr/bin/env node
'use strict';

// Import resource-owned display defaults, then refresh generated config assets and the app's offline
// snapshot together. Builds use --check and need no sibling repository/network.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const { installOfficialSkills } = require('../src/workspace/official-skills');
const { validateCatalog, validateSchema } = require('../src/project-settings/service');
const { readSettingsPackage } = require('../src/project-settings/cache');
const appVersion = require('../package.json').version;
const root = path.join(__dirname, '..');
const bundled = path.join(root, 'bundled-skills');
const settings = path.join(root, 'src', 'project-settings');
const SETTINGS_FILES = ['catalog.json', 'catalog.schema.json', 'project-config.schema.json', 'note-exclusions.json'];
function uiResources(directory) {
  const resources = [...readSettingsPackage(directory)].filter(([relative]) => relative.startsWith('ui/'));
  assert.ok(resources.some(([relative]) => relative === 'ui/manifest.json'), 'Settings content must include a UI manifest');
  return resources;
}
const schema = fs.readFileSync(path.join(root, 'src', 'project-config', 'schema.json'), 'utf8');
const argument = process.argv[2];
const defaultsPath = argument && argument !== '--check'
  ? path.resolve(argument, '../settings/project-config.default.json')
  : path.join(bundled, 'nextprob/assets/project-config.default.json');
if (!argument) {
  console.error('Usage: node scripts/sync-official-skills.js <content-repo>/skills | --check');
  process.exit(1);
}
const DEFAULT_CONFIG = JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));
const defaults = JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n';
function validate(directory) {
  const assets = path.join(directory, 'nextprob', 'assets');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(assets, 'project-config.default.json'), 'utf8')), DEFAULT_CONFIG, 'Skill defaults differ from resource defaults');
  assert.deepEqual(require('../src/project-config/service').validateConfig(DEFAULT_CONFIG), [], 'Resource defaults must work in the runtime');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(assets, 'project-config.schema.json'), 'utf8')), JSON.parse(schema), 'Skill schema differs from the app');
  for (const file of SETTINGS_FILES) {
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(assets, 'project-settings', file), 'utf8')),
      JSON.parse(fs.readFileSync(path.join(settings, file), 'utf8')), `Skill settings resource differs from the app: ${file}`);
  }
  for (const [relative, content] of uiResources(settings)) {
    assert.equal(fs.readFileSync(path.join(assets, 'project-settings', relative), 'utf8'), content,
      `Portable settings UI differs from the app snapshot: ${relative}`);
  }
  const catalog = JSON.parse(fs.readFileSync(path.join(settings, 'catalog.json'), 'utf8'));
  assert.ok(Number.isSafeInteger(catalog.revision) && catalog.revision > 0, 'Shipped catalogs require a publication revision');
  assert.ok(catalog.minAppVersion, 'Shipped catalogs declare app compatibility');
  assert.deepEqual(validateCatalog(catalog), [], 'Settings catalog must satisfy the engine contract');
  assert.deepEqual(validateSchema(catalog, JSON.parse(fs.readFileSync(path.join(settings, 'catalog.schema.json'), 'utf8'))), [], 'Settings catalog must satisfy its published schema');
  for (const definition of catalog.definitions) {
    if (definition.schema) {
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(assets, 'project-settings', definition.schema), 'utf8')),
        JSON.parse(fs.readFileSync(path.join(settings, definition.schema), 'utf8')), `Skill settings schema differs from the app: ${definition.schema}`);
    }
    if (definition.format === 'json') {
      const template = JSON.parse(definition.creation.initialText);
      if (definition.schema) assert.deepEqual(validateSchema(template, JSON.parse(fs.readFileSync(path.join(settings, definition.schema), 'utf8'))), [], `Invalid creation template: ${definition.id}`);
    }
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(settings, 'project-config.schema.json'), 'utf8')), JSON.parse(schema), 'Settings schema differs from the app');
  const demo = path.join(assets, 'settings-demo');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(demo, 'schemas/nextprob-config.schema.json'), 'utf8')), JSON.parse(schema), 'Demo schema differs from the app');
  const demoDefinitions = JSON.parse(fs.readFileSync(path.join(demo, 'nextprob.settings.json'), 'utf8'));
  assert.deepEqual(demoDefinitions.definitions.map(d => ({...d,...(d.schema ? {schema: d.schema.replace(/^schemas\//,'')} : {})})), catalog.definitions, 'Portable demo must cover every built-in resource');
  assert.deepEqual(demoDefinitions.pages, catalog.pages, 'Portable demo must use the built-in pages');
  assert.deepEqual(demoDefinitions.agents, catalog.agents, 'Portable demo must use the built-in agent profiles');
  assert.deepEqual(validateCatalog(demoDefinitions), [], 'Demo layout must satisfy the engine contract');
  assert.deepEqual(validateSchema(demoDefinitions, JSON.parse(fs.readFileSync(path.join(settings, 'catalog.schema.json'), 'utf8'))), [], 'Demo layout must satisfy its published schema');
  assert.deepEqual(require('../src/project-config/service').validateConfig(JSON.parse(fs.readFileSync(path.join(demo, 'nextprob.config.json'), 'utf8'))), [], 'Demo config must work in the runtime');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'nextprob-skill-check-'));
  try {
    assert.equal(require('../src/project-settings/cache').selectCatalog(path.join(fixture,'app-data'),{bundledDirectory:settings,appVersion}),path.join(settings,'catalog.json'), 'Bundled catalog must be compatible with this application');
    const demoProject = path.join(fixture, 'demo');
    fs.cpSync(demo,demoProject,{recursive:true});
    const demoService = require('../src/project-settings/service').createProjectSettingsService(demoProject);
    const demoCatalog = demoService.list();
    assert.deepEqual(demoCatalog.diagnostics, [], 'Portable demo must load without diagnostics');
    assert.ok(demoCatalog.resources.some(r=>r.kind==='package' && r.name==='review-notes'), 'Portable demo must include the custom skill example');
    for (const file of ['AGENTS.md','CLAUDE.md','.syncignore','.gitignore','.editorconfig']) assert.ok(demoCatalog.resources.some(r=>r.path===file && r.exists), `Demo resource must exist: ${file}`);
    demoService.stop();
    const result = installOfficialSkills(fixture, directory, { appVersion });
    assert.equal(result.skipped.length, 0, 'Skill package must be valid and compatible');
    assert.ok(result.installed.includes('.agents/skills/nextprob') && result.installed.includes('.claude/skills/nextprob'), 'NextProb skill must install in both native locations');
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
}
if (argument === '--check') {
  validate(bundled);
  // A release checkout can build offline without the content repository. When
  // the maintained source is present, also catch edits not synced into mirrors.
  const maintainedSettings = path.resolve(root, '../hs-update-model-list/settings');
  if (fs.existsSync(maintainedSettings)) {
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(maintainedSettings, 'project-config.default.json'), 'utf8')), DEFAULT_CONFIG, 'Unsynced resource-owned project defaults');
    const maintained = readSettingsPackage(maintainedSettings);
    const snapshot = readSettingsPackage(settings);
    assert.deepEqual([...snapshot.keys()].sort(), [...maintained.keys()].sort(), 'Settings snapshot resources differ from maintained content');
    for (const [relative, content] of maintained) assert.equal(snapshot.get(relative), content, `Unsynced maintained settings resource: ${relative}`);
    for (const relative of SETTINGS_FILES) assert.equal(fs.readFileSync(path.join(settings, relative), 'utf8'),
      fs.readFileSync(path.join(maintainedSettings, relative), 'utf8'), `Unsynced maintained settings resource: ${relative}`);
  }
  console.log('Official skills, settings catalog, and HTML interface snapshots are valid and synchronized.');
} else {
  const source = path.resolve(argument);
  if (!fs.existsSync(path.join(source, 'manifest.json'))) throw new Error('Missing source skills manifest');
  const assets = path.join(source, 'nextprob', 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, 'project-config.default.json'), defaults);
  fs.writeFileSync(path.join(assets, 'project-config.schema.json'), schema);
  fs.mkdirSync(path.join(assets, 'settings-demo', 'schemas'), { recursive: true });
  fs.writeFileSync(path.join(assets, 'settings-demo', 'schemas', 'nextprob-config.schema.json'), schema);
  const canonicalSettings = path.join(path.dirname(source), 'settings');
  if (!fs.existsSync(path.join(canonicalSettings, 'catalog.json'))) throw new Error('Missing content repository settings catalog');
  const catalog = JSON.parse(fs.readFileSync(path.join(canonicalSettings, 'catalog.json'), 'utf8'));
  // The form's default section rows mirror the same resource-owned config.
  const sectionList = catalog.definitions.find(definition => definition.id === 'project-display')
    ?.ui?.layout?.find(entry => JSON.stringify(entry.path) === JSON.stringify(['surfaces', 'sidebar', 'sections']));
  if (sectionList) {
    sectionList.default = DEFAULT_CONFIG.surfaces.sidebar.sections;
    fs.writeFileSync(path.join(canonicalSettings, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  }
  assert.deepEqual(validateCatalog(catalog), [], 'Content settings catalog must satisfy the engine contract');
  fs.writeFileSync(path.join(canonicalSettings, 'project-config.schema.json'), schema);
  const skillSettings = path.join(assets, 'project-settings');
  const maintainedUI = uiResources(canonicalSettings);
  fs.mkdirSync(skillSettings, { recursive: true });
  fs.mkdirSync(settings, { recursive: true });
  for (const file of SETTINGS_FILES) {
    fs.copyFileSync(path.join(canonicalSettings, file), path.join(settings, file));
    fs.copyFileSync(path.join(canonicalSettings, file), path.join(skillSettings, file));
  }
  for (const destination of [settings, skillSettings]) {
    fs.rmSync(path.join(destination, 'ui'), { recursive: true, force: true });
    for (const [relative, content] of maintainedUI) {
      fs.mkdirSync(path.dirname(path.join(destination, relative)), { recursive: true });
      fs.writeFileSync(path.join(destination, relative), content);
    }
  }
  // Schema resources referenced by newly added definitions are content, too.
  for (const definition of catalog.definitions) {
    if (!definition.schema || SETTINGS_FILES.includes(definition.schema)) continue;
    const relative = definition.schema;
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe settings schema path');
    for (const destination of [settings, skillSettings]) {
      fs.mkdirSync(path.dirname(path.join(destination, relative)), { recursive: true });
      fs.copyFileSync(path.join(canonicalSettings, relative), path.join(destination, relative));
    }
  }
  const demo = path.join(assets, 'settings-demo');
  fs.writeFileSync(path.join(demo,'nextprob.settings.json'),JSON.stringify({...catalog,definitions:catalog.definitions.map(d=>({...d,...(d.schema ? {schema:`schemas/${d.schema}`} : {})}))},null,2)+'\n');
  for (const relative of new Set(catalog.definitions.flatMap(d=>d.schema ? [d.schema] : []))) {
    fs.mkdirSync(path.dirname(path.join(demo,'schemas',relative)),{recursive:true});
    fs.copyFileSync(path.join(canonicalSettings,relative),path.join(demo,'schemas',relative));
  }
  assert.deepEqual(require('../src/project-config/service').validateConfig(DEFAULT_CONFIG), [], 'Resource defaults must work in the runtime');
  validate(source);
  const staged = fs.mkdtempSync(path.join(root, '.bundled-skills-'));
  try {
    fs.cpSync(source, staged, { recursive: true });
    validate(staged);
    fs.rmSync(bundled, { recursive: true, force: true });
    fs.renameSync(staged, bundled);
  } finally { fs.rmSync(staged, { recursive: true, force: true }); }
  console.log('Refreshed official config assets, settings catalog, and bundled skill snapshot.');
}
