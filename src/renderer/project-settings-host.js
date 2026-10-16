/* Settings surface host. Recovery controls remain outside replaceable project HTML. */
(() => {
  'use strict';
  let body, controls, frame, notice, label, active = false, loading = false, surface, guestId;
  let generation = 0, requestVersion = 0;
  let registrationError = false;
  const button = (text, action) => {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'btn-secondary'; el.textContent = text;
    el.addEventListener('click', () => run(action)); return el;
  };
  function report(text) { notice.textContent = text || ''; notice.hidden = !text; }
  async function run(action) {
    if (loading) return;
    const request = ++requestVersion;
    loading = true; controls.querySelectorAll('button').forEach(el => { el.disabled = true; });
    try { const next = await action(); if (next && request === requestVersion) await mount(next); }
    catch (error) { if (request === requestVersion) report(error.message || String(error)); }
    finally { if (request === requestVersion) { loading = false; controls.querySelectorAll('button').forEach(el => { el.disabled = false; }); } }
  }
  function unmount() {
    generation++;
    if (guestId) window.api.projectSettingsUnregisterSurface(guestId).catch(() => {});
    guestId = null;
    frame?.remove(); frame = null;
  }
  async function mount(next) {
    unmount(); surface = next;
    label.textContent = next.kind === 'custom' ? next.path || 'Custom HTML note' : 'Default settings note';
    label.title = next.path || 'Application-maintained HTML settings note';
    report(next.diagnostic); registrationError = false;
    const ticket = generation;
    const webview = document.createElement('webview'); frame = webview;
    webview.className = 'project-settings-frame'; webview.setAttribute('aria-label', 'Project settings HTML note');
    webview.setAttribute('preload', next.preloadUrl);
    webview.setAttribute('webpreferences', 'contextIsolation=yes,sandbox=yes');
    const register = async () => {
      if (ticket !== generation) return;
      try {
        const id = webview.getWebContentsId();
        guestId = id;
        await window.api.projectSettingsRegisterSurface(id);
        if (ticket !== generation) { await window.api.projectSettingsUnregisterSurface(id).catch(() => {}); return; }
        if (registrationError) { registrationError = false; report(next.diagnostic); }
      }
      catch (error) { if (ticket === generation) { registrationError = true; report(error.message || 'Unable to connect the settings note.'); } }
    };
    webview.addEventListener('did-attach', register);
    webview.addEventListener('dom-ready', register);
    webview.addEventListener('did-fail-load', event => { if (event.errorCode !== -3 && ticket === generation) report('The settings note could not load. Choose another HTML note or use the default.'); });
    webview.addEventListener('render-process-gone', () => { if (ticket === generation) report('The settings note stopped. Use default or choose an HTML note to reopen it.'); });
    webview.setAttribute('src', next.url); body.append(webview);
  }
  function init() {
    body = document.getElementById('project-settings-body'); if (!body) return;
    body.classList.add('project-settings-surface-host');
    controls = document.createElement('div'); controls.className = 'project-settings-surface-controls';
    label = document.createElement('span'); label.className = 'project-settings-surface-label';
    controls.append(label, button('Reload interface', () => window.api.projectSettingsSurface()), button('Choose HTML note', () => window.api.projectSettingsChooseSurface()), button('Create editable copy', () => window.api.projectSettingsCreateSurfaceCopy()), button('Use default', () => window.api.projectSettingsResetSurface()));
    notice = document.createElement('div'); notice.className = 'project-settings-surface-notice'; notice.setAttribute('role', 'status'); notice.hidden = true;
    body.append(controls, notice);
    window.api.onWorkspaceLoaded?.(() => { requestVersion++; loading = false; controls.querySelectorAll('button').forEach(el => { el.disabled = false; }); surface = null; unmount(); if (active) run(() => window.api.projectSettingsSurface()); });
  }
  window.ProjectSettings = {
    init,
    show() { active = true; if (!frame) run(() => window.api.projectSettingsSurface()); },
    hide() { active = false; }
  };
})();
