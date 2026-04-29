'use strict';

const https = require('https');
const auth = require('./auth');

let _apiBaseUrl = null;

function init() {
  if (_apiBaseUrl) return;
  const stage = process.env.APP_STAGE || 'dev';
  const cfg = require('./auth-config.json');
  _apiBaseUrl = (cfg[stage] || cfg['dev']).syncApiEndpoint;
}

/**
 * Authenticated POST to a sync Lambda endpoint.
 * Returns { ok: true, data } or { ok: false, error, statusCode }.
 */
async function post(urlPath, body) {
  init();
  const token = await auth.getAccessToken();
  if (!token) return { ok: false, error: 'not-authenticated' };

  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const url = new URL(_apiBaseUrl + urlPath);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        if (res.statusCode === 401) {
          return resolve({ ok: false, error: 'auth-expired', statusCode: 401 });
        }
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode >= 200 && res.statusCode < 300 && parsed.success) {
            resolve({ ok: true, data: parsed.data });
          } else {
            resolve({ ok: false, error: parsed.error || 'request-failed', statusCode: res.statusCode });
          }
        } catch {
          resolve({ ok: false, error: 'invalid-json', statusCode: res.statusCode });
        }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.write(payload);
    req.end();
  });
}

/**
 * HTTP PUT of raw file content to an S3 presigned URL.
 * Returns { ok: true } or { ok: false, error }.
 */
async function uploadToPresignedUrl(presignedUrl, buffer, contentType) {
  return new Promise((resolve) => {
    const url = new URL(presignedUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : require('http');
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': buffer.length,
      },
    };
    const req = lib.request(options, (res) => {
      res.resume(); // drain response
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true });
        } else {
          resolve({ ok: false, error: `s3-put-${res.statusCode}`, statusCode: res.statusCode });
        }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.write(buffer);
    req.end();
  });
}

/**
 * HTTP GET from an S3 presigned URL.
 * Returns { ok: true, buffer } or { ok: false, error }.
 */
async function downloadFromPresignedUrl(presignedUrl) {
  return new Promise((resolve) => {
    const url = new URL(presignedUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : require('http');
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
    };
    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, buffer: Buffer.concat(chunks) });
        } else {
          resolve({ ok: false, error: `s3-get-${res.statusCode}`, statusCode: res.statusCode });
        }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.end();
  });
}

/**
 * Request a presigned URL to publish a note as a shareable link.
 * Returns { ok, data: { shareId, presignedPutUrl, shareUrl } }.
 */
async function publishNote(noteId, contentLength) {
  return post('/notes/share/publish', { noteId, contentLength });
}

/**
 * Remove a published note.
 * Returns { ok, data: { success } }.
 */
async function unpublishNote(shareId) {
  return post('/notes/share/unpublish', { shareId });
}

module.exports = { init, post, uploadToPresignedUrl, downloadFromPresignedUrl, publishNote, unpublishNote };
