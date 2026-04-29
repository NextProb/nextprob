#!/usr/bin/env node
'use strict';

// Builds the export template .app skeleton from export-app-template/.
// Usage: node scripts/build-export-template.js
//
// Requires: npm install --save-dev @electron/packager
// Output:   export-app-template/dist/ExportedNote-darwin-arm64/ExportedNote.app

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(ROOT, 'export-app-template');
const DIST_DIR = path.join(TEMPLATE_DIR, 'dist');

async function main() {
  // 1. Install dependencies in the template (just better-sqlite3)
  console.log('Installing template dependencies...');
  execSync('npm install --production', { cwd: TEMPLATE_DIR, stdio: 'inherit' });

  // 2. Copy note-viewer.css into the template
  console.log('Copying note-viewer.css...');
  fs.copyFileSync(
    path.join(ROOT, 'note-viewer.css'),
    path.join(TEMPLATE_DIR, 'note-viewer.css')
  );

  // 3. Rebuild better-sqlite3 for the target Electron version
  const electronPkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')
  );
  const electronVersion = electronPkg.version;
  console.log(`Rebuilding native modules for Electron ${electronVersion}...`);
  execSync(
    `npx @electron/rebuild --module-dir "${TEMPLATE_DIR}" --electron-version ${electronVersion} --arch arm64`,
    { cwd: ROOT, stdio: 'inherit' }
  );

  // 4. Package with @electron/packager
  console.log('Packaging template app...');

  // Clean previous output
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }

  // Use electron-packager (dynamically imported or required)
  let packager;
  try {
    packager = require('@electron/packager');
  } catch {
    console.error('@electron/packager not found. Install it:\n  npm install --save-dev @electron/packager');
    process.exit(1);
  }

  const appPaths = await packager({
    dir: TEMPLATE_DIR,
    out: DIST_DIR,
    name: 'ExportedNote',
    platform: 'darwin',
    arch: 'arm64',
    electronVersion,
    overwrite: true,
    // Don't package dist/ or any leftover files
    ignore: [/^\/dist/, /\.tmp$/],
    // Prune dev dependencies from the packaged output
    prune: true,
  });

  console.log(`\nTemplate built at: ${appPaths[0]}`);
  console.log('This skeleton will be used by the "Export as Standalone App" feature.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
