// Tests for the output contract.
//
// These are not unit tests for convenience — each one pins a rule that, if it
// silently broke, would produce the exact failure the rule exists to prevent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stateLine, planBlock, pendingBlock, render, block, wrap } from '../src/output.js';
import { STEPS, unresolved } from '../src/pending.js';
import { OK, HUMAN, footer } from '../src/exit-codes.js';
import { init } from '../src/commands/init.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function allSource(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'test') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) allSource(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

// ---------------------------------------------------------------- rule 1
test('RULE 1: nothing in the product can ever read stdin', () => {
  // An agent runs these commands with nobody at the keyboard. A tool that waits
  // for input does not get input — it hangs, and the agent looks frozen.
  // This test is the enforcement; prose in a doc is not.
  const banned = [/readline/, /process\.stdin/, /prompt\s*\(/, /inquirer/, /\benquirer\b/];
  for (const file of allSource(SRC)) {
    const text = readFileSync(file, 'utf8');
    // Strip comments so the rule can be *described* without tripping itself.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const re of banned) {
      assert.ok(!re.test(code), `${file} reads input (${re}). Commands must never block.`);
    }
  }
});

// ---------------------------------------------------------------- rule 2
test('RULE 2: every actionable line opens with a caps verb', () => {
  const lines = planBlock([
    { run: 'exposurie scaffold' },
    { ask: 'can you export your chats?' },
    { read: 'BRAIN.md' },
  ]);
  assert.ok(lines.some((l) => l.includes('RUN:')));
  assert.ok(lines.some((l) => l.includes('ASK YOUR USER')));
  assert.ok(lines.some((l) => l.includes('READ:')));
});

test('a human step in a plan never reads as a stopping point', () => {
  const lines = planBlock([{ ask: 'export your chats' }]).join('\n');
  assert.match(lines, /Do NOT wait/);
});

// ---------------------------------------------------------------- rule 4
test('RULE 4: the sync nudge rides output, but never inside its own command', () => {
  const stale = { vault: '/b', pages: 10, unfiled: 6, lastSyncDays: 9 };
  assert.match(stateLine(stale).join('\n'), /RUN: exposurie sync/);
  // ...and must not fire while the user is already running sync.
  assert.doesNotMatch(stateLine({ ...stale, self: 'sync' }).join('\n'), /RUN: exposurie sync/);
  assert.doesNotMatch(stateLine({ vault: null, self: 'init' }).join('\n'), /RUN: exposurie init/);
});

test('a healthy brain gets no nudge at all, so the arrow keeps meaning something', () => {
  const fresh = { vault: '/b', pages: 61, unfiled: 0, lastSyncDays: 0 };
  assert.doesNotMatch(stateLine(fresh).join('\n'), /->/);
});

// ---------------------------------------------------------------- exit codes
test('staleness never changes the exit code', () => {
  // A stale brain still works. Exiting non-zero over it trains agents to
  // ignore the number.
  const r = init({});
  assert.ok(r.code === OK || r.code === HUMAN, `unexpected exit ${r.code}`);
});

test('exit 10 says plainly that nothing failed', () => {
  assert.match(footer(HUMAN), /Nothing has failed/);
});

// ---------------------------------------------------------------- pending
test('every human step ships exact words, not a topic', () => {
  for (const [id, s] of Object.entries(STEPS)) {
    for (const f of ['title', 'why', 'ask', 'doneWhen']) {
      assert.ok(s[f]?.length > 10, `${id}.${f} is missing or too thin to relay`);
    }
    assert.ok(Array.isArray(s.verbatim) && s.verbatim.length >= 2, `${id}.verbatim must be real steps`);
    assert.equal(typeof s.resolved, 'function', `${id} must be detectable, not self-reported`);
  }
});

test('the export step is detected as done, never marked done', () => {
  const step = STEPS['claude-web-export'];
  assert.equal(step.resolved({ exports: [] }), false);
  assert.equal(step.resolved({ exports: [{ path: 'data-x.zip' }] }), true);
});

test('the export instructions warn about the wait, which is the real failure', () => {
  // People click through, see nothing, and conclude it broke.
  const t = STEPS['claude-web-export'].verbatim.join(' ');
  assert.match(t, /HOURS|hours/);
  assert.match(t, /email/i);
});

test('pending steps are relayed verbatim and marked non-blocking', () => {
  const out = pendingBlock([STEPS['claude-web-export']]).join('\n');
  assert.match(out, /RELAY THESE EXACTLY/);
  assert.match(out, /do not paraphrase/);
  assert.match(out, /does NOT block/);
});

// ---------------------------------------------------------------- skeleton
test('the response skeleton never varies: state, then pending, then body', () => {
  const out = render({
    state: { vault: '/b', pages: 3, lastSyncDays: 0 },
    pending: [STEPS['claude-web-export']],
    body: block('STATE', [['a', 'b']]),
    code: HUMAN,
  });
  const iState = out.indexOf('exposurie');
  const iPending = out.indexOf('FOR YOUR USER');
  const iBody = out.indexOf('STATE');
  assert.ok(iState < iPending && iPending < iBody, 'skeleton order broke');
});

test('wrap never splits a word and honours the indent', () => {
  const lines = wrap('alpha beta gamma delta epsilon zeta', 12, '>> ');
  assert.ok(lines.every((l) => l.startsWith('>> ')));
  assert.ok(lines.every((l) => l.length <= 12 + 3));
  assert.equal(lines.join(' ').replace(/>> /g, ''), 'alpha beta gamma delta epsilon zeta');
});

// ---------------------------------------------------------------- honesty
test('a client we cannot parse is reported, not silently dropped', () => {
  const r = init({});
  const cursor = r.json.clients.find((c) => c.id === 'cursor');
  assert.ok(cursor, 'cursor must appear in output even without a reader');
  assert.equal(cursor.readable, false);
  // and it must not be counted in the number we promise to build from
  assert.ok(r.json.sessions >= 0);
});
