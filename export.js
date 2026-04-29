'use strict';

const fs = require('fs');
const path = require('path');

// ─── Internal converter stubs ────────────────────────────────────────────────

function toHtml(htmlContent) {
  return htmlContent;
}

function toPdf(_htmlContent, _options) {
  throw new Error('PDF export not yet available. Install feature 103.');
}

function toMarkdown(_htmlContent, _options) {
  throw new Error('Markdown export not yet available. Install feature 104.');
}

function toPlainText(_htmlContent, _options) {
  throw new Error('Plain text export not yet available. Install feature 105.');
}

// ─── Format registry ─────────────────────────────────────────────────────────

const FORMAT_REGISTRY = {
  html:      { converter: toHtml,      mimeType: 'text/html',        ext: '.html' },
  pdf:       { converter: toPdf,       mimeType: 'application/pdf',  ext: '.pdf'  },
  markdown:  { converter: toMarkdown,  mimeType: 'text/markdown',    ext: '.md'   },
  plaintext: { converter: toPlainText, mimeType: 'text/plain',       ext: '.txt'  },
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Export a note to the requested format.
 *
 * @param {string} notePath - Absolute path to the source .html note file.
 * @param {string} format   - One of the FORMAT_REGISTRY keys.
 * @param {object} [options] - Optional format-specific options (e.g. { pageSize, margins } for PDF).
 * @returns {Promise<{ content: string|Buffer, mimeType: string, suggestedExtension: string }>}
 * @throws {Error} For unknown formats, missing/unreadable files, or converter errors.
 */
async function exportNote(notePath, format, options) {
  // Validate format
  if (!Object.prototype.hasOwnProperty.call(FORMAT_REGISTRY, format)) {
    const supported = Object.keys(FORMAT_REGISTRY).join(', ');
    throw new Error(`Unsupported export format: '${format}'. Supported formats: ${supported}`);
  }

  // Resolve index.html for note folders (folder-per-note model, feature 128)
  let htmlPath = notePath;
  try {
    if (fs.statSync(notePath).isDirectory()) {
      htmlPath = path.join(notePath, 'index.html');
    }
  } catch {}

  // Validate file existence and readability
  try {
    fs.accessSync(htmlPath, fs.constants.R_OK);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Note file not found: '${notePath}'`);
    }
    throw new Error(`Cannot read note file: '${notePath}'`);
  }

  // Read source HTML
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  // Dispatch to converter
  const entry = FORMAT_REGISTRY[format];
  const content = await entry.converter(htmlContent, options);

  return {
    content,
    mimeType: entry.mimeType,
    suggestedExtension: entry.ext,
  };
}

/**
 * Returns an array of all registered format names.
 * Useful for UI dropdowns and validation messages.
 * @returns {string[]}
 */
function getSupportedFormats() {
  return Object.keys(FORMAT_REGISTRY);
}

/**
 * Register (or replace) the converter function for an existing format.
 * Used by features 103–105 to plug in their real implementations.
 *
 * @param {string} format - Must be an existing FORMAT_REGISTRY key.
 * @param {Function} converterFn - async (htmlContent, options?) => string|Buffer
 * @throws {Error} If format is not in the registry.
 */
function registerConverter(format, converterFn) {
  if (!Object.prototype.hasOwnProperty.call(FORMAT_REGISTRY, format)) {
    throw new Error(`Cannot register converter for unknown format: '${format}'`);
  }
  FORMAT_REGISTRY[format].converter = converterFn;
}

module.exports = { exportNote, getSupportedFormats, registerConverter };
