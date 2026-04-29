'use strict';

const fs = require('fs');
const path = require('path');
const { parseMdFrontMatter, parseYamlTags, formatTags } = require('./tags');

// Cached marked instance (lazy initialized)
let _markedInstance = null;

/**
 * Lazily imports and configures `marked` (ESM-only in v17+).
 * Caches the instance after the first call.
 * @returns {Promise<import('marked').Marked>}
 */
async function initMarked() {
  if (_markedInstance) return _markedInstance;
  const { marked } = await import('marked');
  marked.use({ gfm: true, breaks: true });
  _markedInstance = marked;
  return marked;
}

/**
 * Converts Markdown content to a full HTML document string.
 * YAML frontmatter (between --- delimiters) is preserved as an HTML comment
 * and its `tags` field is stored as <meta name="tags">.
 *
 * @param {string} mdContent   - raw Markdown file content
 * @param {string} cssText     - NOTE_CSS stylesheet text
 * @returns {Promise<string>}  - complete HTML document string
 */
async function convertMarkdownToHtml(mdContent, cssText) {
  const marked = await initMarked();

  let body = mdContent;
  let fmComment = '';
  let tagsMetaTag = '';

  const parsed = parseMdFrontMatter(mdContent);
  if (parsed) {
    body = parsed.body;
    // Preserve frontmatter as HTML comment
    fmComment = `<!-- frontmatter\n${parsed.fm}-->\n`;
    // Extract tags for <meta>
    const tags = parseYamlTags(parsed.fm);
    if (tags.length > 0) {
      const tagsStr = formatTags(tags);
      tagsMetaTag = `\n  <meta name="tags" content="${escapeAttr(tagsStr)}">`;
    }
  }

  const htmlBody = marked.parse(body);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">${tagsMetaTag}
  <style>${cssText}</style>
</head>
<body>
${fmComment}${htmlBody}</body>
</html>`;
}

/**
 * Escapes a string for use as an HTML attribute value (double-quoted).
 * @param {string} str
 * @returns {string}
 */
function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Returns a file path that does not yet exist on disk.
 * If targetPath exists, tries targetPath with -1, -2, … -99 inserted before
 * the file extension. Returns null if all 99 suffixes are taken.
 *
 * @param {string} targetPath - desired absolute file path
 * @returns {Promise<string|null>}
 */
async function getUniqueFilePath(targetPath) {
  const exists = async (p) => {
    try { await fs.promises.access(p); return true; } catch { return false; }
  };

  if (!(await exists(targetPath))) return targetPath;

  const ext = path.extname(targetPath);
  const base = targetPath.slice(0, targetPath.length - ext.length);

  for (let i = 1; i <= 99; i++) {
    const candidate = `${base}-${i}${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
  return null; // all 99 suffixes taken
}

/**
 * Returns a folder path that does not yet exist on disk.
 * If targetFolder exists, tries targetFolder-1, targetFolder-2, … -99.
 * Returns null if all 99 suffixes are taken.
 *
 * @param {string} targetFolder - desired absolute folder path (no extension)
 * @returns {Promise<string|null>}
 */
async function getUniqueNotePath(targetFolder) {
  const exists = async (p) => {
    try { await fs.promises.access(p); return true; } catch { return false; }
  };

  if (!(await exists(targetFolder))) return targetFolder;

  for (let i = 1; i <= 99; i++) {
    const candidate = `${targetFolder}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  return null;
}

/**
 * Imports a batch of Markdown files into a target directory.
 *
 * @param {string[]} filePaths   - absolute paths to source .md files
 * @param {string}   targetDir   - absolute path to destination folder in workspace
 * @param {'html'|'markdown'} mode  - 'html' to convert, 'markdown' to copy as-is
 * @param {string}   cssText     - NOTE_CSS content (used only when mode='html')
 * @returns {Promise<{ imported: Array<{sourcePath, targetPath, targetName}>, errors: Array<{sourcePath, error}> }>}
 */
async function importMarkdownFiles(filePaths, targetDir, mode, cssText) {
  const imported = [];
  const errors = [];

  for (const sourcePath of filePaths) {
    try {
      let content;
      try {
        content = await fs.promises.readFile(sourcePath, 'utf8');
      } catch (err) {
        errors.push({ sourcePath, error: `Could not read file: ${err.message}` });
        continue;
      }

      const baseName = path.basename(sourcePath, path.extname(sourcePath));

      if (mode === 'html') {
        // Create a note folder: {baseName}/index.html
        const fileContent = await convertMarkdownToHtml(content, cssText);
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
      } else {
        // Copy as .md file (no folder)
        const targetName = baseName + '.md';
        const desiredPath = path.join(targetDir, targetName);
        const uniquePath = await getUniqueFilePath(desiredPath);

        if (uniquePath === null) {
          errors.push({ sourcePath, error: `Could not find a unique filename for "${targetName}" (99 variants already exist)` });
          continue;
        }

        await fs.promises.writeFile(uniquePath, content, 'utf8');
        imported.push({
          sourcePath,
          targetPath: uniquePath,
          targetName: path.basename(uniquePath),
        });
      }
    } catch (err) {
      errors.push({ sourcePath, error: err.message });
    }
  }

  return { imported, errors };
}

module.exports = { importMarkdownFiles, convertMarkdownToHtml, getUniqueFilePath, getUniqueNotePath };
