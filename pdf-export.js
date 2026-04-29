'use strict';

const path = require('path');
const { BrowserWindow } = require('electron');
const { registerConverter } = require('./export');

const LOAD_TIMEOUT_MS = 30_000;
const RENDER_DELAY_MS = 200;

const DEFAULT_PDF_OPTIONS = {
  pageSize: 'A4',
  landscape: false,
  printBackground: true,
  margins: { marginType: 'default' },
};

/**
 * Convert a note to a PDF Buffer via a hidden BrowserWindow.
 *
 * @param {string} _htmlContent - Ignored. The note is loaded via note:// URL for full resource resolution.
 * @param {object} options
 * @param {string} options.notePath      - Absolute path to the note file.
 * @param {string} options.workspacePath - Absolute path to the workspace root.
 * @param {string} [options.pageSize]    - 'A3'|'A4'|'A5'|'Legal'|'Letter'|'Tabloid'. Default: 'A4'.
 * @param {boolean} [options.landscape]  - Landscape orientation. Default: false.
 * @param {boolean} [options.printBackground] - Include CSS backgrounds. Default: true.
 * @param {string} [options.marginType]  - 'default'|'none'|'printableArea'. Default: 'default'.
 * @returns {Promise<Buffer>}
 */
async function toPdfConverter(_htmlContent, options = {}) {
  const { notePath, workspacePath } = options;

  if (!notePath || !workspacePath) {
    throw new Error('PDF converter requires options.notePath and options.workspacePath');
  }

  // Build the note:// URL. Encode each path segment to handle spaces and special characters.
  const relativePath = path.relative(workspacePath, notePath);
  const encodedRelPath = relativePath.split(path.sep).map(encodeURIComponent).join('/');
  const noteUrl = `note://notes/${encodedRelPath}`;

  const pdfOptions = {
    pageSize: options.pageSize || DEFAULT_PDF_OPTIONS.pageSize,
    landscape: options.landscape !== undefined ? options.landscape : DEFAULT_PDF_OPTIONS.landscape,
    printBackground: options.printBackground !== undefined ? options.printBackground : DEFAULT_PDF_OPTIONS.printBackground,
    margins: { marginType: options.marginType || DEFAULT_PDF_OPTIONS.margins.marginType },
  };

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  try {
    await Promise.race([
      new Promise((resolve, reject) => {
        win.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
          reject(new Error(`Failed to load note for PDF export: ${errorDescription} (code ${errorCode})`));
        });
        win.webContents.once('did-finish-load', resolve);
        win.loadURL(noteUrl);
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('PDF export timed out: page did not finish loading within 30s')),
          LOAD_TIMEOUT_MS
        )
      ),
    ]);

    // Small delay to allow CSS/fonts to fully apply (Chromium rendering quirk).
    await new Promise((resolve) => setTimeout(resolve, RENDER_DELAY_MS));

    return await win.webContents.printToPDF(pdfOptions);
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}

registerConverter('pdf', toPdfConverter);

module.exports = { toPdfConverter };
