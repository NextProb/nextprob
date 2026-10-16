'use strict';

/**
 * Parses a raw search query string into structured components.
 *
 * Supported operators:
 *   "exact phrase"  → exact token-sequence match
 *   -word           → exclude notes containing this word
 *   type:ext        → filter results to the given file extension
 *
 * @param {string} rawQuery
 * @returns {{
 *   phrases: string[],
 *   terms: string[],
 *   exclusions: string[],
 *   types: string[],
 *   raw: string
 * }}
 */
function parseSearchQuery(rawQuery) {
  const result = { phrases: [], terms: [], exclusions: [], types: [], raw: rawQuery };
  if (!rawQuery || !rawQuery.trim()) return result;

  // Normalize curly/smart quotes to straight double quotes
  let q = rawQuery.replace(/[\u201C\u201D]/g, '"');

  // Extract quoted phrases first (greedy left-to-right, handle unmatched quote)
  let remaining = '';
  let i = 0;
  while (i < q.length) {
    if (q[i] === '"') {
      const close = q.indexOf('"', i + 1);
      if (close === -1) {
        // Unmatched quote: treat rest as plain text
        remaining += q.slice(i + 1);
        break;
      }
      const phrase = q.slice(i + 1, close).trim();
      if (phrase) result.phrases.push(phrase);
      i = close + 1;
    } else {
      remaining += q[i];
      i++;
    }
  }

  // Tokenize the non-phrase remainder on whitespace
  const tokens = remaining.trim().split(/\s+/).filter(Boolean);

  const typeAliases = {
    'markdown': 'md',
    'text': 'txt',
  };

  for (const token of tokens) {
    // Exclusion: hyphen immediately followed by a word (no space between)
    if (/^-\S+$/.test(token)) {
      const word = token.slice(1);
      if (word) result.exclusions.push(word);
      continue;
    }

    // Type filter: case-insensitive "type:" prefix
    const typeMatch = token.match(/^type:(.+)$/i);
    if (typeMatch) {
      const ext = typeMatch[1].toLowerCase().replace(/^\./, '');
      if (ext) result.types.push(typeAliases[ext] || ext);
      continue;
    }

    // Plain positive term (skip bare "-" or "type:" with no value)
    if (token !== '-' && !/^type:$/i.test(token)) {
      result.terms.push(token);
    }
  }

  return result;
}

module.exports = { parseSearchQuery };
