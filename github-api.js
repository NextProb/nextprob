'use strict';

// GitHub REST operations for gist-backed sharing: gist CRUD, repo provisioning,
// Pages enablement, idempotent renderer push. All authenticated requests go
// through github-auth.apiRequest so the access token stays in one place.

const github = require('./github-auth');

const GIST_FILENAME = 'note.html';
const RENDERER_REPO_DESCRIPTION = 'Renderer for notes shared from ToutKit Notes';

function _ok(res, msg) {
  if (res.status >= 200 && res.status < 300) return res.body;
  const detail = (res.body && (res.body.message || res.body.errors));
  throw new Error(`${msg}: ${typeof detail === 'string' ? detail : (detail ? JSON.stringify(detail) : `HTTP ${res.status}`)}`);
}

// ─── Gist operations ─────────────────────────────────────────────────────────

async function createGist({ html, isPublic }) {
  const res = await github.apiRequest('POST', '/gists', {
    body: { public: !!isPublic, files: { [GIST_FILENAME]: { content: html } } },
  });
  const data = _ok(res, 'Failed to create gist');
  return { id: data.id, htmlUrl: data.html_url, isPublic: !!data.public };
}

async function updateGist(id, html) {
  const res = await github.apiRequest('PATCH', `/gists/${id}`, {
    body: { files: { [GIST_FILENAME]: { content: html } } },
  });
  _ok(res, 'Failed to update gist');
}

async function deleteGist(id) {
  const res = await github.apiRequest('DELETE', `/gists/${id}`);
  if (res.status === 204 || res.status === 404) return; // 404 = already gone
  throw new Error(`Failed to delete gist: HTTP ${res.status}`);
}

// ─── Repo + Pages provisioning ───────────────────────────────────────────────

function _login() {
  const u = github.getUser();
  if (!u || !u.login) throw new Error('Not connected to GitHub');
  return u.login;
}

async function repoExists(name) {
  const res = await github.apiRequest('GET', `/repos/${_login()}/${encodeURIComponent(name)}`);
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`Could not check repo: HTTP ${res.status}`);
}

async function createRepo(name) {
  const res = await github.apiRequest('POST', '/user/repos', {
    body: {
      name,
      private: false,
      description: RENDERER_REPO_DESCRIPTION,
      has_issues: false,
      has_projects: false,
      has_wiki: false,
      auto_init: false,
    },
  });
  _ok(res, `Failed to create repo "${name}"`);
}

async function _getFile(repo, filePath) {
  const res = await github.apiRequest('GET',
    `/repos/${_login()}/${encodeURIComponent(repo)}/contents/${encodeURI(filePath)}`);
  if (res.status === 404) return null;
  if (res.status !== 200 || !res.body) throw new Error(`Could not read ${filePath}: HTTP ${res.status}`);
  let content = '';
  if (res.body.encoding === 'base64' && typeof res.body.content === 'string') {
    content = Buffer.from(res.body.content, 'base64').toString('utf8');
  }
  return { sha: res.body.sha, content };
}

async function getFileSha(repo, filePath) {
  const f = await _getFile(repo, filePath);
  return f ? f.sha : null;
}

// Marker baked into our renderer. When ensureRepoProvisioned hits a repo
// that already exists, we refuse to push unless its index.html is one of
// ours (or the repo is empty). This stops us from clobbering an unrelated
// repo if the user picks a name that's already taken.
const RENDERER_MARKER = '<!-- toutkit-share-renderer -->';

async function _assertSafeToProvision(repo) {
  const existing = await _getFile(repo, 'index.html');
  if (!existing) return; // empty repo (or no index.html) — safe to seed
  if (!existing.content.includes(RENDERER_MARKER)) {
    throw new Error(
      `Repo "${repo}" already exists on your account and looks like a different project ` +
      `(its index.html isn't a ToutKit share renderer). Pick a different repo name in Settings → Sharing → Change.`
    );
  }
}

/**
 * Pre-check whether `name` is usable as a *-shares repo for the connected
 * user. Returns one of:
 *   { ok: true, status: 'available' }  // name free, will be created on publish
 *   { ok: true, status: 'reusable' }   // exists and bears our renderer marker
 *   { ok: false, message: '…' }        // collision, format error, network error
 */
