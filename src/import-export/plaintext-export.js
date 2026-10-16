'use strict';

const { registerConverter } = require('./export');

// ─── Helper: Extract <body> content ──────────────────────────────────────────

function extractBody(html) {
  const m = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return m ? m[1] : html;
}

// ─── Helper: Remove invisible content ────────────────────────────────────────

function removeInvisible(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<head\b[\s\S]*?<\/head>/gi, '');
}

// ─── Helper: Handle images ───────────────────────────────────────────────────

function convertImages(html) {
  return html.replace(/<img\b[^>]*>/gi, (m) => {
    const altMatch = m.match(/\balt=(?:"([^"]*?)"|'([^']*?)')/i);
    if (altMatch) {
      const alt = (altMatch[1] !== undefined ? altMatch[1] : altMatch[2]).trim();
      if (alt) return alt;
    }
    return '';
  });
}

// ─── Helper: Convert lists ───────────────────────────────────────────────────

// Processes lists from innermost to outermost (iterative).
// Each pass finds lists that contain no nested <ol>/<ul>, converts them,
// then the next pass handles the now-innermost outer lists.
// Nesting indentation: already-converted inner list lines are indented
// by 2 spaces (ul) or 3 spaces (ol) via replace(/\n/g, '\n  ') on the
// trimmed inner content.

function convertLists(html) {
  let result = html;
  for (let pass = 0; pass < 20; pass++) {
    const before = result;

    // Innermost <ol>: content contains no <ol> or <ul> open tags
    result = result.replace(
      /<ol\b[^>]*>((?:(?!<(?:ol|ul)\b)[\s\S])*?)<\/ol>/gi,
      (_, content) => {
        let n = 0;
        const body = content.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (__, inner) => {
          n++;
          const trimmed = inner.trim();
          // Indent continuation lines (from a nested list already converted)
          const indented = trimmed.replace(/\n/g, '\n   ');
          return `\n${n}. ${indented}`;
        });
        return '\n\n' + body.trim() + '\n\n';
      }
    );

    // Innermost <ul>: content contains no <ol> or <ul> open tags
    result = result.replace(
      /<ul\b[^>]*>((?:(?!<(?:ol|ul)\b)[\s\S])*?)<\/ul>/gi,
      (_, content) => {
        const body = content.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (__, inner) => {
          const trimmed = inner.trim();
          const indented = trimmed.replace(/\n/g, '\n  ');
          return `\n- ${indented}`;
        });
        return '\n\n' + body.trim() + '\n\n';
      }
    );

    if (result === before) break;
  }
  return result;
}

// ─── Helper: Convert tables ──────────────────────────────────────────────────

function convertTables(html) {
  return html.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, content) => {
    const rows = [];
    content.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (__, rowContent) => {
      const cells = [];
      rowContent.replace(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi, (___, cellContent) => {
        cells.push(cellContent.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
      });
      if (cells.length > 0) rows.push(cells.join(' | '));
    });
    return '\n\n' + rows.join('\n') + '\n\n';
  });
}

// ─── Helper: Convert block elements ──────────────────────────────────────────

function convertBlockElements(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/(p|div|blockquote|section|article)>/gi, '\n\n');
}

// ─── Helper: Decode HTML entities ────────────────────────────────────────────

function decodeEntities(text) {
  return text
    .replace(/&lt;/gi,   '<')
    .replace(/&gt;/gi,   '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi,  "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g,         (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/gi,  '&'); // Last — prevents double-decoding of &amp;lt; → &lt; → <
}

// ─── Helper: Normalize whitespace ────────────────────────────────────────────

function normalizeWhitespace(text) {
  return text
    .replace(/[^\S\n]*\n/g, '\n') // trim trailing spaces from each line
    .replace(/\n{3,}/g, '\n\n')   // collapse 3+ consecutive newlines to 2
    .trim()                        // strip leading/trailing whitespace
    + '\n';                        // single trailing newline
}

// ─── Converter function ───────────────────────────────────────────────────────

/**
 * Convert an HTML note to plain text.
 *
 * @param {string} htmlContent - Full HTML string (may include <!DOCTYPE>, <html>, <head>, <body>).
 * @param {object} [_options]  - Unused. Kept for API consistency with other converters.
 * @returns {Promise<string>}  - Plain text string.
 */
async function toPlainTextConverter(htmlContent, _options) {
  if (!htmlContent || typeof htmlContent !== 'string') return '';

  let html = extractBody(htmlContent);
  html = removeInvisible(html);

  // Extract <pre> blocks before any processing to preserve their internal whitespace.
  // They are stored verbatim (tags stripped, entities decoded) and restored after
  // the main whitespace normalization pass.
  const preBlocks = [];
  html = html.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner) => {
    const text = decodeEntities(inner.replace(/<[^>]*>/g, ''));
    const idx = preBlocks.length;
    preBlocks.push(text);
    return `\x00PRE${idx}\x00`;
  });

  html = convertImages(html);
  html = convertLists(html);
  html = convertTables(html);
  html = convertBlockElements(html);
  html = html.replace(/<[^>]*>/g, ''); // strip all remaining tags
  html = decodeEntities(html);

  // Normalize whitespace while pre block placeholders are still in place
  // (so their internal content is not touched by the collapse pass).
  html = normalizeWhitespace(html);

  // Restore <pre> blocks verbatim, surrounded by blank lines.
  if (preBlocks.length > 0) {
    html = html.replace(/\x00PRE(\d+)\x00/g, (_, idx) => {
      return '\n\n' + preBlocks[parseInt(idx, 10)] + '\n\n';
    });
    // Final cleanup: collapse any excess blank lines introduced by the restoration,
    // then re-trim and re-add the trailing newline.
    html = html.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  return html;
}

// ─── Auto-registration ────────────────────────────────────────────────────────

registerConverter('plaintext', toPlainTextConverter);

module.exports = { toPlainTextConverter };
