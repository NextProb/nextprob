'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { addSharedNoteStyle } = require('./share-note-style');
const { buildCatalog } = require('../project-model/catalog');
const { publicationMetadata } = require('../project-model/metadata');

// --- Inline Note as Single HTML (shared helper) ---

const _INLINE_MIME_MAP = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function inlineNoteAsHtml(noteFolderPath, noteCss) {
  const indexPath = path.join(noteFolderPath, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');

  let noteTitle = path.basename(noteFolderPath);
  try {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (match) noteTitle = match[1].trim();
  } catch {}

  function resolveAsset(ref) {
    const decoded = decodeURIComponent(ref.split('?')[0].split('#')[0]);
    const abs = path.resolve(noteFolderPath, decoded);
    if (!abs.startsWith(noteFolderPath + path.sep) && abs !== noteFolderPath) return null;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return abs;
  }

  function toDataUri(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.css') return null;
    const mime = _INLINE_MIME_MAP[ext];
    if (!mime) return null;
    const buf = fs.readFileSync(filePath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  }

  function inlineCssFile(cssPath, visited) {
    if (!visited) visited = new Set();
    if (visited.has(cssPath)) return '';
    visited.add(cssPath);
    let css = fs.readFileSync(cssPath, 'utf8');
    const cssDir = path.dirname(cssPath);
    css = css.replace(/@import\s+(?:url\()?['"]?([^'");\s]+)['"]?\)?[^;]*;/g, (_m, ref) => {
      const abs = path.resolve(cssDir, decodeURIComponent(ref.split('?')[0].split('#')[0]));
      if (!abs.startsWith(noteFolderPath) || !fs.existsSync(abs)) return '';
      return inlineCssFile(abs, visited);
    });
    css = css.replace(/url\(\s*['"]?(?!data:)([^'")]+)['"]?\s*\)/g, (_m, ref) => {
      const abs = path.resolve(cssDir, decodeURIComponent(ref.split('?')[0].split('#')[0]));
      if (!abs.startsWith(noteFolderPath) || !fs.existsSync(abs)) return _m;
      const ext = path.extname(abs).toLowerCase();
      const mime = _INLINE_MIME_MAP[ext];
      if (!mime) return _m;
      const b64 = fs.readFileSync(abs).toString('base64');
      return `url(data:${mime};base64,${b64})`;
    });
    return css;
  }

  function inlineCssUrls(css) {
    return css.replace(/url\(\s*['"]?(?!data:)([^'")]+)['"]?\s*\)/g, (_u, ref) => {
      if (/^https?:\/\//.test(ref)) return _u;
      const abs = resolveAsset(ref);
      if (!abs) return _u;
      const ext = path.extname(abs).toLowerCase();
      const mime = _INLINE_MIME_MAP[ext];
      if (!mime) return _u;
      const b64 = fs.readFileSync(abs).toString('base64');
      return `url(data:${mime};base64,${b64})`;
    });
  }

  // Inline <link rel="stylesheet"> → <style>
  html = html.replace(/<link\s[^>]*rel=["']stylesheet["'][^>]*>/gi, (tag) => {
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) return tag;
    const ref = hrefMatch[1];
    if (/^https?:\/\//.test(ref)) return tag;
    const abs = resolveAsset(ref);
    if (!abs) return tag;
    return `<style>/* inlined: ${ref} */\n${inlineCssFile(abs)}\n</style>`;
  });

  // Inline <script src="..."> → <script>
  html = html.replace(/<script\s[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (_tag, ref) => {
    if (/^https?:\/\//.test(ref)) return _tag;
    const abs = resolveAsset(ref);
    if (!abs) return _tag;
    return `<script>/* inlined: ${ref} */\n${fs.readFileSync(abs, 'utf8')}\n</script>`;
  });

  // Inline <img>, <source>, <audio>, <video> src
  html = html.replace(/(<(?:img|source|audio|video)\s[^>]*)(src=["'])([^"']+)(["'][^>]*>)/gi, (_m, before, attr, ref, after) => {
    if (/^(https?:\/\/|data:)/.test(ref)) return _m;
    const abs = resolveAsset(ref);
    if (!abs) return _m;
    const dataUri = toDataUri(abs);
    if (!dataUri) return _m;
    return `${before}${attr}${dataUri}${after}`;
  });

  // Inline url() in <style> blocks
  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open, css, close) => {
    return `${open}${inlineCssUrls(css)}${close}`;
  });

  // Inline url() in style="..." attributes
  html = html.replace(/style=["']([^"']*url\([^)]+\)[^"']*)["']/gi, (_m, styleVal) => {
    return `style="${inlineCssUrls(styleVal)}"`;
  });

  // Ensure UTF-8 charset is declared. Prevents mojibake when the gist is
  // loaded via a blob: iframe or viewed directly on gist.github.com.
  if (!/<meta[^>]+charset\s*=/i.test(html)) {
    const charsetMeta = '<meta charset="utf-8">';
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1>\n${charsetMeta}`);
    } else if (/<html[^>]*>/i.test(html)) {
      html = html.replace(/<html([^>]*)>/i, `<html$1>\n<head>${charsetMeta}</head>`);
    } else {
      html = `${charsetMeta}\n${html}`;
    }
  }

  html = addSharedNoteStyle(html, noteCss);

  const usesBackendAPIs = /\b(noteDB|noteFiles|noteSQL|noteScripts|noteLog)\b/.test(html);

  return { html, noteTitle, usesBackendAPIs };
}

/** Register import, export, publishing, and clipping IPC for the current workspace.
 * Workspace/window getters intentionally remain live across asynchronous work.
 */
function registerImportExportHandlers({
  ipcMain, app, dialog, appRoot, getWorkspacePath, getMainWindow,
  isInsideWorkspace, noteCss, exportModule, bulkExport,
  importMarkdownFiles, importPlaintextFiles, scanFolder, scanFiles,
  executeBatchImport, github, noteDb, shareRenderer, clipFromUrl, githubApi, getPublishedNotes,
}) {
  // --- Export engine (feature 102) ---

  ipcMain.handle('export:note', async (_e, notePath, format, options) => {
    if (!getWorkspacePath()) return { error: 'No workspace open' };
    if (typeof notePath !== 'string' || !notePath) return { error: 'notePath is required' };
    const resolved = path.resolve(notePath);
    if (!isInsideWorkspace(resolved)) return { error: 'Path is outside the workspace' };
    try {
      return await exportModule.exportNote(resolved, format, options);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('export:formats', () => {
    return exportModule.getSupportedFormats();
  });

  // --- PDF export with Save dialog (feature 103) ---

  ipcMain.handle('export:save-pdf', async (_e, notePath, options) => {
    if (!getWorkspacePath()) return { error: 'No workspace open' };
    if (typeof notePath !== 'string' || !notePath) return { error: 'notePath is required' };
    const resolved = path.resolve(notePath);
    if (!isInsideWorkspace(resolved)) return { error: 'Path is outside the workspace' };

    _e.sender.send('export:pdf-progress', 'loading');

    let pdfBuffer;
    try {
      const result = await exportModule.exportNote(resolved, 'pdf', {
        notePath: resolved,
        workspacePath: getWorkspacePath(),
        ...(options || {}),
      });
      pdfBuffer = result.content;
    } catch (err) {
      return { error: err.message };
    }

    _e.sender.send('export:pdf-progress', 'saving');

    const baseName = path.basename(resolved, path.extname(resolved));
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: path.join(path.dirname(resolved), `${baseName}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });

    if (canceled || !filePath) return { cancelled: true };

    try {
      fs.writeFileSync(filePath, pdfBuffer);
    } catch (err) {
      return { error: `Failed to write PDF: ${err.message}` };
    }

    return { success: true, filePath };
  });

  // --- Markdown export with Save dialog (feature 104) ---

  ipcMain.handle('export:save-markdown', async (_e, notePath) => {
    if (!getWorkspacePath()) return { error: 'No workspace open' };
    if (typeof notePath !== 'string' || !notePath) return { error: 'notePath is required' };
    const resolved = path.resolve(notePath);
    if (!isInsideWorkspace(resolved)) return { error: 'Path is outside the workspace' };

    let markdownContent;
    try {
      const result = await exportModule.exportNote(resolved, 'markdown');
      markdownContent = result.content;
    } catch (err) {
      return { error: err.message };
    }

    const baseName = path.basename(resolved, path.extname(resolved));
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: path.join(path.dirname(resolved), `${baseName}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });

    if (canceled || !filePath) return { cancelled: true };

    try {
      fs.writeFileSync(filePath, markdownContent, 'utf-8');
    } catch (err) {
      return { error: `Failed to write Markdown: ${err.message}` };
    }

    return { success: true, filePath };
  });

  // --- Plain text export with Save dialog (feature 105) ---

  ipcMain.handle('export:save-plaintext', async (_e, notePath) => {
    if (!getWorkspacePath()) return { error: 'No workspace open' };
    if (typeof notePath !== 'string' || !notePath) return { error: 'notePath is required' };
    const resolved = path.resolve(notePath);
    if (!isInsideWorkspace(resolved)) return { error: 'Path is outside the workspace' };

    let textContent;
    try {
      const result = await exportModule.exportNote(resolved, 'plaintext');
      textContent = result.content;
    } catch (err) {
      return { error: err.message };
    }

    const baseName = path.basename(resolved, path.extname(resolved));
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: path.join(path.dirname(resolved), `${baseName}.txt`),
      filters: [{ name: 'Plain Text', extensions: ['txt'] }],
    });

    if (canceled || !filePath) return { cancelled: true };

    try {
      fs.writeFileSync(filePath, textContent, 'utf-8');
    } catch (err) {
      return { error: `Failed to write plain text: ${err.message}` };
    }

    return { success: true, filePath };
  });

  ipcMain.handle('export:save-html', async (_e, notePath) => {
    if (!getWorkspacePath()) return { error: 'No workspace open' };
    if (typeof notePath !== 'string' || !notePath) return { error: 'notePath is required' };
    const resolved = path.resolve(notePath);
    if (!isInsideWorkspace(resolved)) return { error: 'Path is outside the workspace' };

    let htmlContent;
    try {
      const result = await exportModule.exportNote(resolved, 'html');
      htmlContent = result.content;
    } catch (err) {
      return { error: `Conversion failed: ${err.message}` };
    }

    const baseName = path.basename(resolved, '.html');
    const newFilename = baseName + '.html';

    let filePath;
    try {
      const { canceled, filePath: chosenPath } = await dialog.showSaveDialog(getMainWindow(), {
        defaultPath: path.join(app.getPath('documents'), newFilename),
        filters: [{ name: 'HTML', extensions: ['html'] }],
      });
      if (canceled) return { cancelled: true };
      filePath = chosenPath;
      fs.writeFileSync(filePath, htmlContent, 'utf-8');
    } catch (err) {
      return { error: `Failed to write HTML: ${err.message}` };
    }

    return { success: true, filePath };
  });

  // --- Bulk export to ZIP (feature 106) ---

  let _activeBulkExporter = null;

  ipcMain.handle('export:bulk', async (_e, folderPath, format) => {
    if (!getWorkspacePath()) return { error: 'No workspace open' };
    if (typeof folderPath !== 'string' || !folderPath) return { error: 'folderPath is required' };
    if (typeof format !== 'string' || !format) return { error: 'format is required' };

    const resolved = path.resolve(folderPath);
    if (!isInsideWorkspace(resolved)) return { error: 'Path is outside the workspace' };

    if (_activeBulkExporter) {
      return { error: 'A bulk export is already in progress. Cancel it first.' };
    }

    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const { canceled, filePath: outputPath } = await dialog.showSaveDialog({
      defaultPath: path.join(getWorkspacePath(), `notes-export-${dateStr}.zip`),
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });

    if (canceled || !outputPath) return { cancelled: true };

    try { _e.sender.send('export:bulk-progress', { processed: 0, total: 0, currentFile: 'Preparing\u2026' }); } catch {}

    return new Promise((resolve) => {
      const exporter = bulkExport(resolved, format, getWorkspacePath(), { outputPath });
      _activeBulkExporter = exporter;

      exporter.on('progress', (data) => {
        try { _e.sender.send('export:bulk-progress', data); } catch {}
      });

      exporter.on('done', ({ zipPath }) => {
        _activeBulkExporter = null;
        resolve({ success: true, filePath: zipPath });
      });

      exporter.on('cancelled', () => {
        _activeBulkExporter = null;
        resolve({ cancelled: true });
      });

      exporter.on('error', (err) => {
        _activeBulkExporter = null;
        try { fs.unlinkSync(outputPath); } catch {}
        resolve({ error: err.message });
      });
    });
  });

  ipcMain.on('export:bulk-cancel', () => {
    if (_activeBulkExporter) {
      _activeBulkExporter.cancel();
    }
  });

  // --- Export as Single HTML File ---

  ipcMain.handle('export:single-html', async (_e, notePath) => {
    if (!getWorkspacePath()) return { error: 'No workspace open' };
    if (typeof notePath !== 'string' || !notePath) return { error: 'notePath is required' };

    const noteFolderPath = path.resolve(notePath);
    if (!isInsideWorkspace(noteFolderPath)) return { error: 'Path is outside the workspace' };

    const indexPath = path.join(noteFolderPath, 'index.html');
    if (!fs.existsSync(indexPath)) return { error: 'Not a valid note (no index.html found)' };

    const { html, noteTitle, usesBackendAPIs } = inlineNoteAsHtml(noteFolderPath, noteCss);
    const safeTitle = noteTitle.replace(/[/\\:*?"<>|]/g, '-').slice(0, 100) || 'ExportedNote';

    const { canceled, filePath: destPath } = await dialog.showSaveDialog(getMainWindow(), {
      defaultPath: path.join(app.getPath('desktop'), `${safeTitle}.html`),
      filters: [{ name: 'HTML File', extensions: ['html'] }],
      message: usesBackendAPIs
        ? `"${noteTitle}" uses backend APIs (noteDB/noteSQL/etc.) that won't work in a browser.`
        : `Export "${noteTitle}" as a single HTML file`,
    });
    if (canceled || !destPath) return { cancelled: true };

    try {
      fs.writeFileSync(destPath, html, 'utf8');
      return { success: true, filePath: destPath, title: noteTitle, usesBackendAPIs };
    } catch (err) {
      return { error: `Export failed: ${err.message}` };
    }
  });

  // --- Publish / Unpublish Note via GitHub Gist + Pages ---

  // Gist visibility cannot be changed in place — the gist must be recreated to
  // switch between secret and public. ~10 MB is GitHub's hard cap on a gist;
  // 1 MB is the practical limit before the web UI degrades.
  const SHARE_GIST_BYTES_WARN = 1024 * 1024;
  const SHARE_GIST_BYTES_HARD_CAP = 10 * 1024 * 1024;

  ipcMain.handle('export:publish', async (_e, notePath, options = {}) => {
    if (!getWorkspacePath()) return { error: 'No workspace open' };
    if (typeof notePath !== 'string' || !notePath) return { error: 'notePath is required' };

    if (!github.isConnected()) {
      return { error: 'github-not-connected', message: 'Connect GitHub to share notes.' };
    }

    // Phase 5 UI passes options.repoName on the user's first publish.
    if (options && options.repoName && !github.getRepoName()) {
      try { github.setRepoName(options.repoName); }
      catch (err) { return { error: err.message || String(err) }; }
    }
    const repoName = github.getRepoName();
    if (!repoName) {
      return { error: 'github-no-repo-name', message: 'Pick a repo name to host your shares.' };
    }

    const noteFolderPath = path.resolve(notePath);
    if (!isInsideWorkspace(noteFolderPath)) return { error: 'Path is outside the workspace' };

    const indexPath = path.join(noteFolderPath, 'index.html');
    if (!fs.existsSync(indexPath)) return { error: 'Not a valid note (no index.html found)' };

    const { html, noteTitle, usesBackendAPIs } = inlineNoteAsHtml(noteFolderPath, noteCss);
    const htmlBytes = Buffer.byteLength(html, 'utf8');
    if (htmlBytes > SHARE_GIST_BYTES_HARD_CAP) {
      return { error: `Note is too large to share via GitHub (${(htmlBytes / 1024 / 1024).toFixed(1)} MB > 10 MB).` };
    }

    const noteId = path.relative(getWorkspacePath(), noteFolderPath);
    const kvData = noteDb.noteDbLoad(getWorkspacePath(), noteId);

    const api = githubApi || require('../auth/github-api');
    const visibility = options && options.visibility === 'public' ? 'public' : 'secret';
    const isPublic = visibility === 'public';

    try {
      const provision = await api.ensureRepoProvisioned(repoName, shareRenderer.getRenderer());

      const looksLikeGistId = (s) => typeof s === 'string' && /^[a-f0-9]{20,40}$/i.test(s);
      const oldId = kvData.__shareId || null;
      const oldVisibility = kvData.__shareVisibility || null;
      let gistId = null;

      if (looksLikeGistId(oldId) && oldVisibility === visibility) {
        try {
          await api.updateGist(oldId, html);
          gistId = oldId;
        } catch {
          gistId = null; // gist gone or inaccessible — fall through to create
        }
      } else if (looksLikeGistId(oldId) && oldVisibility && oldVisibility !== visibility) {
        // Visibility changed → can't mutate; replace.
        try { await api.deleteGist(oldId); } catch {}
      }

      if (!gistId) {
        const created = await api.createGist({ html, isPublic });
        gistId = created.id;
      }

      // First-publish path: Pages 404s for ~30–60 s during the initial build.
      // Wait for it before returning the URL so the user never gets a dead link.
      if (provision.firstProvision) {
        try { await api.waitForPagesBuilt(repoName); } catch {}
      }

      const shareUrl = api.pagesUrl(repoName, gistId);
      kvData.__shareId = gistId;
      kvData.__shareUrl = shareUrl;
      kvData.__shareVisibility = visibility;
      noteDb.noteDbFlush(getWorkspacePath(), noteId, kvData);

      const sizeWarning = htmlBytes > SHARE_GIST_BYTES_WARN
        ? ` (${(htmlBytes / 1024 / 1024).toFixed(1)} MB — close to GitHub's 10 MB limit)`
        : '';

      return {
        success: true,
        shareUrl,
        shareId: gistId,
        title: noteTitle,
        usesBackendAPIs,
        visibility,
        sizeWarning,
        firstProvision: !!provision.firstProvision,
      };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  });

  ipcMain.handle('export:unpublish', async (_e, notePath) => {
    if (!getWorkspacePath()) return { error: 'No workspace open' };
    if (typeof notePath !== 'string' || !notePath) return { error: 'notePath is required' };

    if (!github.isConnected()) return { error: 'Not connected to GitHub.' };

    const noteFolderPath = path.resolve(notePath);
    if (!isInsideWorkspace(noteFolderPath)) return { error: 'Path is outside the workspace' };

    const noteId = path.relative(getWorkspacePath(), noteFolderPath);
    const kvData = noteDb.noteDbLoad(getWorkspacePath(), noteId);
    const shareId = kvData.__shareId;
    if (!shareId) return { error: 'This note is not published.' };

    try {
      const api = githubApi || require('../auth/github-api');
      await api.deleteGist(shareId);
    } catch (err) {
      return { error: err.message || String(err) };
    }

    delete kvData.__shareId;
    delete kvData.__shareUrl;
    delete kvData.__shareVisibility;
    noteDb.noteDbFlush(getWorkspacePath(), noteId, kvData);

    return { success: true };
  });

  // Use the collection catalog's discovery and local publication truth. This does
  // not verify that the gist still exists on GitHub.
  ipcMain.handle('notes:listPublished', () => {
    if (!getWorkspacePath()) return {};
    if (getPublishedNotes) return getPublishedNotes();
    return buildCatalog(getWorkspacePath(), { includePublication: true,
      metadataReader: { read: (root, noteId) => ({ publication: publicationMetadata(noteDb.noteDbLoad(root, noteId)) }) },
    }).publishedNotes;
  });

  // --- Export as Standalone Electron App ---

  ipcMain.handle('export:standalone', async (_e, notePath) => {
    if (!getWorkspacePath()) return { error: 'No workspace open' };
    if (typeof notePath !== 'string' || !notePath) return { error: 'notePath is required' };

    const noteFolderPath = path.resolve(notePath);
    if (!isInsideWorkspace(noteFolderPath)) return { error: 'Path is outside the workspace' };

    // Validate note folder
    const indexPath = path.join(noteFolderPath, 'index.html');
    if (!fs.existsSync(indexPath)) return { error: 'Not a valid note (no index.html found)' };

    // Locate the pre-built template skeleton. In packaged builds the prebuilt
    // .app ships via electron-builder's `extraResources` (kept out of app.asar
    // so framework symlinks survive); in dev it lives next to the source.
    const templateAppName = 'ExportedNote.app';
    const templateDir = app.isPackaged
      ? path.join(process.resourcesPath, 'export-template')
      : path.join(appRoot, 'export-app-template', 'prebuilt', 'ExportedNote-darwin-arm64');
    const templateApp = path.join(templateDir, templateAppName);
    if (!fs.existsSync(templateApp)) {
      return { error: 'Export template not built. Run: node scripts/build-export-template.js' };
    }

    // Extract note title from index.html <title> tag
    let noteTitle = path.basename(noteFolderPath);
    try {
      const html = fs.readFileSync(indexPath, 'utf8');
      const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (match) noteTitle = match[1].trim();
    } catch {}

    // Sanitize title for filesystem
    const safeTitle = noteTitle.replace(/[/\\:*?"<>|]/g, '-').slice(0, 100) || 'ExportedNote';

    // Show Save dialog
    const { canceled, filePath: destPath } = await dialog.showSaveDialog(getMainWindow(), {
      defaultPath: path.join(app.getPath('desktop'), `${safeTitle}.app`),
      message: `Export "${noteTitle}" as a standalone app (~200 MB)`,
    });
    if (canceled || !destPath) return { cancelled: true };

    // Notify progress
    try { _e.sender.send('export:standalone-progress', 'copying'); } catch {}

    const tmpDir = path.join(app.getPath('temp'), `note-export-${Date.now()}`);
    const tmpApp = path.join(tmpDir, `${safeTitle}.app`);

    try {
      // Copy template skeleton (cp -a preserves relative symlinks in frameworks)
      fs.mkdirSync(tmpDir, { recursive: true });
      execFileSync('cp', ['-a', templateApp, tmpApp]);

      // Keep internal binary names as "ExportedNote" — Electron helpers must match
      // the main binary name. Only the outer .app folder gets renamed (via tmpApp).
      // The display name is set via Info.plist CFBundleDisplayName.

      // Inject the note folder into Resources/note/
      const resourcesDir = path.join(tmpApp, 'Contents', 'Resources');
      const noteDestDir = path.join(resourcesDir, 'note');
      fs.cpSync(noteFolderPath, noteDestDir, {
        recursive: true,
        filter: (src) => !src.split(path.sep).includes('.notes-app'),
      });

      // Write config.json
      fs.writeFileSync(
        path.join(resourcesDir, 'config.json'),
        JSON.stringify({ noteId: 'note', title: noteTitle }, null, 2)
      );

      // Update Info.plist — only set CFBundleDisplayName (shown in Dock/Finder).
      // Do NOT change CFBundleName or CFBundleExecutable — Electron uses
      // CFBundleName to locate helper apps, so it must stay "ExportedNote".
      const plistPath = path.join(tmpApp, 'Contents', 'Info.plist');
      if (fs.existsSync(plistPath)) {
        let plist = fs.readFileSync(plistPath, 'utf8');
        if (!plist.includes('CFBundleDisplayName')) {
          plist = plist.replace(
            /(<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>)/,
            `$1\n\t<key>CFBundleDisplayName</key>\n\t<string>${noteTitle}</string>`
          );
        } else {
          plist = plist.replace(
            /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*/,
            `$1${noteTitle}`
          );
        }
        fs.writeFileSync(plistPath, plist);
      }

      // Ad-hoc codesign (inside-out: helpers → frameworks → outer app)
      try { _e.sender.send('export:standalone-progress', 'signing'); } catch {}
      try {
        const fwPath = path.join(tmpApp, 'Contents', 'Frameworks');
        const entries = fs.readdirSync(fwPath);
        // 1. Sign helper apps
        for (const e of entries.filter(f => f.endsWith('.app'))) {
          execFileSync('codesign', ['--force', '--sign', '-', path.join(fwPath, e)]);
        }
        // 2. Sign frameworks
        for (const e of entries.filter(f => f.endsWith('.framework'))) {
          execFileSync('codesign', ['--force', '--sign', '-', path.join(fwPath, e)]);
        }
        // 3. Sign outer app
        execFileSync('codesign', ['--force', '--sign', '-', tmpApp]);
      } catch {
        // Non-fatal — app will work, just with Gatekeeper warning
      }

      // Move to final destination (remove existing if present)
      if (fs.existsSync(destPath)) {
        fs.rmSync(destPath, { recursive: true });
      }
      fs.renameSync(tmpApp, destPath);

      return { success: true, filePath: destPath, title: noteTitle };
    } catch (err) {
      return { error: `Export failed: ${err.message}` };
    } finally {
      // Clean up temp dir
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    }
  });

  // --- Export Standalone App Source Code ---

  ipcMain.handle('export:standalone-source', async (_e, notePath_) => {
    if (!getWorkspacePath()) return { error: 'No workspace open' };
    if (typeof notePath_ !== 'string' || !notePath_) return { error: 'notePath is required' };

    const noteFolderPath = path.resolve(notePath_);
    if (!isInsideWorkspace(noteFolderPath)) return { error: 'Path is outside the workspace' };

    const indexPath = path.join(noteFolderPath, 'index.html');
    if (!fs.existsSync(indexPath)) return { error: 'Not a valid note (no index.html found)' };

    // Extract note title
    let noteTitle = path.basename(noteFolderPath);
    try {
      const html = fs.readFileSync(indexPath, 'utf8');
      const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (match) noteTitle = match[1].trim();
    } catch {}

    const safeTitle = noteTitle.replace(/[/\\:*?"<>|]/g, '-').slice(0, 100) || 'ExportedNote';

    // Show folder picker
    const { canceled, filePaths } = await dialog.showOpenDialog(getMainWindow(), {
      title: `Choose folder for "${noteTitle}" source code`,
      defaultPath: path.join(app.getPath('desktop'), `${safeTitle}-source`),
      properties: ['createDirectory', 'openDirectory'],
    });
    if (canceled || !filePaths.length) return { cancelled: true };

    const destDir = path.join(filePaths[0], `${safeTitle}-source`);

    try {
      fs.mkdirSync(destDir, { recursive: true });

      // Copy template source files. Packaged builds ship them via
      // electron-builder's `extraResources`; in dev they live in the repo.
      const templateSourceDir = app.isPackaged
        ? path.join(process.resourcesPath, 'export-template-source')
        : path.join(appRoot, 'export-app-template');
      const sourceFiles = ['main.js', 'preload.js', 'note-db.js'];
      for (const file of sourceFiles) {
        const src = path.join(templateSourceDir, file);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(destDir, file));
      }

      // Copy note-viewer.css
      const cssPath = path.join(__dirname, '../renderer/note-viewer.css');
      if (fs.existsSync(cssPath)) fs.copyFileSync(cssPath, path.join(destDir, 'note-viewer.css'));

      // Copy the note folder into note/
      const noteDestDir = path.join(destDir, 'note');
      fs.cpSync(noteFolderPath, noteDestDir, {
        recursive: true,
        filter: (src) => !src.split(path.sep).includes('.notes-app'),
      });

      // Write config.json
      fs.writeFileSync(
        path.join(destDir, 'config.json'),
        JSON.stringify({ noteId: 'note', title: noteTitle }, null, 2)
      );

      // Write package.json with build scripts
      const electronVersion = process.versions.electron;
      const pkgJson = {
        name: safeTitle.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        version: '1.0.0',
        main: 'main.js',
        scripts: {
          start: 'electron .',
          build: 'electron-packager . --overwrite --out=dist',
        },
        dependencies: {
          'better-sqlite3': '^11.10.0',
        },
        devDependencies: {
          electron: `^${electronVersion}`,
          'electron-packager': '^17.1.2',
          '@electron/rebuild': '^3.7.1',
        },
      };
      fs.writeFileSync(path.join(destDir, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n');

      // Write README
      const readme = `# ${noteTitle}

Standalone Electron app exported from nextprob.

## Quick Start

\`\`\`bash
npm install
npx @electron/rebuild   # rebuild native modules for Electron
npm start               # run the app
\`\`\`

## Build a Distributable .app

\`\`\`bash
npm run build
\`\`\`

The packaged app will be in the \`dist/\` folder.

## Project Structure

- \`main.js\` — Electron main process (window, IPC handlers, note:// protocol)
- \`preload.js\` — Preload script (exposes noteDB, noteFiles, noteSQL, noteScripts APIs)
- \`note-db.js\` — Key-value storage helper (JSON-based)
- \`note-viewer.css\` — Injected stylesheet for the note viewer
- \`config.json\` — App configuration (title, noteId)
- \`note/\` — Your note content (index.html and assets)

## Customizing

Edit any file and run \`npm start\` to see changes. The note content is in \`note/\`.
During development, the app reads from the local \`note/\` directory. When packaged,
it reads from the app's resources directory.
`;
      fs.writeFileSync(path.join(destDir, 'README.md'), readme);

      return { success: true, filePath: destDir, title: noteTitle };
    } catch (err) {
      return { error: `Export failed: ${err.message}` };
    }
  });

  // --- Markdown Import (feature 107) ---

  ipcMain.handle('import:browse-markdown', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return result.filePaths;
  });

  ipcMain.handle('import:markdown', async (_e, filePaths, targetDir, mode) => {
    if (!getWorkspacePath()) return { error: 'No workspace open' };
    if (!Array.isArray(filePaths) || filePaths.length === 0) return { error: 'No files specified' };
    if (typeof targetDir !== 'string' || !targetDir) return { error: 'targetDir is required' };
    if (mode !== 'html' && mode !== 'markdown') return { error: 'mode must be "html" or "markdown"' };

    const resolvedTarget = path.resolve(targetDir);
    if (!isInsideWorkspace(resolvedTarget)) return { error: 'Target folder is outside workspace' };

    // Ensure target directory exists (it should, but guard against race conditions)
    try {
      await fs.promises.mkdir(resolvedTarget, { recursive: true });
    } catch {}

    return importMarkdownFiles(filePaths, resolvedTarget, mode, noteCss);
  });

  // --- Plain Text Import (feature 108) ---

  ipcMain.handle('import:browse-plaintext', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Text Files', extensions: ['txt'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return result.filePaths;
  });

  ipcMain.handle('import:plaintext', async (_e, filePaths, targetDir, mode) => {
    if (!getWorkspacePath()) return { error: 'No workspace open' };
    if (!Array.isArray(filePaths) || filePaths.length === 0) return { error: 'No files specified' };
    if (typeof targetDir !== 'string' || !targetDir) return { error: 'targetDir is required' };
    if (mode !== 'pre' && mode !== 'p' && mode !== 'txt') return { error: 'mode must be "pre", "p", or "txt"' };

    const resolvedTarget = path.resolve(targetDir);
    if (!isInsideWorkspace(resolvedTarget)) return { error: 'Target folder is outside workspace' };

    // Ensure target directory exists (guard against race conditions)
    try {
      await fs.promises.mkdir(resolvedTarget, { recursive: true });
    } catch {}

    return importPlaintextFiles(filePaths, resolvedTarget, mode, noteCss);
  });

  // --- Batch Import (feature 109) ---

  let activeBatchImporter = null;

  ipcMain.handle('import:batch-scan-folder', async (_e, folderPath) => {
    if (!getWorkspacePath()) return { error: 'No workspace open' };
    if (typeof folderPath !== 'string' || !folderPath) return { error: 'folderPath is required' };

    let stat;
    try { stat = fs.statSync(folderPath); } catch { return { error: 'Folder not found' }; }
    if (!stat.isDirectory()) return { error: 'Path is not a directory' };

    return scanFolder(folderPath);
  });

  ipcMain.handle('import:batch-scan-files', async (_e, filePaths) => {
    if (!getWorkspacePath()) return { error: 'No workspace open' };
    if (!Array.isArray(filePaths) || filePaths.length === 0) return { error: 'No files specified' };

    return scanFiles(filePaths);
  });

  ipcMain.handle('import:batch-browse-folder', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('import:batch-execute', async (e, files, targetDir) => {
    if (!getWorkspacePath()) return { error: 'No workspace open' };
    if (!Array.isArray(files) || files.length === 0) return { error: 'No files specified' };
    if (typeof targetDir !== 'string' || !targetDir) return { error: 'targetDir is required' };

    const resolvedTarget = path.resolve(targetDir);
    if (!isInsideWorkspace(resolvedTarget)) return { error: 'Target folder is outside workspace' };

    if (activeBatchImporter) return { error: 'A batch import is already in progress' };

    return new Promise((resolve) => {
      const importer = executeBatchImport(files, resolvedTarget, noteCss);
      activeBatchImporter = importer;

      importer.on('progress', (data) => {
        e.sender.send('import:batch-progress', data);
      });

      importer.on('done', (results) => {
        activeBatchImporter = null;
        resolve(results);
      });

      importer.on('cancelled', (results) => {
        activeBatchImporter = null;
        resolve({ ...results, cancelled: true });
      });

      importer.on('error', (err) => {
        activeBatchImporter = null;
        resolve({ error: err.message });
      });
    });
  });

  ipcMain.on('import:batch-cancel', () => {
    if (activeBatchImporter) activeBatchImporter.cancel();
  });

  // ─── Web Clip ─────────────────────────────────────────────────────────────────

  ipcMain.handle('clip:from-url', async (_e, url, targetDir) => {
    if (!getWorkspacePath()) return { error: 'No workspace open' };
    if (typeof url !== 'string' || !url) return { error: 'URL is required' };
    if (typeof targetDir !== 'string' || !targetDir) return { error: 'targetDir is required' };

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { error: 'Only http and https URLs are supported' };
      }
    } catch {
      return { error: 'Invalid URL' };
    }

    const resolvedTarget = path.resolve(targetDir);
    if (!isInsideWorkspace(resolvedTarget)) return { error: 'Target folder is outside workspace' };

    try {
      await fs.promises.mkdir(resolvedTarget, { recursive: true });
    } catch {}

    return clipFromUrl(url, resolvedTarget, noteCss);
  });

}

module.exports = { registerImportExportHandlers, inlineNoteAsHtml };
