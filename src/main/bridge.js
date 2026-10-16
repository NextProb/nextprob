const { spawn } = require("child_process");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const fs = require("fs");

// Resolve claude binary portably — Electron GUI apps don't inherit shell PATH
function findClaudeBin() {
  const common = [
    path.join(os.homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
  ];
  for (const p of common) {
    if (fs.existsSync(p)) return p;
  }
  return "claude";
}

const CLAUDE_BIN = findClaudeBin();

function sendToClaude({ prompt, cwd, sessionId, isResume, model, effort, permissionMode, unsetApiKeys, onEvent, onError, onDone }) {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
  ];

  if (isResume && sessionId) {
    args.push("--resume", sessionId);
  } else if (sessionId) {
    args.push("--session-id", sessionId);
  }

  if (model) {
    args.push("--model", model);
  }

  if (effort && effort !== 'default') {
    args.push("--effort", effort);
  }

  if (permissionMode === 'bypassPermissions') {
    args.push('--dangerously-skip-permissions');
  } else if (permissionMode) {
    args.push('--permission-mode', permissionMode);
  }

  args.push(prompt);

  // Remove CLAUDECODE env var to prevent "nested session" rejection
  const env = { ...process.env };
  delete env.CLAUDECODE;
  if (unsetApiKeys) {
    if (unsetApiKeys.anthropic) delete env.ANTHROPIC_API_KEY;
    if (unsetApiKeys.openai) delete env.OPENAI_API_KEY;
    if (unsetApiKeys.gemini) delete env.GEMINI_API_KEY;
  }

  const proc = spawn(CLAUDE_BIN, args, {
    cwd: cwd || process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let buffer = "";
  proc.stdout.on("data", (buf) => {
    buffer += buf.toString();
    const lines = buffer.split("\n");
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

  proc.stderr.on("data", (buf) => {
    onError?.(buf.toString());
  });

  proc.on("close", (code) => {
    onDone?.(code);
  });

  return {
    kill: () => proc.kill(),
  };
}

function generateSessionId() {
  return crypto.randomUUID();
}

module.exports = { sendToClaude, generateSessionId };