async function checkRepoName(name) {
  const trimmed = String(name || '').trim();
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(trimmed) || trimmed === '.' || trimmed === '..') {
    return { ok: false, message: 'Use letters, numbers, dots, hyphens, underscores. Max 100 chars.' };
  }
  let exists;
  try { exists = await repoExists(trimmed); }
  catch (err) { return { ok: false, message: err.message || 'Could not reach GitHub.' }; }
  if (!exists) return { ok: true, status: 'available' };
  try {
    const existing = await _getFile(trimmed, 'index.html');
    if (!existing) return { ok: true, status: 'reusable' };
    if (existing.content.includes(RENDERER_MARKER)) return { ok: true, status: 'reusable' };
  } catch (err) {
    return { ok: false, message: `Could not inspect repo "${trimmed}": ${err.message}` };
  }
  return {
    ok: false,
    message: `Repo "${trimmed}" already exists on your account and looks like a different project. Pick a different name to avoid overwriting your files.`,
  };
}

async function putFile(repo, filePath, content, message, sha) {
  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
  };
  if (sha) body.sha = sha;
  const res = await github.apiRequest('PUT',
    `/repos/${_login()}/${encodeURIComponent(repo)}/contents/${encodeURI(filePath)}`,
    { body });
  _ok(res, `Failed to push ${filePath}`);
}

async function enablePages(repo) {
  const res = await github.apiRequest('POST',
    `/repos/${_login()}/${encodeURIComponent(repo)}/pages`,
    { body: { source: { branch: 'main', path: '/' } } });
  // 201 = just created (build pending). 409 = already enabled — idempotent.
  if (res.status === 201) return { justEnabled: true };
  if (res.status === 204 || res.status === 409) return { justEnabled: false };
  throw new Error(`Failed to enable Pages: ${(res.body && res.body.message) || `HTTP ${res.status}`}`);
}

/**
 * Poll the Pages build status until it reports `built` or we hit the timeout.
 * Only worth calling on first provision — subsequent builds are usually instant
 * because the renderer rarely changes. Returns true if built within the window,
 * false on timeout or build error (caller may still return the URL — Pages
 * eventually catches up).
 */
async function waitForPagesBuilt(repo, { timeoutMs = 90000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await github.apiRequest('GET',
      `/repos/${_login()}/${encodeURIComponent(repo)}/pages/builds/latest`);
    if (res.status === 200 && res.body) {
      if (res.body.status === 'built') return true;
      if (res.body.status === 'errored') return false;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// ─── Renderer push (skip if SHA already matches) ─────────────────────────────

async function _ensureFile(repo, filePath, content, desiredSha) {
  const existingSha = await getFileSha(repo, filePath);
  if (existingSha && desiredSha && existingSha === desiredSha) return false;
  const message = existingSha ? `Update ${filePath}` : `Add ${filePath}`;
  await putFile(repo, filePath, content, message, existingSha || undefined);
  return true;
}

/**
 * Idempotent: creates the repo if missing, pushes renderer files if absent
 * or stale, and enables Pages. Safe to call before every publish.
 *
 * @param {string} repo - The repo name (owner is the connected user).
 * @param {{ indexHtml, robotsTxt, indexSha }} renderer - From share-renderer.getRenderer().
 * @returns {Promise<{ firstProvision: boolean }>} firstProvision is true when
 *   we just enabled Pages — caller should waitForPagesBuilt before surfacing
 *   the share URL, since Pages 404s for ~30–60 s during the first build.
 */
async function ensureRepoProvisioned(repo, renderer) {
  const repoCreated = !(await repoExists(repo));
  if (repoCreated) {
    await createRepo(repo);
  } else {
    await _assertSafeToProvision(repo);
  }
  await _ensureFile(repo, 'index.html', renderer.indexHtml, renderer.indexSha);
  await _ensureFile(repo, 'robots.txt', renderer.robotsTxt, null);
  const pages = await enablePages(repo);
  return { firstProvision: repoCreated || pages.justEnabled };
}

function pagesUrl(repo, gistId) {
  return `https://${_login()}.github.io/${repo}/?id=${encodeURIComponent(gistId)}`;
}

module.exports = {
  createGist,
  updateGist,
  deleteGist,
  repoExists,
  checkRepoName,
  ensureRepoProvisioned,
  waitForPagesBuilt,
  pagesUrl,
};
