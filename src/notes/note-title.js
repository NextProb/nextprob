'use strict';

const fs = require('fs');
const path = require('path');

// Skip comments and raw script/style text when inspecting HTML metadata.
const HTML_TOKENS = /<!--[\s\S]*?-->|<(script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*?>[\s\S]*?<\/\1\s*>|<title\b[^>]*>[\s\S]*?<\/title\s*>|<[a-z](?:"[^"]*"|'[^']*'|[^'">])*>/gi;
const TITLE_ATTRIBUTE = /(\s)data-title\s*=\s*(["'])([\s\S]*?)\2/i;
function markupTokens(html) {
  return [...html.matchAll(HTML_TOKENS)].filter(match => !/^(?:<!--|<(?:script|style)\b)/i.test(match[0]));
}

function decodeTitle(value) {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: '\u00a0' };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()];
    const number = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
  });
}

function extractTitle(filePath, fallback = path.basename(filePath).replace(/\.html?$/i, '')) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const token of markupTokens(content)) {
      const explicit = token[0].match(TITLE_ATTRIBUTE);
      if (explicit && explicit[3].trim()) return decodeTitle(explicit[3]);
    }
    for (const pattern of [/<title\b[^>]*>([\s\S]*?)<\/title>/i, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i, /<h[2-6]\b[^>]*>([\s\S]*?)<\/h[2-6]>/i]) {
      const match = content.match(pattern);
      const title = match && decodeTitle(match[1].replace(/<[^>]*>/g, '')).trim();
      if (title) return title;
    }
  } catch {}
  return fallback;
}

// Store an explicit display title without changing headings, links, or file identity.
function renameNoteTitle(workspacePath, notePath, title) {
  if (typeof title !== 'string' || !title.trim()) throw new Error('A note title is required');
  title = title.trim();
  const root = fs.realpathSync(workspacePath);
  let target = fs.realpathSync(notePath);
  const inside = candidate => candidate.startsWith(root + path.sep);
  if (!inside(target)) throw new Error('Path is outside workspace');
  if (fs.statSync(target).isDirectory()) target = fs.realpathSync(path.join(target, 'index.html'));
  if (!inside(target)) throw new Error('Path is outside workspace');
  if (!/\.html?$/i.test(target) || !fs.statSync(target).isFile()) throw new Error('Choose an HTML note');
  const escaped = title.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  let html = fs.readFileSync(target, 'utf8');
  const tokens = markupTokens(html);
  const explicit = tokens.find(token => TITLE_ATTRIBUTE.test(token[0]));
  const container = explicit || tokens.find(token => /^<html\b/i.test(token[0]))
    || tokens.find(token => /^<body\b/i.test(token[0]));
  // Apply edits backwards so earlier offsets remain valid.
  const edits = [];
  for (const token of tokens) {
    let replacement = token[0];
    if (token === container) {
      replacement = explicit
        ? replacement.replace(TITLE_ATTRIBUTE, (_match, space) => `${space}data-title="${escaped}"`)
        : replacement.replace(/^(<[a-z]+)/i, (_match, tag) => `${tag} data-title="${escaped}"`);
    }
    if (/^<title\b/i.test(replacement)) {
      replacement = replacement.replace(/(>)[\s\S]*?(<\/title\s*>)/i, (_match, open, close) => open + escaped + close);
    }
    if (replacement !== token[0]) edits.push({ start: token.index, end: token.index + token[0].length, replacement });
  }
  for (const edit of edits.reverse()) html = html.slice(0, edit.start) + edit.replacement + html.slice(edit.end);
  if (!container) {
    const doctype = html.match(/^\s*<!doctype[^>]*>/i);
    const offset = doctype ? doctype[0].length : 0;
    html = html.slice(0, offset) + `\n<meta data-title="${escaped}">\n` + html.slice(offset);
  }
  fs.writeFileSync(target, html, 'utf8');
  return title;
}

module.exports = { extractTitle, renameNoteTitle };
