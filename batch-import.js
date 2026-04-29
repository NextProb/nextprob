'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { convertMarkdownToHtml, getUniqueFilePath, getUniqueNotePath } = require('./markdown-import');
const { convertPlaintextToHtml, isBinaryContent } = require('./plaintext-import');

const KNOWN_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.tiff', '.avif']);
const KNOWN_BINARY_EXTS = new Set(['.pdf', '.zip', '.tar', '.gz', '.exe', '.bin', '.dmg', '.pkg', '.dll', '.so', '.dylib', '.wasm', '.mp3', '.mp4', '.mov', '.avi', '.mkv']);
const IGNORED_DIRS = new Set(['node_modules', '.git', '__pycache__', '.cache', '.Trash', 'dist', 'build']);

/**
 * Formats a byte count as a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function humanFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

/**
 * Classifies a file by extension and binary content check.
 * For unknown extensions, reads the first 8192 bytes.
 *
 * @param {string} absolutePath
 * @param {string} ext  - file extension including dot (e.g. '.md')
 * @returns {{ type: string, defaultAction: string }}
 */
function classifyFile(absolutePath, ext) {
  const lext = ext.toLowerCase();

  if (lext === '.html' || lext === '.htm') return { type: 'html', defaultAction: 'copy' };
  if (lext === '.md' || lext === '.markdown') return { type: 'md', defaultAction: 'convert-html-md' };
  if (lext === '.txt') return { type: 'txt', defaultAction: 'convert-html-pre' };
  if (KNOWN_IMAGE_EXTS.has(lext)) return { type: 'image', defaultAction: 'skip' };
  if (KNOWN_BINARY_EXTS.has(lext)) return { type: 'binary', defaultAction: 'skip' };

  // Unknown extension: read first 8192 bytes to check for binary content
  try {
    const buf = Buffer.alloc(8192);
    const fd = fs.openSync(absolutePath, 'r');
    const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
    fs.closeSync(fd);
    if (isBinaryContent(buf.slice(0, bytesRead))) {
      return { type: 'binary', defaultAction: 'skip' };
    }
    return { type: 'unknown-text', defaultAction: 'skip' };
  } catch {
    return { type: 'binary', defaultAction: 'skip' };
  }
}

/**
 * Recursively scans a folder and classifies each file.
 * Skips dotfiles, IGNORED_DIRS, and symlinks.
 *
 * @param {string} folderPath - absolute path to the root folder to scan
 * @returns {{ files: Array, totalSize: number, totalSizeLabel: string, typeCounts: Object }}
 */
function scanFolder(folderPath) {
  const files = [];
  let totalSize = 0;
  const typeCounts = { html: 0, md: 0, txt: 0, image: 0, binary: 0, 'unknown-text': 0 };

  function walk(dirPath, relBase) {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const absolutePath = path.join(dirPath, entry.name);
      const relativePath = relBase ? path.join(relBase, entry.name) : entry.name;

      // Skip symlinks to prevent infinite loops and out-of-scope traversal
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        const { type, defaultAction } = classifyFile(absolutePath, ext);

        let size = 0;
        try { size = fs.statSync(absolutePath).size; } catch {}

        totalSize += size;
        typeCounts[type] = (typeCounts[type] || 0) + 1;

        files.push({
          absolutePath,
          relativePath,
          size,
          sizeLabel: humanFileSize(size),
          type,
          defaultAction,
          action: defaultAction,
        });
      }
    }
  }

  walk(folderPath, '');

  return { files, totalSize, totalSizeLabel: humanFileSize(totalSize), typeCounts };
}

/**
 * Classifies a flat list of individual files (from multi-file drag-and-drop).
 * All relativePath values are just the filename (no subfolder structure).
 *
 * @param {string[]} filePaths - absolute paths to source files
 * @returns {{ files: Array, totalSize: number, totalSizeLabel: string, typeCounts: Object }}
 */
function scanFiles(filePaths) {
  const files = [];
  let totalSize = 0;
  const typeCounts = { html: 0, md: 0, txt: 0, image: 0, binary: 0, 'unknown-text': 0 };

  for (const absolutePath of filePaths) {
    const ext = path.extname(absolutePath);
    const { type, defaultAction } = classifyFile(absolutePath, ext);

    let size = 0;
    try { size = fs.statSync(absolutePath).size; } catch {}

    totalSize += size;
    typeCounts[type] = (typeCounts[type] || 0) + 1;

    files.push({
      absolutePath,
      relativePath: path.basename(absolutePath),
      size,
      sizeLabel: humanFileSize(size),
      type,
      defaultAction,
      action: defaultAction,
    });
  }

  return { files, totalSize, totalSizeLabel: humanFileSize(totalSize), typeCounts };
}

