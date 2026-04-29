'use strict';

const syncApi = require('./sync-api');

/**
 * Request a presigned PUT URL for uploading a file.
 * @param {string} key - Filename/path (scoped under u/{userId}/ server-side)
 * @param {string} contentType - MIME type
 * @param {object} [options]
 * @param {number} [options.expiresIn] - Presigned URL TTL in seconds (max 7 days)
 * @param {boolean} [options.persist] - If false, auto-deleted after 7 days (default true)
 * @returns {{ ok, data: { presignedUrl, objectKey, expiresIn } }}
 */
async function presignUpload(key, contentType, options = {}) {
  return syncApi.post('/storage/presign', {
    action: 'upload',
    key,
    contentType,
    expiresIn: options.expiresIn,
    persist: options.persist,
  });
}

/**
 * Request a presigned GET URL for downloading a file.
 * @param {string} key
 * @param {object} [options]
 * @param {number} [options.expiresIn]
 * @returns {{ ok, data: { presignedUrl, objectKey, expiresIn } }}
 */
async function presignDownload(key, options = {}) {
  return syncApi.post('/storage/presign', {
    action: 'download',
    key,
    expiresIn: options.expiresIn,
  });
}

/**
 * Delete a file from user storage.
 * @param {string} key
 * @returns {{ ok, data: { deleted } }}
 */
async function deleteFile(key) {
  return syncApi.post('/storage/presign', { action: 'delete', key });
}

/**
 * Upload a buffer and return the presigned download URL.
 * Convenience method combining presignUpload + uploadToPresignedUrl + presignDownload.
 * @param {string} key
 * @param {Buffer} buffer
 * @param {string} contentType
 * @param {object} [options]
 * @param {number} [options.expiresIn]
 * @param {boolean} [options.persist]
 * @returns {{ ok, data: { presignedUrl, objectKey, expiresIn } }}
 */
async function uploadBuffer(key, buffer, contentType, options = {}) {
  const presign = await presignUpload(key, contentType, options);
  if (!presign.ok) return presign;

  const upload = await syncApi.uploadToPresignedUrl(presign.data.presignedUrl, buffer, contentType);
  if (!upload.ok) return upload;

  return presignDownload(key, options);
}

module.exports = { presignUpload, presignDownload, deleteFile, uploadBuffer };
