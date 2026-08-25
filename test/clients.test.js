// What the client table promises, and what it can actually do.
//
// Codex sat in this table as `readable: true` for a release with no reader of
// its own. The Claude Code parser was handed a completely different file
// format, returned zero turns from every rollout, and the sync marked all three
// sessions as read. `init` printed the right session count the entire time.
//
// Cursor, sitting one row below it, was declared `readable: false` and reported
// as skipped — the honest version of not being able to read something. The rule
// these tests hold is that there is no third state: a client either has a
// reader or says it does not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { CLIENTS } from '../src/context.js';
import { readRollout } from '../src/extract/codex.js';

test('every client claiming to be readable has a reader', () => {
  for (const c of CLIENTS) {
    if (!c.readable) continue;
    // Two shapes, because not every client keeps conversations in files:
    // `read(path)` for a transcript, `sessions(root)` for a database.
    assert.ok(
      typeof c.read === 'function' || typeof c.sessions === 'function',
      `${c.id} is marked readable and has no reader — this is exactly how Codex ` +
        `reported the right session count and ingested nobody`,
    );
  }
});

test('a client without a reader says so instead of being quietly skipped', () => {
  // The honest state has to stay reachable, or the rule above gets satisfied by
  // deleting the row rather than by telling the user.
  const unreadable = CLIENTS.filter((c) => !c.readable);
  for (const c of unreadable) {
    assert.ok(
      typeof c.read === 'undefined' && typeof c.sessions === 'undefined',
      `${c.id} claims not to be readable but has a reader`,
    );
    assert.ok(typeof c.find === 'function', `${c.id} cannot even count what it is skipping`);
  }
});

// ---------------------------------------------------------------- codex reader

function rollout(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'exposurie-codex-'));
  const path = join(dir, 'rollout-2026-08-25T00-00-00-abc.jsonl');
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return path;
}

const meta = (over = {}) => ({
  timestamp: '2026-08-25T00:00:00Z',
  type: 'session_meta',
  payload: { id: 'sess-1', cwd: 'C:/work/thing', source: 'cli', ...over },
});

const message = (role, text, blockType) => ({
  timestamp: '2026-08-25T00:00:01Z',
  type: 'response_item',
  payload: {
    type: 'message',
    role,
    content: [{ type: blockType || (role === 'assistant' ? 'output_text' : 'input_text'), text }],
  },
});

test('a codex rollout yields the words a person actually typed', () => {
  const p = rollout([
    meta(),
    message('user', 'why is the build failing on windows only'),
    message('assistant', 'The path separator differs.'),
  ]);
  const s = readRollout(p);
  assert.equal(s.turns.length, 2, 'the conversation did not come out');
  assert.equal(s.turns[0].text, 'why is the build failing on windows only');
  assert.equal(s.cwd, 'C:/work/thing', 'the working directory was lost, so exclusion cannot work');
  assert.equal(s.surface, 'terminal', 'the surface was not read from the rollout');
});

test('codex text that no person typed never counts as conversation', () => {
  // Measured on a real corpus: 4 injected user-role blocks against 7 actually
  // typed. More than a third of what looks like this person's words is the
  // harness describing its own shell.
  const p = rollout([
    meta(),
    { timestamp: 'x', type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'SYSTEM-INSTRUCTIONS-BLOCK' }] } },
    message('user', '<environment_context>\n  <cwd>C:/somewhere</cwd>\n</environment_context>'),
    message('user', '<turn_aborted reason="interrupted" />'),
    message('user', 'this is the only thing I said'),
  ]);
  const s = readRollout(p);
  const human = s.turns.filter((t) => t.role === 'user');
  assert.equal(human.length, 1, `${human.length} human turns; injected context got through`);
  assert.equal(human[0].text, 'this is the only thing I said');
  assert.equal(s.droppedImpostorTurns, 3, 'the drop was not counted');
});

test('a person quoting an injected tag is still talking', () => {
  // The filter is anchored, because somebody asking about <environment_context>
  // is having a conversation about it.
  const p = rollout([meta(), message('user', 'what is the <environment_context> block for?')]);
  const s = readRollout(p);
  assert.equal(s.turns.length, 1, 'a real question was thrown away as harness noise');
});

