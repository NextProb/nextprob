const path = require('path');
const fs = require('fs');

function conversationsDir(workspacePath) {
  return path.join(workspacePath, '.conversations');
}

function ensureDir(workspacePath) {
  const dir = conversationsDir(workspacePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function list(workspacePath) {
  const dir = conversationsDir(workspacePath);
  if (!fs.existsSync(dir)) return [];
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const items = [];
    for (const file of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        items.push({
          id: raw.id,
          title: raw.title || 'Untitled',
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
          messageCount: (raw.messages || []).length,
          firstMessage: raw.messages?.[0]?.content?.slice(0, 200) || '',
        });
      } catch { /* skip malformed */ }
    }
    return items.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  } catch {
    return [];
  }
}

function load(workspacePath, id) {
  const file = path.join(conversationsDir(workspacePath), `${id}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function save(workspacePath, conversation) {
  ensureDir(workspacePath);
  const file = path.join(conversationsDir(workspacePath), `${conversation.id}.json`);
  fs.writeFileSync(file, JSON.stringify(conversation, null, 2));
}

function remove(workspacePath, id) {
  const file = path.join(conversationsDir(workspacePath), `${id}.json`);
  try { fs.unlinkSync(file); } catch {}
}

function updateTitle(workspacePath, id, newTitle) {
  const conv = load(workspacePath, id);
  if (!conv) return;
  conv.title = newTitle;
  conv.updatedAt = new Date().toISOString();
  save(workspacePath, conv);
}

module.exports = { ensureDir, list, load, save, remove, updateTitle };
