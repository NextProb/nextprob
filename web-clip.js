'use strict';

const fs = require('fs');
const path = require('path');
const { BrowserWindow, session } = require('electron');
const { getUniqueNotePath } = require('./markdown-import');

const LOAD_TIMEOUT_MS = 30000;
const EXTRACT_TIMEOUT_MS = 60000;
const SETTLE_DELAY_MS = 1500;

/**
 * Extraction script injected into the hidden BrowserWindow.
 * Clones the live DOM, inlines CSS via CSSOM, extracts images via canvas,
 * and strips all JavaScript/dangerous elements.
 */
const EXTRACTION_SCRIPT = `
(async function() {
  async function collectImageData(docClone, stats) {
    const imageDataMap = new Map();
    const imageDataArray = [];
    let imageIndex = 0;

    const liveImages = Array.from(document.querySelectorAll('img'));
    stats.totalImages = liveImages.length;

    for (const liveImg of liveImages) {
      try {
        if (liveImg.src && !liveImg.src.startsWith('data:')) {
          const originalSrc = liveImg.src;

          if (liveImg.complete && liveImg.naturalWidth > 0) {
            const canvas = document.createElement('canvas');
            canvas.width = liveImg.naturalWidth;
            canvas.height = liveImg.naturalHeight;
            const ctx = canvas.getContext('2d');

            try {
              ctx.drawImage(liveImg, 0, 0);
              const dataUrl = canvas.toDataURL('image/png');
              const base64Data = dataUrl.split(',')[1];

              let extension = 'png';
              const urlExt = originalSrc.split('.').pop().split('?')[0].toLowerCase();
              if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(urlExt)) {
                extension = urlExt === 'jpeg' ? 'jpg' : urlExt;
              }

              const placeholderId = 'IMG_PLACEHOLDER_' + imageIndex;

              imageDataArray.push({
                placeholderId: placeholderId,
                base64Data: base64Data,
                extension: extension,
              });

              imageDataMap.set(originalSrc, {
                placeholderId: placeholderId,
                originalSrc: originalSrc,
              });

              imageIndex++;
              stats.successfulImages++;
            } catch (e) {
              // CORS-tainted canvas -- keep original src
              stats.failedImages++;
            }
          } else {
            stats.failedImages++;
          }
        }
      } catch (e) {
        stats.failedImages++;
      }
    }

    // Update clone images with placeholders
    const cloneImages = Array.from(docClone.querySelectorAll('img'));
    for (const cloneImg of cloneImages) {
      const data = imageDataMap.get(cloneImg.src);
      if (data) {
        cloneImg.setAttribute('data-original-src', data.originalSrc);
        cloneImg.src = data.placeholderId;
        cloneImg.removeAttribute('srcset');
      }
    }

    return imageDataArray;
  }

  async function inlineAllCSS(docClone, stats, url) {
    const styleSheets = Array.from(document.styleSheets);
    stats.totalCSS = styleSheets.length;

    function extractCSSFromSheet(sheet) {
      try {
        const cssRules = Array.from(sheet.cssRules || []);
        return cssRules.map(rule => rule.cssText).join('\\n');
      } catch (e) {
        return null;
      }
    }

    const cssDataMap = new Map();

    for (const sheet of styleSheets) {
      try {
        const cssText = extractCSSFromSheet(sheet);

        if (cssText) {
          if (sheet.href) {
            cssDataMap.set(sheet.href, { cssText: cssText, href: sheet.href });
          }
          stats.successfulCSS++;
        } else {
          if (sheet.href) {
            cssDataMap.set(sheet.href, { cssText: null, href: sheet.href, crossOrigin: true });
          }
          stats.failedCSS++;
        }
      } catch (e) {
        stats.failedCSS++;
      }
    }

    // Replace link tags with inlined styles in clone
    const cloneLinks = Array.from(docClone.querySelectorAll('link[rel="stylesheet"]'));
    for (const link of cloneLinks) {
      const data = cssDataMap.get(link.href);
      if (data) {
        if (data.cssText) {
          const style = docClone.createElement('style');
          style.setAttribute('data-original-href', data.href);
          style.textContent = data.cssText;
          if (link.parentNode) {
            link.parentNode.replaceChild(style, link);
          }
        } else if (data.crossOrigin) {
          try {
            link.href = new URL(data.href, url).href;
          } catch (e) {}
        }
      }
    }
  }

  function removeJavaScript(docClone) {
    // Remove dangerous tags
    docClone.querySelectorAll('script, noscript, object, embed, applet, base')
      .forEach(el => el.remove());

    // Remove meta refresh
    docClone.querySelectorAll('meta[http-equiv]').forEach(meta => {
      if ((meta.getAttribute('http-equiv') || '').toLowerCase() === 'refresh') {
        meta.remove();
      }
    });

    // Remove event handlers and dangerous protocols from all elements
    docClone.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(attr => {
        if (attr.name.startsWith('on')) {
          el.removeAttribute(attr.name);
        }
      });

      for (const prop of ['href', 'src', 'action', 'formaction']) {
        const val = el.getAttribute(prop);
        if (val) {
          const lower = val.trim().toLowerCase();
          if (lower.startsWith('javascript:') || lower.startsWith('vbscript:')) {
            el.removeAttribute(prop);
          }
        }
      }

      // Clean SVG scripts
      if (el.tagName && el.tagName.toLowerCase() === 'svg') {
        el.querySelectorAll('script').forEach(s => s.remove());
      }
    });

    // Clean style tags
    docClone.querySelectorAll('style').forEach(style => {
      if (style.textContent) {
        style.textContent = style.textContent
          .replace(/@import\\s+[^;]+;/gi, '')
          .replace(/expression\\s*\\([^)]*\\)/gi, '')
          .replace(/javascript:/gi, '');
      }
    });
  }

  // --- Main execution ---
  try {
    const title = document.title || 'Untitled Page';
    const url = window.location.href;
    const docClone = document.cloneNode(true);

    const stats = {
      totalImages: 0, successfulImages: 0, failedImages: 0,
      totalCSS: 0, successfulCSS: 0, failedCSS: 0,
    };

    const imageDataArray = await collectImageData(docClone, stats);
    await inlineAllCSS(docClone, stats, url);
    removeJavaScript(docClone);

    return {
      title: title,
      url: url,
      html: docClone.documentElement.outerHTML,
      stats: stats,
      imageData: imageDataArray,
    };
  } catch (err) {
    return { error: true, message: err.message };
  }
})();
`;