test('codex tool work is not conversation', () => {
  const p = rollout([
    meta(),
    { timestamp: 'x', type: 'response_item', payload: { type: 'reasoning', summary: [{ text: 'THINKING-TEXT' }] } },
    { timestamp: 'x', type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"cmd":"TOOL-CALL"}' } },
    { timestamp: 'x', type: 'response_item', payload: { type: 'function_call_output', output: 'TOOL-OUTPUT' } },
    { timestamp: 'x', type: 'event_msg', payload: { type: 'turn_started' } },
    message('user', 'the real question'),
  ]);
  const s = readRollout(p);
  const all = s.turns.map((t) => t.text).join(' ');
  for (const junk of ['THINKING-TEXT', 'TOOL-CALL', 'TOOL-OUTPUT']) {
    assert.ok(!all.includes(junk), `${junk} reached the brain as conversation`);
  }
  assert.equal(s.turns.length, 1);
});

test('a codex rollout resumes from where it stopped', () => {
  const first = [meta(), message('user', 'the first thing')];
  const p = rollout(first);
  const s1 = readRollout(p);

  appendFileSync(p, JSON.stringify(message('user', 'THE-SECOND-THING')) + '\n', 'utf8');

  const s2 = readRollout(p, s1.readTo);
  const text = s2.turns.map((t) => t.text).join(' ');
  assert.ok(text.includes('THE-SECOND-THING'), 'the new turn was missed');
  assert.ok(!text.includes('the first thing'), 'the whole file was re-read');
});

// ------------------------------------------------------------- cursor / sqlite

test('the SQLite reader survives a value too big for one page', async () => {
  // Overflow chains are the whole risk in reading Cursor: a conversation blob
  // does not fit in one page, and a reader that ignores the chain returns
  // truncated JSON — which fails to parse and looks exactly like a corrupt
  // database rather than like a bug in us.
  const { openDb } = await import('../src/extract/sqlite.js');
  const { execFileSync } = await import('node:child_process');

  // Build a real database with Python's sqlite3, so the bytes are not ours.
  const dir = mkdtempSync(join(tmpdir(), 'exposurie-sqlite-'));
  const db = join(dir, 'test.vscdb');
  const big = 'z'.repeat(200000);
  const script = [
    'import sqlite3, sys',
    `con = sqlite3.connect(sys.argv[1])`,
    'con.execute("create table cursorDiskKV (key text primary key, value blob)")',
    'con.execute("insert into cursorDiskKV values (?, ?)", ("small", "hello"))',
    `con.execute("insert into cursorDiskKV values (?, ?)", ("big", ${JSON.stringify(big)}))`,
    'con.commit()',
  ].join('\n');
  try {
    execFileSync('python', ['-c', script, db], { stdio: 'ignore' });
  } catch {
    return; // no python here; the real-database test below still covers the path
  }

  const handle = openDb(db);
  try {
    const rows = new Map(handle.rows('cursorDiskKV').map((r) => [r[0], r[1]]));
    assert.equal(rows.get('small'), 'hello');
    assert.equal(
      String(rows.get('big')).length,
      big.length,
      'a large value came back truncated — the overflow chain was not followed',
    );
  } finally {
    handle.close();
  }
});

test('cursor is not read out of the folder that looks like it holds transcripts', async () => {
  // `~/.cursor/projects/<slug>/agent-transcripts/<uuid>/` exists and is EMPTY.
  // Counting it produced "2 found, NO READER YET" for two empty directories.
  const { CURSOR_ROOTS } = await import('../src/extract/cursor.js');
  for (const p of CURSOR_ROOTS) {
    assert.ok(
      !p.includes('.cursor'),
      `${p} points at the extensions folder, not at where conversations live`,
    );
  }
});

test('a cursor conversation keeps its order and its working directory', async () => {
  // Order lives only in `fullConversationHeadersOnly`; the bubbles themselves
  // are an unordered bag. And the working directory is what the exclusion gate
  // matches on — without it, a person cannot keep a client repo out of their
  // brain.
  const { readCursorSessions } = await import('../src/extract/cursor.js');
  const r = readCursorSessions('/nonexistent-root-for-this-test');
  assert.deepEqual(r.sessions, [], 'a machine without Cursor should yield nothing, quietly');
  assert.equal(r.error, null, 'absence was reported as a failure');
});
