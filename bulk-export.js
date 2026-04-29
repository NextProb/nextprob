'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const archiver = require('archiver');
const exportModule = require('./export');

const IGNORED_DIRS = new Set(['.git', '.claude', 'node_modules', '.DS_Store', '.Trash', '.vscode', '.notes-app']);

/**
 * Recursively collects files and empty folders under folderPath.
 * Skips: IGNORED_DIRS entries, dotfile names, symlinks.
 * Returns { files: [{absolutePath, relativePath}], emptyFolders: [relativePath+'/'] }
 * where relativePath is relative to folderPath.
 *
 * hasContent return value propagates upward so parent directories
 * can detect that all their children were empty/skipped.
 */
function collectFiles(folderPath) {
  const files = [];
  const emptyFolders = [];

  function walk(dirPath, relDir) {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return false; // permission error — treat as empty
    }

    const children = entries.filter(e => {
      if (e.isSymbolicLink()) return false;
      if (e.name.startsWith('.')) return false;
      if (e.isDirectory() && IGNORED_DIRS.has(e.name)) return false;
      return true;
    });

    let hasContent = false;
    for (const entry of children) {
      const absPath = path.join(dirPath, entry.name);
      const relPath = relDir ? relDir + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        const subHasContent = walk(absPath, relPath);
        if (subHasContent) hasContent = true;
      } else if (entry.isFile()) {
        files.push({ absolutePath: absPath, relativePath: relPath });
        hasContent = true;
      }
    }

    if (!hasContent && relDir !== '') {
      emptyFolders.push(relDir + '/');
    }
    return hasContent;
  }

  walk(folderPath, '');
  return { files, emptyFolders };
}

const EXTENSION_MAP = {
  html: '.html',
  pdf: '.pdf',
  markdown: '.md',
  plaintext: '.txt',
};

/**
 * Bulk-exports folderPath to a ZIP file at options.outputPath.
 *
 * @param {string} folderPath     - absolute path to the folder to export
 * @param {string} format         - 'html' | 'pdf' | 'markdown' | 'plaintext'
 * @param {string} workspacePath  - absolute workspace root (for PDF options)
 * @param {{ outputPath: string }} options
 * @returns {EventEmitter & { cancel: () => void }}
 *   Emits: 'progress'  — { processed, total, currentFile }
 *          'done'      — { zipPath }
 *          'error'     — Error object
 *          'cancelled' — (no data)
 */
function bulkExport(folderPath, format, workspacePath, options) {
  const emitter = new EventEmitter();
  let cancelled = false;

  emitter.cancel = function () {
    cancelled = true;
  };

  const newExt = EXTENSION_MAP[format];
  if (!newExt) {
    process.nextTick(() => emitter.emit('error', new Error(`Unknown format: ${format}`)));
    return emitter;
  }

  const { files, emptyFolders } = collectFiles(folderPath);

  // Files we will process for progress counting:
  // 'html' format processes all files; other formats only process .html files.
  const toProcess = format === 'html'
    ? files
    : files.filter(f => path.extname(f.absolutePath).toLowerCase() === '.html');
  const total = toProcess.length;

  (async () => {
    let output;
    try {
      output = fs.createWriteStream(options.outputPath);
    } catch (err) {
      emitter.emit('error', err);
      return;
    }

    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('error', (err) => {
      emitter.emit('error', err);
      try { fs.unlinkSync(options.outputPath); } catch {}
    });

    output.on('close', () => {
      if (!cancelled) {
        emitter.emit('done', { zipPath: options.outputPath });
      }
    });

    archive.pipe(output);

    // Add empty folder entries so structure is preserved
    for (const relDir of emptyFolders) {
      archive.append(Buffer.from(''), { name: relDir });
    }

    await new Promise(resolve => setImmediate(resolve));

    let processed = 0;
    const skippedFiles = [];

    for (const file of files) {
      if (cancelled) {
        archive.abort();
        output.destroy();
        try { fs.unlinkSync(options.outputPath); } catch {}
        emitter.emit('cancelled');
        return;
      }

      const ext = path.extname(file.absolutePath).toLowerCase();
      const isHtml = ext === '.html';

      if (format === 'html') {
        // Copy verbatim — all file types
        archive.file(file.absolutePath, { name: file.relativePath });
        processed++;
        emitter.emit('progress', { processed, total, currentFile: file.relativePath });
      } else if (isHtml) {
        // Convert .html file to the target format
        const relNoExt = file.relativePath.slice(0, file.relativePath.length - ext.length);
        const targetRelPath = relNoExt + newExt;
        try {
          const result = await exportModule.exportNote(file.absolutePath, format, {
            notePath: file.absolutePath,
            workspacePath,
          });
          archive.append(result.content, { name: targetRelPath });
        } catch (err) {
          skippedFiles.push({ file: file.relativePath, error: err.message });
        }
        processed++;
        emitter.emit('progress', { processed, total, currentFile: file.relativePath });
      }
      // else: non-.html file in a conversion format — skip silently
    }

    // Include error manifest if any files failed
    if (skippedFiles.length > 0) {
      const lines = skippedFiles.map(s => `${s.file}: ${s.error}`).join('\n');
      archive.append(`Files skipped due to conversion errors:\n\n${lines}\n`, { name: '_errors.txt' });
    }

    await archive.finalize();
  })();

  return emitter;
}

module.exports = { bulkExport };
