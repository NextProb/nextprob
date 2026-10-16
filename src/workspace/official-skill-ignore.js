'use strict';
const fs = require('fs');
const path = require('path');
const { getManagedSkillPaths } = require('./official-skills');

const START = '# NextProb managed skills (auto-updated)';
const END = '# /NextProb managed skills';

// Keep our exclusions separate from user rules. When an installed skill is
// edited or replaced, its generated exclusion is removed on the next open.
function syncSkillGitignore(workspacePath) {
  try {
    const root = fs.realpathSync(workspacePath);
    if (!fs.existsSync(path.join(root, '.git'))) return;
    const target = path.join(root, '.gitignore');
    let previous = '';
    try {
      if (fs.lstatSync(target).isSymbolicLink()) return;
      previous = fs.readFileSync(target, 'utf8');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const lines = previous.split(/\r?\n/);
    const start = lines.indexOf(START);
    const end = lines.indexOf(END);
    if (start !== -1 && end > start) lines.splice(start, end - start + 1);
    // An incomplete block is user content; never guess which lines to replace.
    if ((start !== -1 || end !== -1) && !(end > start && start !== -1)) return;
    const newline = previous.includes('\r\n') ? '\r\n' : '\n';
    let next = lines.join(newline);
    const managed = getManagedSkillPaths(root);
    if (managed.length) {
      if (next && !next.endsWith(newline)) next += newline;
      next += [START, ...managed.map(relative => `/${relative}/`), END, ''].join(newline);
    }
    if (next !== previous) fs.writeFileSync(target, next, 'utf8');
  } catch (error) { console.warn('[official-skills] Could not update Git exclusions:', error.message); }
}

module.exports = { syncSkillGitignore };
