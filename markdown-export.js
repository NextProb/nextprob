'use strict';

const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');
const { registerConverter } = require('./export');

// ─── Configure TurndownService ────────────────────────────────────────────────

const turndownService = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  fence: '```',
  emDelimiter: '*',
  strongDelimiter: '**',
  linkStyle: 'inlined',
});

// Strip <style> and <script> elements entirely (do not emit their content).
turndownService.remove(['style', 'script']);

// Complex table fallback: tables with colspan/rowspan cannot be expressed in GFM.
// This rule fires BEFORE the GFM tables plugin (higher priority = added first).
turndownService.addRule('complexTableFallback', {
  filter: function (node) {
    return (
      node.nodeName === 'TABLE' &&
      node.querySelector('td[colspan], td[rowspan], th[colspan], th[rowspan]')
    );
  },
  replacement: function (_content, node) {
    return '\n\n' + node.outerHTML + '\n\n';
  },
});

// Apply GFM plugin (tables, strikethrough, task lists).
// Must be applied AFTER the complexTableFallback rule so that rule takes priority.
turndownService.use(gfm);

// Override turndown-plugin-gfm's strikethrough rule to emit double tildes (GFM spec).
// The plugin (v1.0.2) incorrectly produces single tildes (~text~), which is not
// recognized by standard Markdown renderers.
turndownService.addRule('strikethrough', {
  filter: ['del', 's', 'strike'],
  replacement: function (content) {
    return '~~' + content + '~~';
  },
});

// ─── Converter function ───────────────────────────────────────────────────────

/**
 * Convert an HTML note to Markdown.
 *
 * @param {string} htmlContent - Full HTML string of the note (may include <!DOCTYPE>, <html>, <head>, <body>).
 * @param {object} [_options]  - Unused. Kept for API consistency with other converters.
 * @returns {Promise<string>}  - Markdown string.
 */
async function toMarkdownConverter(htmlContent, _options) {
  if (!htmlContent || typeof htmlContent !== 'string') {
    return '';
  }

  // Extract <body> content if present; skip <head> (styles, scripts, meta).
  // Turndown can handle full documents, but extracting body avoids leaking
  // title/meta tags as text fragments in the Markdown output.
  let source = htmlContent;
  const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    source = bodyMatch[1];
  }

  const markdown = turndownService.turndown(source);

  // Normalise: trim trailing whitespace, ensure single trailing newline.
  return markdown.trimEnd() + '\n';
}

// ─── Auto-registration ────────────────────────────────────────────────────────

registerConverter('markdown', toMarkdownConverter);

module.exports = { toMarkdownConverter };
