'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const noteId = decodeURIComponent(window.location.pathname.replace(/^\//, '').replace(/\/index\.html$/, ''));

const ALLOWED_CHANNELS = [
  'outline-scroll',    // active heading changed during scroll
  'selection-changed', // text selected / deselected
  'link-click',        // internal/external link clicked
];

contextBridge.exposeInMainWorld('noteAPI', {
  ready: true,
  noteId,
  sendToHost: (channel, data) => {
    if (ALLOWED_CHANNELS.includes(channel)) {
      ipcRenderer.sendToHost(channel, data);
    }
  },
});

contextBridge.exposeInMainWorld('noteDB', {
  get:    (key)        => ipcRenderer.invoke('note-db:get', noteId, key),
  set:    (key, value) => ipcRenderer.invoke('note-db:set', noteId, key, value),
  delete: (key)        => ipcRenderer.invoke('note-db:delete', noteId, key),
  list:   ()           => ipcRenderer.invoke('note-db:list', noteId),
});

contextBridge.exposeInMainWorld('noteFiles', {
  save:   (name, data) => ipcRenderer.invoke('note-files:save', noteId, name, data),
  load:   (name)       => ipcRenderer.invoke('note-files:load', noteId, name),
  delete: (name)       => ipcRenderer.invoke('note-files:delete', noteId, name),
  list:   ()           => ipcRenderer.invoke('note-files:list', noteId),
  import: (options)    => ipcRenderer.invoke('note-files:import', noteId, options),
});

contextBridge.exposeInMainWorld('noteSQL', {
  exec:  (sql, params) => ipcRenderer.invoke('note-sql:exec',  noteId, sql, params),
  query: (sql, params) => ipcRenderer.invoke('note-sql:query', noteId, sql, params),
});

contextBridge.exposeInMainWorld('noteScripts', {
  run: (name, args) => ipcRenderer.invoke('note-scripts:run', noteId, name, args),
  stopByName: (name) => ipcRenderer.invoke('note-scripts:stop-by-name', noteId, name),
});

contextBridge.exposeInMainWorld('noteLog', {
  write: (msg) => ipcRenderer.invoke('note-log:write', noteId, String(msg).slice(0, 10000)),
});

// Auto-persist form state across reloads/reopens
// Runs in the isolated preload context: has DOM access + ipcRenderer, no need for window.noteDB

const AUTOSAVE_KEY = '__autosave';
const PERSISTABLE_SELECTOR = 'input:not([type=password]):not([type=hidden]):not([data-no-persist]), textarea:not([data-no-persist]), select:not([data-no-persist]), [contenteditable]:not([data-no-persist])';

function elementKey(el) {
  if (el.id) return `#${el.id}`;
  if (el.name) return `name:${el.name}`;
  // Stable positional selector from body
  const parts = [];
  let node = el;
  while (node && node.tagName && node.tagName !== 'BODY') {
    const tag = node.tagName.toLowerCase();
    const parent = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
      const idx = siblings.indexOf(node);
      parts.unshift(siblings.length > 1 ? `${tag}:nth-child(${idx + 1})` : tag);
    } else {
      parts.unshift(tag);
    }
    node = node.parentElement;
  }
  return `path:${parts.join('>')}`;
}

function getElementValue(el) {
  if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
  if (el.hasAttribute('contenteditable')) return el.innerHTML;
  return el.value;
}

function setElementValue(el, value) {
  if (el.type === 'checkbox' || el.type === 'radio') {
    el.checked = value;
  } else if (el.hasAttribute('contenteditable')) {
    el.innerHTML = value;
  } else {
    el.value = value;
  }
}

function collectState() {
  const state = {};
  document.querySelectorAll(PERSISTABLE_SELECTOR).forEach(el => {
    state[elementKey(el)] = getElementValue(el);
  });
  return state;
}

async function saveState() {
  const state = collectState();
  await ipcRenderer.invoke('note-db:set', noteId, AUTOSAVE_KEY, state);
}

async function restoreState() {
  const state = await ipcRenderer.invoke('note-db:get', noteId, AUTOSAVE_KEY);
  if (!state || typeof state !== 'object') return;
  document.querySelectorAll(PERSISTABLE_SELECTOR).forEach(el => {
    const key = elementKey(el);
    if (key in state) setElementValue(el, state[key]);
  });
}

// Debounced save
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 500);
}

window.addEventListener('DOMContentLoaded', () => {
  restoreState();
  document.addEventListener('input', scheduleSave);
  document.addEventListener('change', scheduleSave);
});
