// Drafts belong to an authorized mounted settings surface, never to noteDB.
function createSettingsSession(service, options = {}) {
  const drafts = options.drafts || new Map();
  function check(workspaceId) { if (workspaceId !== service.workspaceId) { const e = new Error('The project changed. Reopen settings.'); e.code = 'STALE_WORKSPACE'; throw e; } }
  const key = relative => relative;
  return {
    updateDraft(workspaceId, relative, text, revision) {
      check(workspaceId);
      const document = service.read(workspaceId, relative);
      if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024) { const e = new Error('Draft must be text under 1 MiB'); e.code = 'INVALID_DRAFT'; throw e; }
      const previous = drafts.get(key(relative));
      const baseText = previous ? previous.baseText : document.text;
      const baseRevision = previous ? previous.revision : revision;
      const draft = { workspaceId, path: relative, text, revision: baseRevision, baseText, dirty: text !== baseText, conflict: document.revision !== baseRevision };
      drafts.set(key(relative), draft); return { ...draft };
    },
    getDraft(workspaceId, relative) {
      check(workspaceId);
      const document = service.read(workspaceId, relative);
      const draft = drafts.get(key(relative));
      if (!draft) return null;
      if (!draft.dirty && document.revision !== draft.revision) { drafts.delete(key(relative)); return null; }
      return { ...draft, workspaceId, conflict: document.revision !== draft.revision };
    },
    discardDraft(workspaceId, relative) { check(workspaceId); drafts.delete(key(relative)); return service.read(workspaceId, relative); },
    async save(workspaceId, relative, text, revision) {
      check(workspaceId);
      const savingDraft = drafts.get(key(relative));
      const saved = await service.save(workspaceId, relative, text, revision);
      const latest = drafts.get(key(relative));
      if (latest === savingDraft) drafts.delete(key(relative));
      else if (latest) drafts.set(key(relative), { ...latest, revision: saved.revision, baseText: saved.text, dirty: latest.text !== saved.text, conflict: false });
      return saved;
    },
  };
}
module.exports = { createSettingsSession };
