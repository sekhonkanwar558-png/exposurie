// Nothing personal ships. Enforced, not promised.
//
// This product was built from scratch. One person's vault was the EVIDENCE —
// the failures it hit are why several rules here exist — but none of that
// person's data, paths, private tooling or vault contents belong in a public
// repository. A finding transfers; a citation of a private file does not.
//
// So findings must be restated as self-contained reasoning. "A muted check is
// worth nothing" is portable. "The same call <private-script> made" is both a
// leak and unreadable to anyone who does not have that script.
//
// This file scans EVERY file in the repo except itself. It covers the npm
// package and the GitHub repo alike, because the repo is the more exposed of
// the two: `files` in package.json keeps tests off npm, but git publishes
// everything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = basename(fileURLToPath(import.meta.url));
const SEP = String.fromCharCode(92);

const BANNED = [
  // real machine paths
  [/C:[\\/]+Users[\\/]+msi/i, 'a real user home path'],
  [/[\\/]Users[\\/]msi\b/i, 'a real user home path'],
  [/D:[\\/]+Exposurie/i, 'the author machine vault path'],
  // private tooling that exists on exactly one machine
  [
    /\b(brain|fact-check|curate|collect-new|capture|rocketsync-scan|backup|surface-banner)\.ps1\b/i,
    'a private script name',
  ],
  [/\brocketsync\b/i, 'a private workflow name'],
  [/\bopenclaw\b/i, 'a private agent name'],
  [/\bMYBRAIN\b/, 'a private repo name'],
  // personal identifiers (the author byline is allowed in package.json below)
  [/\bKanwar\b/i, 'a personal name'],
  [/sekhonkanwar/i, 'a personal account handle'],
  [/[\w.+-]+@(gmail|outlook|yahoo)\.com/i, 'a personal email address'],
];

// No exceptions. The byline is "exposurie by sekhon" — a brand handle, not a
// personal name — so nothing in this repo needs one.
const ALLOW = {};

function files(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) files(p, acc);
    else if (e.name !== SELF) acc.push(p);
  }
  return acc;
}

test('no personal data, private paths or private tooling in any shipped file', () => {
  const hits = [];
  for (const f of files(ROOT)) {
    const rel = relative(ROOT, f).split(SEP).join('/');
    const allowed = ALLOW[rel] || [];
    const text = readFileSync(f, 'utf8');
    for (const [re, what] of BANNED) {
      if (allowed.some((a) => a.source === re.source)) continue;
      const m = text.match(re);
      if (m) hits.push(rel + ': ' + what + ' -> "' + m[0] + '"');
    }
  }
  assert.deepEqual(hits, [], '\n  ' + hits.join('\n  ') + '\n');
});

test('the guard actually catches a leak', () => {
  // A guard that cannot fail is decoration. Prove the matcher works on both
  // shapes it has to cover: a private filename, and a real home path.
  assert.ok(BANNED.some(([re]) => re.test('see brain.ps1 for why')));
  assert.ok(BANNED.some(([re]) => re.test('C:' + SEP + 'Users' + SEP + 'msi')));
});