/**
 * Executes the confirmed batch import.
 * Returns an EventEmitter with a cancel() method.
 *
 * Events:
 *   'progress' — { processed, total, currentFile }
 *   'done'     — { imported, skipped, errors }
 *   'cancelled'— { imported, skipped, errors, remaining }
 *   'error'    — Error
 *
 * @param {Array}  files     - file manifests with user-adjusted 'action' fields
 * @param {string} targetDir - absolute path to destination folder in workspace
 * @param {string} cssText   - NOTE_CSS stylesheet content
 * @returns {EventEmitter & { cancel: Function }}
 */
function executeBatchImport(files, targetDir, cssText) {
  const emitter = new EventEmitter();
  let cancelled = false;

  emitter.cancel = () => { cancelled = true; };

  const activeFiles = files.filter(f => f.action !== 'skip');
  const total = activeFiles.length;

  setImmediate(async () => {
    const imported = [];
    const skipped = [];
    const errors = [];
    let processed = 0;

    for (const file of files) {
      if (cancelled) break;

      if (file.action === 'skip') {
        skipped.push(file.relativePath);
        continue;
      }

      try {
        // Preserve subfolder structure: compute target subdirectory
        const relDir = path.dirname(file.relativePath);
        const relName = path.basename(file.relativePath);
        const relBase = path.basename(relName, path.extname(relName));
        const targetSubDir = (relDir === '.' || relDir === '') ? targetDir : path.join(targetDir, relDir);

        // Ensure subdirectory exists
        await fs.promises.mkdir(targetSubDir, { recursive: true });

        let targetPath;

        switch (file.action) {
          case 'convert-html-md': {
            const mdContent = await fs.promises.readFile(file.absolutePath, 'utf8');
            const fileContent = await convertMarkdownToHtml(mdContent, cssText);
            // Create note folder: {relBase}/index.html
            const desiredFolder = path.join(targetSubDir, relBase);
            const uniqueFolder = await getUniqueNotePath(desiredFolder);
            if (uniqueFolder === null) {
              errors.push({ relativePath: file.relativePath, error: `Could not find unique name for "${relBase}" (99 variants exist)` });
              continue;
            }
            await fs.promises.mkdir(uniqueFolder, { recursive: true });
            await fs.promises.writeFile(path.join(uniqueFolder, 'index.html'), fileContent, 'utf8');
            targetPath = uniqueFolder;
            break;
          }
          case 'convert-html-pre': {
            const txtContent = await fs.promises.readFile(file.absolutePath, 'utf8');
            const fileContent = convertPlaintextToHtml(txtContent, 'pre', cssText);
            const desiredFolder = path.join(targetSubDir, relBase);
            const uniqueFolder = await getUniqueNotePath(desiredFolder);
            if (uniqueFolder === null) {
              errors.push({ relativePath: file.relativePath, error: `Could not find unique name for "${relBase}" (99 variants exist)` });
              continue;
            }
            await fs.promises.mkdir(uniqueFolder, { recursive: true });
            await fs.promises.writeFile(path.join(uniqueFolder, 'index.html'), fileContent, 'utf8');
            targetPath = uniqueFolder;
            break;
          }
          case 'convert-html-p': {
            const txtContent = await fs.promises.readFile(file.absolutePath, 'utf8');
            const fileContent = convertPlaintextToHtml(txtContent, 'p', cssText);
            const desiredFolder = path.join(targetSubDir, relBase);
            const uniqueFolder = await getUniqueNotePath(desiredFolder);
            if (uniqueFolder === null) {
              errors.push({ relativePath: file.relativePath, error: `Could not find unique name for "${relBase}" (99 variants exist)` });
              continue;
            }
            await fs.promises.mkdir(uniqueFolder, { recursive: true });
            await fs.promises.writeFile(path.join(uniqueFolder, 'index.html'), fileContent, 'utf8');
            targetPath = uniqueFolder;
            break;
          }
          case 'copy': {
            const fileContent = await fs.promises.readFile(file.absolutePath);
            const desiredPath = path.join(targetSubDir, relName);
            const uniquePath = await getUniqueFilePath(desiredPath);
            if (uniquePath === null) {
              errors.push({ relativePath: file.relativePath, error: `Could not find unique filename for "${relName}" (99 variants exist)` });
              continue;
            }
            await fs.promises.writeFile(uniquePath, fileContent);
            targetPath = uniquePath;
            break;
          }
          default:
            skipped.push(file.relativePath);
            continue;
        }

        imported.push({ relativePath: file.relativePath, targetPath });
        processed++;
        emitter.emit('progress', { processed, total, currentFile: file.relativePath });

      } catch (err) {
        errors.push({ relativePath: file.relativePath, error: err.message });
      }
    }

    if (cancelled) {
      const remaining = files.length - imported.length - skipped.length - errors.length;
      emitter.emit('cancelled', { imported, skipped, errors, remaining });
    } else {
      emitter.emit('done', { imported, skipped, errors });
    }
  });

  return emitter;
}

module.exports = { scanFolder, scanFiles, executeBatchImport, classifyFile, humanFileSize };
