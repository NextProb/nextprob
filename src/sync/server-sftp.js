'use strict';

const path = require('path');
const { Client } = require('ssh2');

class ServerSftp {
  constructor({ host, port = 22, username, password, privateKeyPath, agent, remotePath }) {
    this._host = host;
    this._port = port;
    this._username = username;
    this._password = password;
    this._privateKeyPath = privateKeyPath;
    this._agent = agent;
    this._remotePath = remotePath;
    this._client = null;
    this._sftp = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this._sftp) { resolve(); return; }

      const client = new Client();
      const config = {
        host: this._host,
        port: this._port,
        username: this._username,
        keepaliveInterval: 30000,
        keepaliveCountMax: 3,
        readyTimeout: 15000,
      };

      if (this._agent) {
        config.agent = this._agent;
      } else if (this._privateKeyPath) {
        try {
          const keyPath = this._privateKeyPath.startsWith('~')
            ? require('os').homedir() + this._privateKeyPath.slice(1)
            : this._privateKeyPath;
          config.privateKey = require('fs').readFileSync(keyPath, 'utf8');
        } catch (err) {
          reject(new Error(`Cannot read SSH key: ${err.message}`));
          return;
        }
      } else if (this._password) {
        config.password = this._password;
      }

      client.on('ready', () => {
        client.sftp((err, sftp) => {
          if (err) { client.end(); reject(err); return; }
          this._client = client;
          this._sftp = sftp;
          resolve();
        });
      });

      client.on('error', (err) => {
        this._client = null;
        this._sftp = null;
        reject(err);
      });

      client.on('end', () => {
        this._client = null;
        this._sftp = null;
      });

      client.connect(config);
    });
  }

  disconnect() {
    if (this._client) {
      this._client.end();
      this._client = null;
      this._sftp = null;
    }
  }

  isConnected() {
    return !!(this._sftp && this._client);
  }

  /**
   * Recursively list files under remoteDirPath, filtered by ignore instance.
   * Returns [{ relPath, mtime, size }].
   */
  async listFiles(remoteDirPath, ig) {
    const results = [];
    await this._walkRemote(remoteDirPath, remoteDirPath, results, ig);
    return results;
  }

  async _walkRemote(baseDir, currentDir, results, ig) {
    const entries = await this._readdir(currentDir);
    for (const entry of entries) {
      const abs = currentDir + '/' + entry.filename;
      const relPath = abs.slice(baseDir.length + 1);
      const isDir = (entry.attrs.mode & 0o40000) !== 0;
      if (isDir) {
        if (ig && ig.ignores(relPath + '/')) continue;
        await this._walkRemote(baseDir, abs, results, ig);
      } else {
        if (ig && ig.ignores(relPath)) continue;
        results.push({
          relPath,
          mtime: entry.attrs.mtime * 1000, // convert to ms
          size: entry.attrs.size,
        });
      }
    }
  }

  _readdir(dirPath) {
    return new Promise((resolve, reject) => {
      this._sftp.readdir(dirPath, (err, list) => {
        if (err) {
          if (err.code === 2) { resolve([]); return; } // ENOENT
          reject(err); return;
        }
        resolve(list || []);
      });
    });
  }

  readFile(filePath) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const stream = this._sftp.createReadStream(filePath);
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  writeFile(filePath, buffer) {
    return new Promise((resolve, reject) => {
      // Ensure parent directory exists
      const dir = filePath.substring(0, filePath.lastIndexOf('/'));
      this._mkdirp(dir).then(() => {
        const stream = this._sftp.createWriteStream(filePath);
        stream.on('close', resolve);
        stream.on('error', reject);
        stream.end(buffer);
      }).catch(reject);
    });
  }

  deleteFile(filePath) {
    return new Promise((resolve, reject) => {
      this._sftp.unlink(filePath, (err) => {
        if (err) { reject(err); return; }
        resolve();
      });
    });
  }

  stat(filePath) {
    return new Promise((resolve, reject) => {
      this._sftp.stat(filePath, (err, stats) => {
        if (err) { reject(err); return; }
        resolve(stats);
      });
    });
  }

  mkdir(dirPath) {
    return new Promise((resolve, reject) => {
      this._sftp.mkdir(dirPath, (err) => {
        if (err && err.code !== 4) { reject(err); return; } // 4 = already exists
        resolve();
      });
    });
  }

  async _mkdirp(dirPath) {
    const parts = dirPath.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current += '/' + part;
      await this.mkdir(current).catch(() => {});
    }
  }
}

module.exports = { ServerSftp };
