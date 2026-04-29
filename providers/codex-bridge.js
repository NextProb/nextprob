'use strict';
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

function findCodexBin() {
  const common = [
    path.join(os.homedir(), '.local', 'bin', 'codex'),
    '/usr/local/bin/codex',
    '/opt/homebrew/bin/codex',
  ];
  for (const p of common) {
    if (fs.existsSync(p)) return p;
  }
  return 'codex';
}

const CODEX_BIN = findCodexBin();

function sendToCodex({ prompt, cwd, model, permissionMode, onEvent, onError, onDone }) {
  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
  ];

  if (model) {
    args.push('--model', model);
  }

  if (permissionMode === 'danger-full-access') {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else if (permissionMode) {
    args.push('--sandbox', permissionMode);
  }

  args.push(prompt);

  const env = { ...process.env };

  const proc = spawn(CODEX_BIN, args, {
    cwd: cwd || process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.on('error', (err) => {
    if (err.code === 'ENOENT') {
      onError?.('Codex CLI is not installed. Install it with: npm install -g @openai/codex');
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

  return {
    kill: () => proc.kill(),
  };
}

module.exports = { sendToCodex, findCodexBin };
