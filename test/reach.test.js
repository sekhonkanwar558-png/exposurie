// Tests for the pointer — the few hundred bytes that decide whether a
// stranger's agent ever learns the brain exists.
//
// These drive the module directly against a throwaway home rather than through
// the CLI, because what needs pinning is byte-level behaviour in files the USER
// owns: that we never clobber, never move their content, and can always take
// ourselves back out. That is the whole argument for writing markdown instead
// of registering an MCP server, so it is the thing worth proving.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { POINTER, START, END, contextFiles, inject, remove, reachAll, unreachAll } from '../src/reach.js';

const home = () => mkdtempSync(join(tmpdir(), 'exposurie-reach-'));
const claude = (h) => join(h, '.claude', 'CLAUDE.md');

test('every target is markdown — the invariant that makes an unconfirmed path safe', () => {
  for (const c of contextFiles('/anywhere')) {
    assert.match(c.file, /\.(md|mdc)$/, `${c.id} target is not markdown`);
  }
});

test('the four clients are the four clients', () => {
  const ids = [...new Set(contextFiles('/anywhere').map((c) => c.id))].sort();
  assert.deepEqual(ids, ['claude-code', 'codex', 'cursor', 'opencode']);
});

test('creates the file when the client exists but has no instructions yet', () => {
  const h = home();
  mkdirSync(join(h, '.claude'), { recursive: true });
  const [hit] = reachAll({ home: h }).filter((c) => c.id === 'claude-code');
  assert.equal(hit.action, 'created');
  assert.match(readFileSync(claude(h), 'utf8'), /exposurie read --search/);
});

test('never clobbers — what the user wrote survives verbatim', () => {
  const h = home();
  mkdirSync(join(h, '.claude'), { recursive: true });
  const mine = '# My config\n\nUse tabs. Never force push.\n';
  writeFileSync(claude(h), mine, 'utf8');

  reachAll({ home: h });
  const after = readFileSync(claude(h), 'utf8');
  assert.ok(after.startsWith('# My config'), 'user content must stay at the top');
  assert.ok(after.includes('Never force push.'), 'user content must survive');
  assert.ok(after.includes(POINTER), 'pointer must be present');
});

test('a second run changes nothing', () => {
  const h = home();
  mkdirSync(join(h, '.claude'), { recursive: true });
  reachAll({ home: h });
  const first = readFileSync(claude(h), 'utf8');

  const again = reachAll({ home: h }).find((c) => c.id === 'claude-code');
  assert.equal(again.action, 'unchanged');
  assert.equal(readFileSync(claude(h), 'utf8'), first, 'bytes must be identical');
});

test('an updated pointer is replaced where it sits, not moved to the end', () => {
  const h = home();
  mkdirSync(join(h, '.claude'), { recursive: true });
  writeFileSync(claude(h), `TOP\n\n${START}\nold text\n${END}\n\nBOTTOM\n`, 'utf8');

  inject(claude(h), 'new text');
  const after = readFileSync(claude(h), 'utf8');
  assert.ok(after.indexOf('TOP') < after.indexOf('new text'), 'must stay below TOP');
  assert.ok(after.indexOf('new text') < after.indexOf('BOTTOM'), 'must stay above BOTTOM');
  assert.ok(!after.includes('old text'));
});

test('a client that is not installed is skipped — no file, no directory', () => {
  const h = home();
  mkdirSync(join(h, '.claude'), { recursive: true }); // only this one
  const ids = reachAll({ home: h }).map((c) => c.id);
  assert.deepEqual(ids, ['claude-code']);
  assert.ok(!existsSync(join(h, '.codex')), 'must not create a root for an absent client');
  assert.ok(!existsSync(join(h, '.cursor')), 'must not create a root for an absent client');
});

test('removal leaves the user with exactly what they had', () => {
  const h = home();
  mkdirSync(join(h, '.claude'), { recursive: true });
  const mine = '# My config\n\nUse tabs. Never force push.\n';
  writeFileSync(claude(h), mine, 'utf8');

  reachAll({ home: h });
  unreachAll({ home: h });

  const after = readFileSync(claude(h), 'utf8');
  assert.ok(!after.includes(START) && !after.includes(END), 'no markers may survive');
  assert.ok(!after.includes('exposurie read'), 'no pointer may survive');
  assert.equal(after.trim(), mine.trim(), 'the user gets their file back');
});

test('a file that was only ever ours is deleted, not left empty', () => {
  const h = home();
  mkdirSync(join(h, '.cursor'), { recursive: true });
  const owned = contextFiles(h).find((c) => c.id === 'cursor').file;

  reachAll({ home: h });
  assert.ok(existsSync(owned), 'cursor rule file should have been written');

  unreachAll({ home: h });
  assert.ok(!existsSync(owned), 'an owned file must be removed outright');
});
