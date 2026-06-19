#!/usr/bin/env node
// record.js — MANDATORY session recorder. Run this in a separate terminal for
// the entire duration of the assignment:
//
//     node recorder/record.js
//
// It watches src/ and test/ and appends edit events to recorder/session.jsonl.
// It records sizes and diff magnitudes of your edits over time — NOT your
// keystrokes, screen, or file contents (only SHA-256 hashes of content are
// stored, never the code itself). Submit session.jsonl with your solution.
//
// Dependency-free (Node built-ins only). Stop with Ctrl-C.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const WATCH_DIRS = ['src', 'test'].map((d) => path.join(ROOT, d));
const OUT = path.join(__dirname, 'session.jsonl');
const POLL_MS = 400;

const EXT = new Set(['.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx']);
const last = new Map(); // relPath -> { lines: string[], hash }

function now() {
  return Date.now();
}

function walk(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (EXT.has(path.extname(e.name))) acc.push(full);
  }
  return acc;
}

function sha(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

// Minimal LCS-based line diff -> {added, removed}. Adequate for paste-size heuristics.
function lineDiff(oldLines, newLines) {
  const n = oldLines.length;
  const m = newLines.length;
  // DP table can be large; cap to keep the recorder light.
  if (n * m > 4_000_000) {
    return { added: Math.max(0, m - n), removed: Math.max(0, n - m), approx: true };
  }
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lcs = dp[0][0];
  return { added: m - lcs, removed: n - lcs, approx: false };
}

function emit(ev) {
  fs.appendFileSync(OUT, JSON.stringify(ev) + '\n');
}

function scan(first) {
  for (const dir of WATCH_DIRS) {
    for (const file of walk(dir, [])) {
      let content;
      try {
        content = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const rel = path.relative(ROOT, file);
      const hash = sha(content);
      const prev = last.get(rel);
      if (prev && prev.hash === hash) continue;
      const lines = content.split('\n');
      const diff = prev ? lineDiff(prev.lines, lines) : { added: lines.length, removed: 0 };
      last.set(rel, { lines, hash });
      if (!first || !prev) {
        emit({
          type: prev ? 'edit' : 'seed',
          t: now(),
          rel,
          bytes: Buffer.byteLength(content),
          totalLines: lines.length,
          addedLines: diff.added,
          removedLines: diff.removed,
          hash,
        });
      }
    }
  }
}

emit({ type: 'session_start', t: now(), node: process.version, root: ROOT });
scan(true); // seed snapshot of whatever already exists
const timer = setInterval(() => scan(false), POLL_MS);

function shutdown() {
  clearInterval(timer);
  emit({ type: 'session_end', t: now() });
  console.log(`\nSession recorded to ${OUT}`);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
console.log(`Recording edits to ${OUT}. Leave this running. Ctrl-C when done.`);
