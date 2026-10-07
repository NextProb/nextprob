'use strict';

// Published notes use the reader's color preference, but the same theme
// attribute and viewer stylesheet as the desktop webview.
const THEME_SCRIPT = `<script data-source="notes-app-share-theme">
(function () {
  const preference = window.matchMedia('(prefers-color-scheme: light)');
  function applyTheme() {
    if (preference.matches) {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }
  applyTheme();
  preference.addEventListener('change', applyTheme);
})();
</script>`;

// The desktop app injects viewer CSS after the note's document is ready. Move
// the embedded copy behind any styles the note placed in its body, too.
const STYLE_ORDER_SCRIPT = `<script data-source="notes-app-share-style-order">
document.addEventListener('DOMContentLoaded', function () {
  const style = document.querySelector('style[data-source="notes-app-share"]');
  if (style && document.body) document.body.appendChild(style);
}, { once: true });
</script>`;

function addSharedNoteStyle(html, noteCss) {
  // The desktop viewer leaves archived pages' original styles alone.
  const isWebClip = /<meta\b[^>]*\bname\s*=\s*["']source-url["'][^>]*>/i.test(html);
  const styleBlock = isWebClip ? '' : `<style data-source="notes-app-share">\n${noteCss}</style>`;
  const setup = isWebClip ? THEME_SCRIPT : `${THEME_SCRIPT}\n${STYLE_ORDER_SCRIPT}`;

  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n${setup}`);
    if (/<\/head>/i.test(html)) {
      return html.replace(/<\/head>/i, `${styleBlock}\n</head>`);
    }
    if (/<body[^>]*>/i.test(html)) {
      return html.replace(/<body[^>]*>/i, `${styleBlock}\n$&`);
    }
    return `${html}\n${styleBlock}`;
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1>\n<head>${setup}\n${styleBlock}</head>`);
  }
  return `${setup}\n${styleBlock}\n${html}`;
}

module.exports = { addSharedNoteStyle };
