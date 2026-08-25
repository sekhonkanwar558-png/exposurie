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
    assert.equal(
      typeof c.read,
      'function',
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
    assert.equal(typeof c.read, 'undefined', `${c.id} claims not to be readable but has a reader`);
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
