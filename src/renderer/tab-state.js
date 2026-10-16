// renderer/tab-state.js
// Pure data module — no DOM access.
// Exposes window.TabState singleton for tab and panel state management.

(function () {
  'use strict';

  // ─── Private State ────────────────────────────────────────────────────────────

  let _state = {
    panels: [],
    focusedPanelId: null,
    splitDirection: 'horizontal',
  };

  let _listeners = [];

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  function _newId() {
    return crypto.randomUUID();
  }

  function _notify(eventDescriptor) {
    const snapshot = getState();
    for (const cb of _listeners) {
      cb(snapshot, eventDescriptor);
    }
  }

  function _findPanel(panelId) {
    return _state.panels.find(p => p.id === panelId) || null;
  }

  // ─── Initialization ───────────────────────────────────────────────────────────

  const _initialPanel = { id: _newId(), tabs: [], activeTabId: null, sizeRatio: 1 };
  _state.panels = [_initialPanel];
  _state.focusedPanelId = _initialPanel.id;

  // ─── Change Notification ──────────────────────────────────────────────────────

  function onChange(cb) {
    _listeners.push(cb);
  }

  function offChange(cb) {
    _listeners = _listeners.filter(l => l !== cb);
  }

  // ─── Tab Operations ───────────────────────────────────────────────────────────

  function addTab(panelId, { filePath, fileType, type, title }) {
    const panel = _findPanel(panelId);
    if (!panel) return null;

    // Dedup: if same filePath already exists in this panel, activate it instead
    const existing = panel.tabs.find(t => t.filePath === filePath);
    if (existing) {
      setActiveTab(panelId, existing.id);
      return existing;
    }

    const tab = { id: _newId(), filePath, fileType, type, title, isPinned: false };
    panel.tabs.push(tab);
    panel.activeTabId = tab.id;
    _notify({ type: 'tab-added', panelId, tabId: tab.id });
    return tab;
  }

  function removeTab(panelId, tabId) {
    const panel = _findPanel(panelId);
    if (!panel) return;

    const idx = panel.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    panel.tabs.splice(idx, 1);

    if (panel.activeTabId === tabId) {
      if (panel.tabs.length === 0) {
        panel.activeTabId = null;
      } else {
        // Prefer right neighbor, fallback to left (i.e. clamp to last)
        panel.activeTabId = panel.tabs[Math.min(idx, panel.tabs.length - 1)].id;
      }
    }

    _notify({ type: 'tab-removed', panelId, tabId });
  }

  function setActiveTab(panelId, tabId) {
    const panel = _findPanel(panelId);
    if (!panel) return;
    if (!panel.tabs.find(t => t.id === tabId)) return;
    panel.activeTabId = tabId;
    _notify({ type: 'tab-activated', panelId, tabId });
  }

  function _pinnedCount(panel) {
    let count = 0;
    for (const t of panel.tabs) {
      if (t.isPinned) count++;
      else break;
    }
    return count;
  }

  function reorderTab(panelId, tabId, newIndex) {
    const panel = _findPanel(panelId);
    if (!panel) return;

    const idx = panel.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    const [tab] = panel.tabs.splice(idx, 1);
    const pinnedCount = _pinnedCount(panel);
    let clampedIndex;
    if (tab.isPinned) {
      clampedIndex = Math.max(0, Math.min(newIndex, pinnedCount));
    } else {
      clampedIndex = Math.max(pinnedCount, Math.min(newIndex, panel.tabs.length));
    }
    panel.tabs.splice(clampedIndex, 0, tab);
    _notify({ type: 'tab-reordered', panelId, tabId });
  }

  function moveTab(sourcePanelId, targetPanelId, tabId, insertIndex) {
    const sourcePanel = _findPanel(sourcePanelId);
    const targetPanel = _findPanel(targetPanelId);
    if (!sourcePanel || !targetPanel) return;

    const srcIdx = sourcePanel.tabs.findIndex(t => t.id === tabId);
    if (srcIdx === -1) return;

    // Remove tab from source panel
    const [tab] = sourcePanel.tabs.splice(srcIdx, 1);

    // Update source panel's active tab if the moved tab was active
    if (sourcePanel.activeTabId === tabId) {
      sourcePanel.activeTabId = sourcePanel.tabs.length === 0
        ? null
        : sourcePanel.tabs[Math.min(srcIdx, sourcePanel.tabs.length - 1)].id;
    }

    // Insert tab into target panel at clamped index (zone-aware)
    const pinnedCount = _pinnedCount(targetPanel);
    let clampedInsert;
    if (tab.isPinned) {
      clampedInsert = Math.max(0, Math.min(insertIndex, pinnedCount));
    } else {
      clampedInsert = Math.max(pinnedCount, Math.min(insertIndex, targetPanel.tabs.length));
    }
    targetPanel.tabs.splice(clampedInsert, 0, tab);

    // Moved tab becomes active in target panel
    targetPanel.activeTabId = tab.id;

    _notify({ type: 'tab-moved', panelId: null, tabId, sourcePanelId, targetPanelId });
  }

  function duplicateTab(panelId, tabId) {
    const panel = _findPanel(panelId);
    if (!panel) return null;

    const srcIdx = panel.tabs.findIndex(t => t.id === tabId);
    if (srcIdx === -1) return null;

    const src = panel.tabs[srcIdx];
    const newTab = {
      id: _newId(),
      filePath: src.filePath,
      fileType: src.fileType,
      title: src.title,
      isPinned: false,
    };

    panel.tabs.splice(srcIdx + 1, 0, newTab);
    panel.activeTabId = newTab.id;
    _notify({ type: 'tab-added', panelId, tabId: newTab.id });
    return newTab;
  }

  function duplicateTabToPanel(sourcePanelId, targetPanelId, tabId) {
    const sourcePanel = _findPanel(sourcePanelId);
    const targetPanel = _findPanel(targetPanelId);
    if (!sourcePanel || !targetPanel) return null;

    const src = sourcePanel.tabs.find(t => t.id === tabId);
    if (!src) return null;

    const newTab = {
      id: _newId(),
      filePath: src.filePath,
      fileType: src.fileType,
      title: src.title,
      isPinned: false,
    };

    targetPanel.tabs.push(newTab);
    targetPanel.activeTabId = newTab.id;
    _state.focusedPanelId = targetPanelId;
    _notify({ type: 'tab-added', panelId: targetPanelId, tabId: newTab.id });
    _notify({ type: 'panel-focused', panelId: targetPanelId, tabId: null });
    return newTab;
  }

  function getTab(tabId) {
    for (const panel of _state.panels) {
      const tab = panel.tabs.find(t => t.id === tabId);
      if (tab) return tab;
    }
    return null;
  }

  function findTabByPath(panelId, filePath) {
    const panel = _findPanel(panelId);
    if (!panel) return null;
    return panel.tabs.find(t => t.filePath === filePath) || null;
  }

  function updateTab(tabId, updates) {
    // Find the tab across all panels
    for (const panel of _state.panels) {
      const tab = panel.tabs.find(t => t.id === tabId);
      if (tab) {
        const wasPinned = tab.isPinned;
        Object.assign(tab, updates);

        // Reposition if pin state changed
        if ('isPinned' in updates && updates.isPinned !== wasPinned) {
          const idx = panel.tabs.indexOf(tab);
          panel.tabs.splice(idx, 1);
          const pinnedCount = _pinnedCount(panel);
          panel.tabs.splice(pinnedCount, 0, tab);
        }

        _notify({ type: 'tab-updated', panelId: panel.id, tabId });
        return;
      }
    }
  }

  function removeTabsByPath(filePath) {
    const removedTabIds = [];
    for (const panel of _state.panels) {
      const toRemove = panel.tabs.filter(t => t.filePath === filePath).map(t => t.id);
      for (const tabId of toRemove) {
        const idx = panel.tabs.findIndex(t => t.id === tabId);
        if (idx === -1) continue;
        panel.tabs.splice(idx, 1);
        removedTabIds.push(tabId);
        if (panel.activeTabId === tabId) {
          panel.activeTabId = panel.tabs.length > 0
            ? panel.tabs[Math.min(idx, panel.tabs.length - 1)].id
            : null;
        }
      }
    }
    if (removedTabIds.length > 0) {
      _notify({ type: 'tabs-removed-by-path', panelId: null, tabId: null, removedTabIds });
    }
  }

  function renameTabsByPath(oldPath, newPath, newTitle) {
    for (const panel of _state.panels) {
      const matching = panel.tabs.filter(t => t.filePath === oldPath);
      for (const tab of matching) {
        tab.filePath = newPath;
        tab.title = newTitle;
        _notify({ type: 'tab-updated', panelId: panel.id, tabId: tab.id });
      }
    }
  }

  // ─── Panel Operations ─────────────────────────────────────────────────────────

  function addPanel() {
    const panel = { id: _newId(), tabs: [], activeTabId: null, sizeRatio: 1 };
    _state.panels.push(panel);
    _state.focusedPanelId = panel.id;
    _notify({ type: 'panel-added', panelId: panel.id, tabId: null });
    return panel;
  }

  function removePanel(panelId) {
    if (_state.panels.length <= 1) return; // always keep at least one panel
    const idx = _state.panels.findIndex(p => p.id === panelId);
    if (idx === -1) return;

    _state.panels.splice(idx, 1);

    // Reset all remaining panels to equal size
    for (const p of _state.panels) {
      p.sizeRatio = 1;
    }

    // Reset split direction to default when only one panel remains
    if (_state.panels.length === 1) {
      _state.splitDirection = 'horizontal';
    }

    if (_state.focusedPanelId === panelId) {
      _state.focusedPanelId = _state.panels[0].id;
    }
    _notify({ type: 'panel-removed', panelId, tabId: null });
  }

  function setFocusedPanel(panelId) {
    if (!_findPanel(panelId)) return;
    _state.focusedPanelId = panelId;
    _notify({ type: 'panel-focused', panelId, tabId: null });
  }

  function getPanel(panelId) {
    return _findPanel(panelId);
  }

  function getFocusedPanel() {
    return _findPanel(_state.focusedPanelId);
  }

  // ─── Accessors ────────────────────────────────────────────────────────────────

  function getState() {
    // Returns a deep snapshot — safe for listeners to read without mutation risk
    return {
      panels: _state.panels.map(p => ({
        id: p.id,
        tabs: p.tabs.map(t => ({ ...t })),
        activeTabId: p.activeTabId,
        sizeRatio: p.sizeRatio,
      })),
      focusedPanelId: _state.focusedPanelId,
      splitDirection: _state.splitDirection,
    };
  }

  function getActiveTab(panelId) {
    const panel = _findPanel(panelId);
    if (!panel || !panel.activeTabId) return null;
    return panel.tabs.find(t => t.id === panel.activeTabId) || null;
  }

  function restoreState(savedState) {
    if (!savedState || !Array.isArray(savedState.panels) || savedState.panels.length === 0) return false;
    if (savedState.splitDirection !== 'horizontal' && savedState.splitDirection !== 'vertical') return false;

    for (const panel of savedState.panels) {
      if (typeof panel.id !== 'string' || !panel.id) return false;
      if (!Array.isArray(panel.tabs)) return false;
      if (typeof panel.sizeRatio !== 'number') return false;
      for (const tab of panel.tabs) {
        if (typeof tab.id !== 'string' || !tab.id) return false;
        if (typeof tab.filePath !== 'string') return false;
        if (typeof tab.title !== 'string') return false;
        if (typeof tab.fileType !== 'string' && tab.type !== 'note') return false;
      }
    }

    _state.panels = savedState.panels.map(p => ({
      id: p.id,
      tabs: p.tabs.map(t => ({ ...t })),
      activeTabId: p.activeTabId,
      sizeRatio: p.sizeRatio,
    }));
    _state.splitDirection = savedState.splitDirection;

    const panelIds = new Set(_state.panels.map(p => p.id));
    _state.focusedPanelId = panelIds.has(savedState.focusedPanelId)
      ? savedState.focusedPanelId
      : _state.panels[0].id;

    for (const panel of _state.panels) {
      const tabIds = new Set(panel.tabs.map(t => t.id));
      if (panel.activeTabId !== null && !tabIds.has(panel.activeTabId)) {
        panel.activeTabId = panel.tabs.length > 0 ? panel.tabs[0].id : null;
      }
    }

    _notify({ type: 'state-restored', panelId: null, tabId: null });
    return true;
  }

  // ─── Layout Operations ────────────────────────────────────────────────────────

  function setSplitDirection(direction) {
    if (direction !== 'horizontal' && direction !== 'vertical') return;
    _state.splitDirection = direction;
    _notify({ type: 'layout-changed', panelId: null, tabId: null });
  }

  function setPanelSize(panelId, ratio) {
    const panel = _findPanel(panelId);
    if (!panel) return;
    panel.sizeRatio = ratio;
    _notify({ type: 'panel-resized', panelId, tabId: null });
  }

  function splitPanel(panelId, direction, insertBeforePanelId = null) {
    if (direction !== 'horizontal' && direction !== 'vertical') return null;
    if (_state.panels.length >= 3) return null; // max 3 panels
    _state.splitDirection = direction;

    const newPanel = { id: _newId(), tabs: [], activeTabId: null, sizeRatio: 1 };
    _state.focusedPanelId = newPanel.id;

    if (insertBeforePanelId) {
      const idx = _state.panels.findIndex(p => p.id === insertBeforePanelId);
      if (idx !== -1) {
        _state.panels.splice(idx, 0, newPanel);
      } else {
        _state.panels.push(newPanel);
      }
    } else {
      _state.panels.push(newPanel);
    }

    _notify({ type: 'panel-added', panelId: newPanel.id, insertBeforePanelId: insertBeforePanelId || null, tabId: null });
    return newPanel;
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  window.TabState = {
    // Change notification
    onChange,
    offChange,
    // Tab operations
    addTab,
    removeTab,
    setActiveTab,
    reorderTab,
    moveTab,
    duplicateTab,
    duplicateTabToPanel,
    getTab,
    findTabByPath,
    updateTab,
    removeTabsByPath,
    renameTabsByPath,
    // Panel operations
    addPanel,
    removePanel,
    setFocusedPanel,
    getPanel,
    getFocusedPanel,
    // Accessors
    getState,
    getActiveTab,
    restoreState,
    // Layout operations
    setSplitDirection,
    setPanelSize,
    splitPanel,
  };
})();
