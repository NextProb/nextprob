'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Tags Storage Convention
 * =======================
 *
 * HTML notes (.html)
 * ------------------
 * Tags are stored as a <meta> element inside an optional <head> section
 * that precedes the <article> fragment:
 *
 *   <head><meta name="tags" content="tag1, tag2, tag3"></head>
 *   <article class="note" data-title="..." data-created="...">
 *     ...
 *   </article>
 *
 * - Only the FIRST <meta name="tags"> element is authoritative when duplicates
 *   exist. The parser (feature 88) should log a warning for duplicates.
 * - An absent <meta name="tags"> element or an empty content="" both mean
 *   "no tags" — never an error.
 * - The <head> section is invisible when the fragment is rendered.
 *
 * Markdown notes (.md)
 * --------------------
 * Tags are stored in YAML front-matter under a `tags` key:
 *
 *   ---
 *   tags: [idea, reference]
 *   ---
 *
 * Both YAML list syntax (tags: [a, b]) and comma-separated scalar
 * (tags: "a, b") are supported. An absent `tags` key means "no tags".
 *
 * Tag naming rules
 * ----------------
 * - Allowed characters: letters (a–z, A–Z), digits (0–9), hyphens (-),
 *   underscores (_).
 * - Tag names MUST start with a letter or digit (not a hyphen/underscore).
 * - No spaces within a single tag; multi-word tags use hyphens (project-alpha).
 * - Matching is case-insensitive; original casing is preserved when stored.
 * - An empty string is not a valid tag name.
 *
 * Content attribute format
 * ------------------------
 * Tags in the HTML <meta> content attribute are comma-separated with a single
 * space after each comma:  "work, draft, project-alpha"
 * Splitting: split on the pattern \s*,\s* and discard empty entries.
 */

const TAG_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/**
 * Returns true if `name` is a valid tag name.
 * Valid: starts with letter or digit, followed by letters/digits/hyphens/underscores.
 * @param {string} name
 * @returns {boolean}
 */
function isValidTagName(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  return TAG_RE.test(name);
}

/**
 * Sanitizes a raw tag name into a valid tag name.
 * Steps:
 *   1. Trim whitespace.
 *   2. Convert to lowercase.
 *   3. Replace spaces (and runs of spaces) with hyphens.
 *   4. Remove characters outside [a-z0-9_-].
 *   5. Collapse consecutive hyphens into one.
 *   6. Strip leading/trailing hyphens and underscores.
 * Returns an empty string if nothing valid remains.
 * @param {string} name
 * @returns {string}
 */
function sanitizeTagName(name) {
  if (typeof name !== 'string') return '';
  let s = name.trim().toLowerCase();
  s = s.replace(/\s+/g, '-');
  s = s.replace(/[^a-z0-9_-]/g, '');
  s = s.replace(/-{2,}/g, '-');
  s = s.replace(/^[-_]+|[-_]+$/g, '');
  return s;
}

/**
 * Parses the value of a <meta name="tags" content="..."> attribute (or any
 * comma-separated tag string) into an array of trimmed, non-empty tag names.
 * Does NOT validate tag names — that is the caller's responsibility.
 * @param {string} contentString  e.g. "work, draft, "
 * @returns {string[]}            e.g. ["work", "draft"]
 */