/**
 * Clips a web page from a URL and saves it as a note.
 *
 * @param {string} url        - the URL to clip
 * @param {string} targetDir  - absolute path to destination folder in workspace
 * @param {string} cssText    - NOTE_CSS stylesheet text (unused, kept for API compat)
 * @returns {Promise<{ notePath: string, noteName: string, title: string } | { error: string }>}
 */
async function clipFromUrl(url, targetDir, _cssText) {
  const partition = `web-clip-${Date.now()}`;
  const ses = session.fromPartition(partition, { cache: false });
  let clipWin;

  try {
    // 1. Create hidden, sandboxed BrowserWindow
    clipWin = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        session: ses,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webgl: false,
        plugins: false,
      },
    });

    // Lock down navigation and popups
    clipWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    clipWin.webContents.on('will-navigate', (e, navUrl) => {
      if (navUrl !== url) e.preventDefault();
    });

    // 2. Load URL with timeout
    await Promise.race([
      new Promise((resolve, reject) => {
        clipWin.webContents.once('did-finish-load', resolve);
        clipWin.webContents.once('did-fail-load', (_e, code, desc) => {
          reject(new Error(`Page load failed: ${desc} (${code})`));
        });
        clipWin.loadURL(url);
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Page load timed out after 30 seconds')), LOAD_TIMEOUT_MS)
      ),
    ]);

    // 3. Wait for dynamic/lazy content to settle
    await new Promise(resolve => setTimeout(resolve, SETTLE_DELAY_MS));

    // 4. Execute extraction script
    const extractedData = await Promise.race([
      clipWin.webContents.executeJavaScript(EXTRACTION_SCRIPT),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Extraction timed out')), EXTRACT_TIMEOUT_MS)
      ),
    ]);

    if (!extractedData || extractedData.error) {
      return { error: extractedData?.message || 'Extraction failed' };
    }

    const title = extractedData.title || new URL(url).hostname;

    // 5. Determine note folder
    const slugTitle = slugify(title);
    const desiredFolder = path.join(targetDir, slugTitle);
    const noteFolder = await getUniqueNotePath(desiredFolder);
    if (!noteFolder) {
      return { error: 'Could not find a unique name for this note (99 variants already exist)' };
    }
    await fs.promises.mkdir(noteFolder, { recursive: true });

    // 6. Save images from base64 data
    let htmlContent = extractedData.html;
    const imageData = extractedData.imageData || [];

    if (imageData.length > 0) {
      const assetsDir = path.join(noteFolder, 'assets');
      await fs.promises.mkdir(assetsDir, { recursive: true });

      for (let i = 0; i < imageData.length; i++) {
        const img = imageData[i];
        try {
          const filename = `img-${String(i).padStart(3, '0')}.${img.extension}`;
          const buffer = Buffer.from(img.base64Data, 'base64');
          await fs.promises.writeFile(path.join(assetsDir, filename), buffer);

          htmlContent = htmlContent.replace(
            new RegExp(`src="${img.placeholderId}"`, 'g'),
            `src="assets/${filename}"`
          );
        } catch {
          // Continue with remaining images
        }
      }
    }

    // Remove any remaining srcset attributes
    htmlContent = htmlContent.replace(/\s+srcset="[^"]*"/gi, '');

    // 7. Inject metadata into the archived HTML
    const isoDate = new Date().toISOString();
    const metaTags =
      `  <meta name="source-url" content="${escapeAttr(url)}">\n` +
      `  <meta name="clipped-at" content="${isoDate}">`;
    const footer =
      `<hr>\n<p><small>Clipped from <a href="${escapeAttr(url)}">${escapeHtml(url)}</a></small></p>`;

    if (htmlContent.includes('</head>')) {
      htmlContent = htmlContent.replace('</head>', metaTags + '\n</head>');
    }
    if (htmlContent.includes('</body>')) {
      htmlContent = htmlContent.replace('</body>', footer + '\n</body>');
    }

    // 8. Save
    const indexPath = path.join(noteFolder, 'index.html');
    await fs.promises.writeFile(indexPath, htmlContent, 'utf8');

    return {
      notePath: noteFolder,
      noteName: path.basename(noteFolder),
      title,
    };
  } catch (err) {
    if (err.message?.includes('timed out')) {
      return { error: err.message };
    }
    return { error: 'Could not clip page: ' + err.message };
  } finally {
    if (clipWin && !clipWin.isDestroyed()) {
      clipWin.destroy();
    }
    try {
      await ses.clearStorageData();
    } catch {}
  }
}

/**
 * Creates a URL-safe slug from a title string.
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'clipped-page';
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

module.exports = { clipFromUrl };
