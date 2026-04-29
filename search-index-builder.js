'use strict';

const path = require('path');
const fs = require('fs');
const searchIndex = require('./search-index');

// ─── Constants ────────────────────────────────────────────────────────────────

// Must mirror main.js IGNORED_DIRS. Kept in sync manually. _templates added for feature 111.
const IGNORED_DIRS = new Set(['.git', '.claude', 'node_modules', '.DS_Store', '.Trash', '.vscode', '.notes-app', '_templates', 'storage']);
const SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB — skip files larger than this
const BATCH_SIZE = 20;               // files processed per event-loop tick
const INDEXABLE_EXTS = new Set(['.html', '.md', '.txt']);

// ─── Text extraction helpers ──────────────────────────────────────────────────

function stripHtmlTags(str) {
  return str.replace(/<[^>]*>/g, ' ');
}

function stripMarkdown(text) {
  return text
    // Remove code fences (keep inner text)
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, '').replace(/```/g, ''))
    // Remove inline code (keep inner text)
    .replace(/`([^`]+)`/g, '$1')
    // Remove images (keep alt text)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Remove links (keep link text)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Remove heading markers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic markers
    .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, '$2')
    // Remove blockquote markers
    .replace(/^>\s?/gm, '')
    // Remove unordered list markers
    .replace(/^[\t ]*[-*+]\s+/gm, '')
    // Remove ordered list markers
    .replace(/^[\t ]*\d+\.\s+/gm, '')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Strip any remaining HTML tags
    .replace(/<[^>]*>/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract a human-readable title from file content.
 * Does not read the file — caller passes content.
 */
function extractTitleFromContent(content, filePath, ext) {
  if (ext === '.html') {
    const dataTitle = content.match(/data-title="([^"]+)"/);
    if (dataTitle) return dataTitle[1];
    const tryExtract = (regex) => {
      const m = content.match(regex);
      if (!m) return null;
      const text = stripHtmlTags(m[1]).trim();
      return text || null;
    };
    return tryExtract(/<title[^>]*>([\s\S]*?)<\/title>/i)
        || tryExtract(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
        || tryExtract(/<h[2-6][^>]*>([\s\S]*?)<\/h[2-6]>/i)
        || path.basename(filePath, ext);
  }
  if (ext === '.md') {
    const m = content.match(/^#\s+(.+)$/m);
    return m ? m[1].trim() : path.basename(filePath, ext);
  }
  // .txt — use filename
  return path.basename(filePath, ext);
}

/**
 * Extract plain-text body from file content for indexing.
 */
function extractBodyFromContent(content, ext) {
  if (ext === '.html') {
    let text = stripHtmlTags(content).replace(/\s+/g, ' ').trim();
    // Decode HTML entities once to match browser rendering
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
    return text;
  }
  if (ext === '.md') {
    return stripMarkdown(content);
  }
  // .txt — content is already plain text
  return content.trim();
}

/**
 * If the given file path is `index.html` inside a directory,
 * return the parent directory path (the note folder path).
 * Otherwise return the file path unchanged.
 */
function toNoteCanonicalPath(filePath) {
  return path.basename(filePath) === 'index.html'
    ? path.dirname(filePath)
    : filePath;
}

// ─── File enumeration ─────────────────────────────────────────────────────────

/**
 * Recursively collect all indexable files under wsPath.
 * Returns array of { fullPath, mtimeMs, ext }.
 * Skips: IGNORED_DIRS, hidden names (start with '.'), files > SIZE_LIMIT,
 * and non-indexable extensions.
 */
function collectFiles(wsPath) {
  const result = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // Permission error or deleted dir — skip silently
    }

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        // Skip memory.md inside note folders (AI context metadata, not user content)
        if (entry.name === 'memory.md' && fs.existsSync(path.join(dir, 'index.html'))) continue;

        const ext = path.extname(entry.name).toLowerCase();
        if (!INDEXABLE_EXTS.has(ext)) continue;

        let stat;
        try { stat = fs.statSync(fullPath); } catch { continue; }
        if (stat.size > SIZE_LIMIT) continue;

        result.push({ fullPath, mtimeMs: stat.mtimeMs, ext });
      }
    }
  }

  walk(wsPath);
  return result;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Build or incrementally update the search index for the given workspace.
 *
 * The caller MUST call searchIndex.init(wsPath) before calling buildIndex().
 * buildIndex() assumes the index is already initialized.
 *
 * @param {string} wsPath - Absolute path to the workspace root.
 * @param {object} [options]
 * @param {function(current: number, total: number): void} [options.onProgress]
 *   Called after each batch with cumulative progress. total = toIndex + toRemove.
 *   Called with (0, 0) if there is nothing to do.
 * @param {AbortSignal} [options.signal] - If aborted, stops between batches.
 * @returns {Promise<{ indexed: number, skipped: number, removed: number, elapsed: number }>}
 */
async function buildIndex(wsPath, options = {}) {
  const { onProgress, signal } = options;
  const startTime = Date.now();

  // Step B: Enumerate files on disk
  const files = collectFiles(wsPath);

  // Step C: Compare against indexed mtimes to determine work
  const indexedMtimes = searchIndex.getIndexedMtimes();
  const indexedPaths = new Set(indexedMtimes.keys());
  // Use canonical paths for comparison (folder path for index.html, file path otherwise)
  const diskCanonicalPaths = new Set(files.map(f => toNoteCanonicalPath(f.fullPath)));

  const toIndex = files.filter(({ fullPath, mtimeMs }) => {
    const canonicalPath = toNoteCanonicalPath(fullPath);
    const stored = indexedMtimes.get(canonicalPath);
    // Index if new (not in index) or if mtime changed
    return stored === undefined || stored !== mtimeMs;
  });

  const toRemove = [...indexedPaths].filter(p => !diskCanonicalPaths.has(p));
  const skipped = files.length - toIndex.length;
  const total = toIndex.length + toRemove.length;

  let processed = 0;

  // Step D: Remove orphan entries (deleted files still in index)
  for (const filePath of toRemove) {
    searchIndex.remove(filePath);
    processed++;
    onProgress?.(processed, total);
  }

  // Step E: Extract text and index in batches, yielding between each batch
  let indexed = 0;

  for (let i = 0; i < toIndex.length; i += BATCH_SIZE) {
    if (signal?.aborted) break;

    const batch = toIndex.slice(i, i + BATCH_SIZE);

    for (const { fullPath, mtimeMs, ext } of batch) {
      let content;
      try {
        content = fs.readFileSync(fullPath, 'utf8');
      } catch {
        // Binary file, encoding error, or race-condition deletion — skip
        processed++;
        continue;
      }

      const title = extractTitleFromContent(content, fullPath, ext);
      const body = extractBodyFromContent(content, ext);
      const canonicalPath = toNoteCanonicalPath(fullPath);
      searchIndex.add(canonicalPath, title, body, mtimeMs);
      indexed++;
      processed++;
    }

    onProgress?.(processed, total);

    // Yield to the event loop so IPC and other callbacks remain responsive
    await new Promise(r => setImmediate(r));
  }

  return {
    indexed,
    skipped,
    removed: toRemove.length,
    elapsed: Date.now() - startTime,
  };
}

module.exports = { buildIndex, collectFiles, extractTitleFromContent, extractBodyFromContent, toNoteCanonicalPath, INDEXABLE_EXTS, SIZE_LIMIT };
