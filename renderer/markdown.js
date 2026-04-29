// renderer/markdown.js — Markdown rendering helpers
// Requires: window.marked, window.hljs, window.DOMPurify (loaded before this script)

(function () {
  // Configure marked with a custom code renderer for syntax highlighting
  // marked v5+ passes a token object: { text, lang, escaped }
  const renderer = {
    code({ text: code, lang: infostring }) {
      const lang = (infostring || '').trim().split(/\s+/)[0];
      if (lang && window.hljs.getLanguage(lang)) {
        const highlighted = window.hljs.highlight(code, {
          language: lang,
          ignoreIllegals: true,
        }).value;
        return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
      }
      const autoHighlighted = window.hljs.highlightAuto(code).value;
      return `<pre><code class="hljs">${autoHighlighted}</code></pre>`;
    },
  };

  window.marked.use({
    renderer,
    gfm: true,
    breaks: true,
  });

  // Add DOMPurify hook: open links in system browser, not in-app
  window.DOMPurify.addHook('afterSanitizeAttributes', function (node) {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });

  /**
   * Parse Markdown text to sanitized HTML.
   * @param {string} text — raw Markdown string
   * @returns {string} — sanitized HTML string safe for innerHTML
   */
  window.renderMarkdown = function renderMarkdown(text) {
    const rawHtml = window.marked.parse(text || '');
    return window.DOMPurify.sanitize(rawHtml, {
      FORBID_TAGS: ['img', 'script', 'style'],
      ADD_ATTR: ['target', 'rel'],
    });
  };

  // Inline SVGs for code block copy buttons
  const COPY_ICON = '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1z"/><path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0z"/></svg>';
  const CHECK_ICON = '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0"/></svg>';

  /**
   * Inject a copy button into each <pre><code> block inside a bubble element.
   * Wraps each <pre> in a div.code-block-wrapper for positioning.
   * @param {HTMLElement} bubbleEl — the assistant message bubble element
   */
  window.addCodeBlockCopyButtons = function addCodeBlockCopyButtons(bubbleEl) {
    const preElements = bubbleEl.querySelectorAll('pre');
    preElements.forEach((pre) => {
      // Skip if already wrapped (e.g. re-render during streaming)
      if (pre.parentElement && pre.parentElement.classList.contains('code-block-wrapper')) return;

      const codeEl = pre.querySelector('code');
      if (!codeEl) return;

      // Extract language from class like "language-javascript" or "hljs language-js"
      const langClass = Array.from(codeEl.classList).find((c) => c.startsWith('language-'));
      const lang = langClass ? langClass.replace('language-', '') : '';

      // Wrap <pre> in a positioning container
      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);

      // Language label
      if (lang) {
        const label = document.createElement('span');
        label.className = 'code-lang-label';
        label.textContent = lang;
        wrapper.appendChild(label);
      }

      // Copy button
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy-btn';
      btn.title = 'Copy code';
      btn.setAttribute('aria-label', 'Copy code');
      btn.innerHTML = COPY_ICON;
      btn.addEventListener('click', () => {
        if (btn.classList.contains('copied')) return;
        const plainText = codeEl.textContent || '';
        navigator.clipboard.writeText(plainText).then(() => {
          btn.innerHTML = CHECK_ICON;
          btn.classList.add('copied');
          setTimeout(() => {
            btn.innerHTML = COPY_ICON;
            btn.classList.remove('copied');
          }, 1500);
        }).catch((err) => {
          console.error('Code copy failed:', err);
        });
      });
      wrapper.appendChild(btn);
    });
  };
})();
