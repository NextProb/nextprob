'use strict';

const fs = require('fs');
const path = require('path');
const { getUniqueFilePath, getUniqueNotePath } = require('./markdown-import');

/**
 * Encodes HTML entities in a plain text string.
 * & must be first to avoid double-encoding.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Detects binary content by scanning the first 8192 bytes for null bytes.
 * Same heuristic used by Git and most text editors.
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function isBinaryContent(buffer) {
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Converts plain text content to a full HTML document.
 *
 * @param {string} txtContent  - decoded UTF-8 text
 * @param {'pre'|'p'} mode     - wrapping mode
 * @param {string} cssText     - NOTE_CSS stylesheet content
 * @returns {string}           - complete HTML document string
 */
function convertPlaintextToHtml(txtContent, mode, cssText) {
  let bodyContent;

  if (mode === 'pre') {
    bodyContent = `<pre>${escapeHtml(txtContent)}</pre>`;
  } else {
    // 'p' mode: normalize line endings, split on double newlines, convert
    // single newlines to <br> within each paragraph
    const normalized = txtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const trimmed = normalized.replace(/\n+$/, ''); // strip trailing newlines
    const paragraphs = trimmed.split(/\n{2,}/);
    if (paragraphs.length === 0 || (paragraphs.length === 1 && paragraphs[0] === '')) {
      bodyContent = '';
    } else {
      bodyContent = paragraphs
        .map(para => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
        .join('\n');
    }
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${cssText}</style>
</head>
<body>
${bodyContent}
</body>
</html>`;
}

/**
 * Imports a batch of plain text files into a target directory.
 *
 * @param {string[]} filePaths        - absolute paths to source .txt files
 * @param {string}   targetDir        - absolute path to destination folder in workspace
 * @param {'pre'|'p'|'txt'} mode      - conversion mode
 * @param {string}   cssText          - NOTE_CSS content (used only for 'pre' and 'p' modes)
 * @returns {Promise<{ imported: Array<{sourcePath, targetPath, targetName}>, errors: Array<{sourcePath, error}> }>}
 */
async function importPlaintextFiles(filePaths, targetDir, mode, cssText) {
  const imported = [];
  const errors = [];

  for (const sourcePath of filePaths) {
    try {
      let buffer;
      try {
        buffer = await fs.promises.readFile(sourcePath);
      } catch (err) {
        errors.push({ sourcePath, error: `Could not read file: ${err.message}` });
        continue;
      }

      if (isBinaryContent(buffer)) {
        errors.push({ sourcePath, error: 'File appears to be binary, not plain text' });
        continue;
      }

      const txtContent = buffer.toString('utf8');
      const baseName = path.basename(sourcePath, path.extname(sourcePath));

      if (mode === 'txt') {
        // Copy as .txt file (no folder)
        const targetName = baseName + '.txt';
        const desiredPath = path.join(targetDir, targetName);
        const uniquePath = await getUniqueFilePath(desiredPath);

        if (uniquePath === null) {
          errors.push({ sourcePath, error: `Could not find a unique filename for "${targetName}" (99 variants already exist)` });
          continue;
        }

        await fs.promises.writeFile(uniquePath, txtContent, 'utf8');
        imported.push({
          sourcePath,
          targetPath: uniquePath,
          targetName: path.basename(uniquePath),
        });
      } else {
        // Create a note folder: {baseName}/index.html
        const fileContent = convertPlaintextToHtml(txtContent, mode, cssText);
        const desiredFolder = path.join(targetDir, baseName);
        const uniqueFolder = await getUniqueNotePath(desiredFolder);

        if (uniqueFolder === null) {
          errors.push({ sourcePath, error: `Could not find a unique name for "${baseName}" (99 variants already exist)` });
          continue;
        }

        await fs.promises.mkdir(uniqueFolder, { recursive: true });
        await fs.promises.writeFile(path.join(uniqueFolder, 'index.html'), fileContent, 'utf8');
        imported.push({
          sourcePath,
          targetPath: uniqueFolder,
          targetName: path.basename(uniqueFolder),
        });
      }
    } catch (err) {
      errors.push({ sourcePath, error: err.message });
    }
  }

  return { imported, errors };
}

module.exports = { importPlaintextFiles, convertPlaintextToHtml, escapeHtml, isBinaryContent };
