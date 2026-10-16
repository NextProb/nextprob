'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { pipeline } = require('stream/promises');

// Templates and skills travel in one content-repository archive. URL resolution
// is lazy so offline and fixture callers need no private auth configuration.
async function downloadContentFolders({ url, timeoutMs = 15000 } = {}) {
  const archiveUrl = url || require('../main/content-urls').templatesTarballUrl;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextprob-content-'));
  try {
    const archivePath = path.join(tmpDir, 'repo.tar.gz');
    async function download(target, redirects = 0) {
      if (redirects > 5) throw new Error('Too many redirects');
      const parsed = new URL(target);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported content URL');
      const transport = parsed.protocol === 'https:' ? require('https') : require('http');
      const response = await new Promise((resolve, reject) => {
        const request = transport.get(parsed, { headers: { 'User-Agent': 'NextProb' }, timeout: timeoutMs }, resolve);
        request.on('error', reject);
        request.on('timeout', () => request.destroy(new Error('Content download timed out')));
      });
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        return download(new URL(response.headers.location, parsed).href, redirects + 1);
      }
      if (response.statusCode !== 200) {
        response.resume();
        throw new Error(`HTTP ${response.statusCode}`);
      }
      await pipeline(response, fs.createWriteStream(archivePath));
    }
    await download(archiveUrl);

    // Reject archive paths escaping the temporary directory before extraction.
    const names = execFileSync('tar', ['tzf', archivePath], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split('\n');
    if (!names.length || names.some(name => !name || name.startsWith('/') || name.includes('\\') || /^[A-Za-z]:/.test(name)
      || name.split('/').includes('..'))) throw new Error('Unsafe content archive path');
    execFileSync('tar', ['xzf', archivePath, '-C', tmpDir]);
    const roots = fs.readdirSync(tmpDir).filter(name => name !== 'repo.tar.gz');
    if (roots.length !== 1 || !fs.lstatSync(path.join(tmpDir, roots[0])).isDirectory()) throw new Error('Expected one content repository directory');
    const repoRoot = path.join(tmpDir, roots[0]);
    function directory(name) {
      const target = path.join(repoRoot, name);
      try { return fs.lstatSync(target).isDirectory() ? target : null; } catch { return null; }
    }
    const result = { tmpDir, templatesDir: directory('templates'), componentTemplatesDir: directory('component-templates'), skillsDir: directory('skills'), settingsDir: directory('settings') };
    if (!result.templatesDir && !result.skillsDir && !result.settingsDir) throw new Error('No supported content in archive');
    return result;
  } catch (error) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.warn(`[remote-content] ${error.message}`);
    return null;
  }
}

module.exports = { downloadContentFolders };
