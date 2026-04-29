'use strict';
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

function findGeminiBin() {
  const common = [
    path.join(os.homedir(), '.local', 'bin', 'gemini'),
    '/usr/local/bin/gemini',
    '/opt/homebrew/bin/gemini',
  ];
  for (const p of common) {
    if (fs.existsSync(p)) return p;
  }
  return 'gemini';
}

const GEMINI_BIN = findGeminiBin();

function sendToGemini({ prompt, cwd, model, permissionMode, onEvent, onError, onDone }) {
  const args = [];

  if (model) {
    args.push('--model', model);
  }

  args.push('-p', prompt, '--output-format', 'stream-json');
  if (permissionMode === 'yolo') {
    args.push('-y');
  } else if (permissionMode) {
    args.push('--approval-mode', permissionMode);
  }

  const env = { ...process.env };
  // Remove session vars that could cause nested-session issues
  delete env.GEMINI_SESSION_ID;

  const proc = spawn(GEMINI_BIN, args, {
    cwd: cwd || process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.on('error', (err) => {
    if (err.code === 'ENOENT') {
      onError?.('Gemini CLI is not installed. Install it with: npm install -g @google/gemini-cli');
    } else {
      onError?.(err.message);
    }
    onDone?.(1);
  });

  let buffer = '';
  proc.stdout.on('data', (buf) => {
    buffer += buf.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent?.(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
  });

  proc.stderr.on('data', (buf) => {
    onError?.(buf.toString());
  });

  proc.on('close', (code) => {
    onDone?.(code);
  });

  return { kill: () => proc.kill() };
}

module.exports = { sendToGemini, findGeminiBin };
