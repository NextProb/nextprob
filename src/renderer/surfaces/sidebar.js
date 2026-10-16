/* Project surface helpers shared by the renderer and its focused unit tests. */
(function (root) {
  'use strict';
  const api = {
    sections(snapshot) {
      return snapshot && Array.isArray(snapshot.sections) ? snapshot.sections : null;
    },
    adapter(section) {
      if (section.id === 'files' && section.view === 'tree') return 'files';
      if (section.id === 'favorites' && section.view === 'list' && section.collection === 'favorites' && (section.items || []).every(item => item.favorite !== false)) return 'favorites';
      return null;
    },
    count(section) {
      if (section.view !== 'tree') return (section.items || []).length;
      function count(children) {
        return (children || []).reduce((sum, item) => sum + (item.type === 'folder' ? count(item.children) : 1), 0);
      }
      return count(section.tree?.children);
    },
    visible(section) {
      return !section.hideWhenEmpty || api.count(section) > 0;
    },
    stateKey(id) { return `section:${id}:collapsed`; },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProjectSidebar = api;
})(typeof window !== 'undefined' ? window : globalThis);
