// Tests for taking the package off the machine, which `uninstall` now does.
//
// THIS FILE EXISTS BECAUSE THE SUITE ATE THE MACHINE IT RAN ON. When
// `uninstall` gained the npm removal on 2026-08-30, `test/uninstall.test.js`
// spawned the real binary with the real PATH inherited -- so the guard
// correctly identified the developer's own global install and removed it.
// `npm test` uninstalled exposurie, and the next 93 tests failed because
// `scaffold` refuses without one.
//
// Two things came out of that, and both are here:
//
//   1. Nothing that spawns the binary may inherit the real PATH. That is fixed
//      in the suites themselves, and the fake-binary sandbox makes the removal
//      decline by construction.
//   2. The removal logic therefore has to be tested SOMEWHERE, with every
//      dependency injected -- which is this file. A destructive path must be
//      exercised against fakes, never against the machine, and the price of
//      not having done that was learning it the expensive way.
//
// Nothing here spawns npm. Every call passes its own runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
  npmOwns,
  installedPackageDir,
  removePackage,
  packageLines,
} from '../src/package-removal.js';
import { UNINSTALL } from '../src/install.js';

// This file, and ONLY this file, turns the suite-wide kill switch back off.
//
// `test/test.env` sets EXPOSURIE_SKIP_PACKAGE_REMOVAL so that no suite spawning
// the real binary can uninstall the developer's linked copy. That switch sits
// above the logic under test here, so leaving it on would mean these tests
// assert the switch works and nothing else -- a suite that passes while
// checking nothing, which is this project's own signature bug.
//
// It is safe to lift here precisely because nothing below spawns anything:
// every removePackage() call passes its own fake runner, so npm is never
// invoked and no path on the real machine is touched. If a test in this file
// ever stops injecting a runner, that stops being true.
// `'0'` rather than `delete`: there are now two switches above the logic under
// test — the flag from test.env, and an automatic one that trips whenever
// NODE_TEST_CONTEXT is set, which is always true in here. `'0'` is the single
// explicit "no, really, run the real decision" that turns both off, and it
// cannot be satisfied by accident the way an absent variable can.
process.env.EXPOSURIE_SKIP_PACKAGE_REMOVAL = '0';

const WIN = process.platform === 'win32';
const BIN = WIN ? 'C:\\npm\\exposurie.cmd' : '/usr/local/bin/exposurie';
const PKG_BESIDE = WIN
  ? 'C:\\npm\\node_modules\\@sekhon\\exposurie'
  : '/usr/local/bin/node_modules/@sekhon/exposurie';
// Derived with join() rather than written out: <bin>/../lib on Windows leaves
// the prefix entirely (C:\npm -> C:\lib), and a hand-written fixture got that
// wrong -- which is a test testing its own fixture instead of the code.
const PKG_LIB = join(BIN, '..', '..', 'lib', 'node_modules', '@sekhon', 'exposurie');

/** An exists() that says yes to exactly the paths given. */
const knows = (...paths) => {
  const set = new Set(paths.map((p) => p.toLowerCase()));
  return (p) => set.has(String(p).toLowerCase());
};

const ok = () => ({ status: 0, stdout: '', stderr: '' });
const fails = (stderr) => () => ({ status: 1, stdout: '', stderr });

// ------------------------------------------------------------------ layout
test('a binary with npm layout beside it is one npm installed', () => {
  assert.equal(npmOwns(BIN, knows(PKG_BESIDE)), true, 'the Windows layout');
  assert.equal(npmOwns(BIN, knows(PKG_LIB)), true, 'the POSIX layout');
});

test('a bare binary with nothing beside it is not ours to remove', () => {
  // The sandbox case, and the reason a spawned test is safe: a fake shim in a
  // temp directory has no node_modules next to it.
  assert.equal(npmOwns(BIN, knows()), false);
  assert.equal(npmOwns(null, knows(PKG_BESIDE)), false, 'no binary at all');
});

test('installedPackageDir reports WHERE, not just whether', () => {
  // removePackage needs the path to answer "is this the copy I am running",
  // so a boolean would have to be recomputed into one.
  assert.ok(installedPackageDir(BIN, knows(PKG_BESIDE)));
  assert.equal(installedPackageDir(BIN, knows()), null);
});

// ----------------------------------------------------------------- removal
test('nothing installed means nothing is spawned', () => {
  let spawned = false;
  const r = removePackage(null, () => { spawned = true; return ok(); });
  assert.equal(r.action, 'absent');
  assert.equal(spawned, false, 'npm must never be run when there is nothing to remove');
});

test('a copy npm did not place is left alone, and npm is never called', () => {
  let spawned = false;
  const r = removePackage(BIN, () => { spawned = true; return ok(); }, () => null);
  assert.equal(r.action, 'foreign');
  assert.equal(spawned, false);
});

test('a copy that is not the one running is left alone', () => {
  // ONLY UNINSTALL THE COPY YOU ARE RUNNING. A checkout is not its installed
  // copy, so running from source never yanks the global one.
  let spawned = false;
  const r = removePackage(
    BIN,
    () => { spawned = true; return ok(); },
    () => PKG_BESIDE,
    () => false,
  );
  assert.equal(r.action, 'foreign');
  assert.match(r.reason, /different copy/);
  assert.equal(spawned, false, 'this is the guard that stops the suite deleting the real install');
});

test('the copy we are running, that npm placed, is removed', () => {
  const calls = [];
  const r = removePackage(
    BIN,
    (args) => { calls.push(args); return ok(); },
    () => PKG_BESIDE,
    () => true,
  );
  assert.equal(r.action, 'removed');
  assert.deepEqual(calls, [['uninstall', '-g', '@sekhon/exposurie']], 'exactly one npm call, and it is the right one');
});

test('npm refusing is reported, never swallowed', () => {
  const r = removePackage(BIN, fails('EACCES: permission denied'), () => PKG_BESIDE, () => true);
  assert.equal(r.action, 'failed');
  assert.match(r.detail, /EACCES/);
});

// ------------------------------------------------------------------ output
const wrap = (t) => [t];
const tilde = (p) => p;

test('every outcome that is not a clean removal prints the manual line', () => {
  // The one thing a person must never be left with is a machine in a state we
  // described wrongly. Saying it is gone when it is not is worse than one more
  // line to type.
  for (const result of [
    { action: 'foreign', reason: 'x' },
    { action: 'failed', detail: 'y' },
  ]) {
    const lines = packageLines(result, BIN, wrap, tilde).join('\n');
    assert.ok(lines.includes(UNINSTALL), `${result.action} must still name ${UNINSTALL}`);
  }
});

test('a clean removal does NOT print a command, because there is nothing left to run', () => {
  const lines = packageLines({ action: 'removed' }, BIN, wrap, tilde).join('\n');
  assert.equal(lines.includes(UNINSTALL), false, 'that would be the two-command uninstall coming back');
  assert.match(lines, /Removed/);
});

test('nothing installed says so without offering a removal line', () => {
  const lines = packageLines({ action: 'absent' }, null, wrap, tilde).join('\n');
  assert.equal(lines.includes(UNINSTALL), false);
});
