/* The shipped note uses the same public bridge available to project HTML notes. */
(() => {
  if (!window.settings || window.settings.apiVersion !== 1) {
    document.getElementById('project-settings-body').textContent = 'This settings note requires settings API version 1. Use the host controls to restore the default interface.';
    return;
  }
  const applyTheme = theme => { if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme; };
  window.settings.onThemeChanged?.(applyTheme);
  window.settings.getTheme?.().then(applyTheme).catch(() => {});
  window.ProjectSettings.init();
  window.ProjectSettings.show();
})();