function parseTags(contentString) {
  if (typeof contentString !== 'string' || contentString.trim() === '') return [];
  return contentString
    .split(/\s*,\s*/)
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

/**
 * Joins an array of tag names into a comma-separated string suitable for
 * use as the `content` attribute value of <meta name="tags">.
 * @param {string[]} tagsArray  e.g. ["work", "draft"]
 * @returns {string}            e.g. "work, draft"
 */
function formatTags(tagsArray) {
  if (!Array.isArray(tagsArray)) return '';
  return tagsArray.filter(t => typeof t === 'string' && t.length > 0).join(', ');
}

// ─── Internal helpers (not exported) ─────────────────────────────────────────

/** Strips UTF-8 BOM (\uFEFF) from the start of a string if present. */
function stripBom(str) {
  return str.charCodeAt(0) === 0xFEFF ? str.slice(1) : str;
}

/**
 * Atomically writes `content` to `filePath` by writing to a `.tmp` file first,
 * then renaming. Avoids data loss if the process crashes mid-write.
 * @param {string} filePath
 * @param {string} content
 * @returns {Promise<void>}
 */
async function atomicWriteFile(filePath, content) {
  const tmpPath = filePath + '.tmp';
  await fs.promises.writeFile(tmpPath, content, 'utf8');
  await fs.promises.rename(tmpPath, filePath);
}

// Regex pair for <meta name="tags" content="..."> — handles both attribute orders.
// Group 1 always captures the content value.
const HTML_META_NC_RE = /<meta\s+name=["']tags["']\s+content=["']([\s\S]*?)["']\s*\/?>/i;
const HTML_META_CN_RE = /<meta\s+content=["']([\s\S]*?)["']\s+name=["']tags["']\s*\/?>/i;

/**
 * Finds all <meta name="tags"> elements (both attribute orders) in `content`,
 * sorted by position. Returns the array (may be empty).
 * @param {string} content
 * @returns {RegExpMatchArray[]}
 */
function findAllHtmlMetaMatches(content) {
  const allNC = [...content.matchAll(/<meta\s+name=["']tags["']\s+content=["']([\s\S]*?)["']\s*\/?>/gi)];
  const allCN = [...content.matchAll(/<meta\s+content=["']([\s\S]*?)["']\s+name=["']tags["']\s*\/?>/gi)];
  return [...allNC, ...allCN].sort((a, b) => a.index - b.index);
}

/**
 * Replaces the first <meta name="tags"> element (either order) with `replacement`.
 * If no such element exists, returns `content` unchanged.
 * @param {string} content
 * @param {string} replacement  New element string, or '' to remove.
 * @returns {string}
 */
function replaceFirstHtmlMeta(content, replacement) {
  const matches = findAllHtmlMetaMatches(content);
  if (matches.length === 0) return content;
  const m = matches[0];
  return content.slice(0, m.index) + replacement + content.slice(m.index + m[0].length);
}

/**
 * Parses the `tags` key from a YAML front-matter body string.
 * Supports: inline list [a, b], quoted scalar "a, b" / 'a, b',
 * bare scalar a, b, and YAML block list (- item lines).
 * @param {string} fm  Front-matter body (text between the two --- delimiters).
 * @returns {string[]}
 */
function parseYamlTags(fm) {
  const lineMatch = /^tags:[ \t]*(.*)/m.exec(fm);
  if (!lineMatch) return [];
  const value = lineMatch[1].trim();

  // Inline list: tags: [a, b, c]
  if (value.startsWith('[') && value.includes(']')) {
    const inner = value.slice(value.indexOf('[') + 1, value.lastIndexOf(']'));
    return parseTags(inner);
  }

  // Quoted scalar: tags: "a, b" or tags: 'a, b'
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return parseTags(value.slice(1, -1));
  }

  // Empty value — check for YAML block list (indented - item lines)
  if (value === '') {
    const afterTagsLine = fm.slice(lineMatch.index + lineMatch[0].length);
    const items = [];
    for (const line of afterTagsLine.split('\n')) {
      const blockMatch = /^[ \t]+-[ \t]+(.+)/.exec(line);
      if (blockMatch) {
        items.push(blockMatch[1].trim());
      } else if (line.trim() !== '') {
        break; // non-empty, non-list line → end of block
      }
    }
    if (items.length > 0) return items;
    return [];
  }

  // Bare scalar: tags: a, b, c
  return parseTags(value);
}

/**
 * Splits Markdown file content into front-matter body and document body.
 * @param {string} content
 * @returns {{ fm: string, body: string } | null}  null if no valid front-matter.
 */
function parseMdFrontMatter(content) {
  if (!content.startsWith('---\n')) return null;
  // Find closing --- on its own line, starting search after the opening ---
  const closeRe = /\n---(?:\n|$)/g;
  closeRe.lastIndex = 3;
  const closeMatch = closeRe.exec(content);
  if (!closeMatch) return null;
  // fm: text between the two --- lines (includes trailing \n before closing ---)
  const fm = content.slice(4, closeMatch.index + 1);
  // body: everything after the closing ---\n
  const body = content.slice(closeMatch.index + closeMatch[0].length);
  return { fm, body };
}

/**
 * Reads the file at `filePath` and returns its tags as a normalized array.
 * Supports .html (reads <meta name="tags" content="...">) and
 * .md (reads YAML front-matter `tags:` key).
 * Returns [] for unsupported types, missing metadata, or unreadable files.
 * @param {string} filePath
 * @returns {Promise<string[]>}
 */
async function parseTagsFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.html' && ext !== '.md') return [];

  let content;
  try {
    content = stripBom(await fs.promises.readFile(filePath, 'utf8'));
  } catch {
    return [];
  }

  if (ext === '.html') {
    const matches = findAllHtmlMetaMatches(content);
    if (matches.length === 0) return [];
    if (matches.length > 1) {
      console.warn(`[tags] Warning: ${filePath} has ${matches.length} <meta name="tags"> elements; using the first.`);
    }
    return parseTags(matches[0][1]);
  }

  // .md
  const parsed = parseMdFrontMatter(content);
  if (!parsed) return [];
  return parseYamlTags(parsed.fm);
}

/**
 * Inserts or updates the tags metadata in the file at `filePath`.
 * Preserves all other file content. Writes are atomic (temp file + rename).
 *
 * HTML files: manages <meta name="tags" content="..."> inside <head>.
 *   - Has existing meta: replaces it (or removes it when tags is []).
 *   - Has <head> but no meta: inserts meta before </head> (no-op if tags is []).
 *   - No <head>: prepends <head>...</head> block (no-op if tags is []).
 *   - Empty tags + existing meta: removes meta; also removes <head> if it becomes empty.
 *
 * Markdown files: manages the `tags:` key in YAML front-matter.
 *   - Has front-matter with tags key: replaces it (or removes it when tags is []).
 *   - Has front-matter without tags key: appends tags line (no-op if tags is []).
 *   - No front-matter: prepends ---\ntags: [...]\n---\n (no-op if tags is []).
 *   - Removing tags key leaves empty front-matter: removes front-matter entirely.
 *
 * Unsupported file types (.txt, etc.): no-op.
 * @param {string} filePath
 * @param {string[]} tags
 * @returns {Promise<void>}
 */
async function writeTagsToFile(filePath, tags) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.html' && ext !== '.md') return;

  let content;
  try {
    content = stripBom(await fs.promises.readFile(filePath, 'utf8'));
  } catch {
    return;
  }

  const formatted = formatTags(tags);

  if (ext === '.html') {
    const matches = findAllHtmlMetaMatches(content);
    const hasExistingMeta = matches.length > 0;
    const hasHead = /<head/i.test(content);
    const newMeta = `<meta name="tags" content="${formatted}">`;

    if (hasExistingMeta) {
      if (tags.length === 0) {
        // Remove the meta element
        content = replaceFirstHtmlMeta(content, '');
        // Remove <head>...</head> wrapper if now empty (only whitespace inside)
        content = content.replace(/<head>\s*<\/head>\n?/i, '');
      } else {
        // Replace the meta element
        content = replaceFirstHtmlMeta(content, newMeta);
      }
    } else if (hasHead) {
      if (tags.length > 0) {
        // Insert before </head>
        content = content.replace(/<\/head>/i, `${newMeta}\n</head>`);
      }
      // else: no-op
    } else {
      if (tags.length > 0) {
        // Prepend a new <head> block
        content = `<head>${newMeta}</head>\n` + content;
      }
      // else: no-op
    }

    await atomicWriteFile(filePath, content);
    return;
  }

  // .md
  const parsed = parseMdFrontMatter(content);

  if (!parsed) {
    // No front-matter
    if (tags.length > 0) {
      content = `---\ntags: [${formatted}]\n---\n` + content;
      await atomicWriteFile(filePath, content);
    }
    return;
  }

  let { fm, body } = parsed;

  // Regex: matches `tags:` line + any following block-list items, plus trailing \n
  const tagsKeyRe = /^tags:[ \t][^\n]*(?:\n[ \t]+-[ \t]+[^\n]*)*/m;
  const tagsMatch = tagsKeyRe.exec(fm);

  if (tagsMatch) {
    if (tags.length === 0) {
      // Remove the tags line (tagsMatch[0]) and the newline after it (+1)
      let newFm = fm.slice(0, tagsMatch.index) + fm.slice(tagsMatch.index + tagsMatch[0].length + 1);
      if (newFm.trim() === '') {
        // Front-matter is now empty — remove it entirely
        content = body.replace(/^\n/, '');
      } else {
        content = `---\n${newFm}---\n` + body;
      }
    } else {
      // Replace the tags line (preserve rest of front-matter)
      const newFm =
        fm.slice(0, tagsMatch.index) +
        `tags: [${formatted}]` + '\n' +
        fm.slice(tagsMatch.index + tagsMatch[0].length + 1);
      content = `---\n${newFm}---\n` + body;
    }
  } else {
    // Front-matter exists but has no tags key
    if (tags.length > 0) {
      const newFm = fm + `tags: [${formatted}]\n`;
      content = `---\n${newFm}---\n` + body;
    } else {
      return; // no-op
    }
  }

  await atomicWriteFile(filePath, content);
}

module.exports = { isValidTagName, sanitizeTagName, parseTags, formatTags, parseTagsFromFile, writeTagsToFile, parseMdFrontMatter, parseYamlTags };
