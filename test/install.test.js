// Tests for the install mode, and for the pointer that depends on it.
//
// THE BUG THESE PIN. The pointer written into every client's global
// instructions hardcoded `exposurie`, while the documented first line a person
// types is `npx @sekhon/exposurie init` — which leaves no such command on PATH.
// So every npx install wrote an instruction naming nothing, into the one file
// that loads on every message forever, and it failed SILENTLY: prose naming a
// missing command does not error, it simply never runs. Retrieval is the whole
// product and it was dead at rest on the default install path.
//
// It could not be found on the machine this was built on, where the binary is
// on PATH for unrelated reasons. It took a real install on somebody else's
// laptop. So these tests do the thing that machine did: run the real CLI with a
// PATH that has no exposurie in it, and read what landed in the user's files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { onPath, underNpx, installState, INSTALL, UNINSTALL, NPX_INVOCATION } from '../src/install.js';
import { pointer, POINTER, reachAll } from '../src/reach.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'exposurie.js');

function home() {
  const h = mkdtempSync(join(tmpdir(), 'exposurie-install-'));
  mkdirSync(join(h, 'Downloads'), { recursive: true });
  // A client, so there is something to write a pointer into.
  mkdirSync(join(h, '.codex'), { recursive: true });
  return h;
}

/** A directory holding a plausible `exposurie` binary, on every platform. */
function withBinary() {
  const d = mkdtempSync(join(tmpdir(), 'exposurie-bin-'));
  writeFileSync(join(d, 'exposurie'), '#!/bin/sh\n', 'utf8');
  writeFileSync(join(d, 'exposurie.cmd'), '@echo off\n', 'utf8');
  return d;
}

/** An empty directory, so PATH is well-formed but holds nothing of ours. */
const withoutBinary = () => mkdtempSync(join(tmpdir(), 'exposurie-nobin-'));

function run(h, args, path) {
  const opts = {
    encoding: 'utf8',
    env: { ...process.env, HOME: h, USERPROFILE: h, PATH: path, Path: path },
  };
  try {
    return { code: 0, out: execFileSync(process.execPath, [BIN, ...args], opts) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const agentsFile = (h) => join(h, '.codex', 'AGENTS.md');

// ---------------------------------------------------------------- detection
test('a binary on PATH is found; an empty PATH finds nothing', () => {
  const d = withBinary();
  assert.ok(onPath({ PATH: d }, 'linux'), 'should resolve the posix name');
  assert.ok(onPath({ PATH: d }, 'win32'), 'should resolve the .cmd shim');
  assert.equal(onPath({ PATH: withoutBinary() }, 'linux'), null);
  assert.equal(onPath({ PATH: '' }, 'linux'), null);
});

test('a DIRECTORY named exposurie is not a command', () => {
  // The cheap version of onPath used existsSync and reported this as installed,
  // which would write a bare-command pointer on a machine that cannot run it.
  const d = mkdtempSync(join(tmpdir(), 'exposurie-dir-'));
  mkdirSync(join(d, 'exposurie'));
  assert.equal(onPath({ PATH: d }, 'linux'), null);
});

test('PATH is searched in order, across several entries', () => {
  const empty = withoutBinary();
  const real = withBinary();
  assert.ok(onPath({ PATH: [empty, real].join(delimiter) }, 'linux'));
});

test('running out of the npx cache is recognised', () => {
  assert.equal(underNpx({}, '/home/u/.npm/_npx/a1b2/node_modules/@sekhon/exposurie/src/install.js'), true);
  assert.equal(underNpx({}, 'C:\\Users\\u\\AppData\\npm-cache\\_npx\\a1\\node_modules\\x.js'), true);
  assert.equal(underNpx({ npm_command: 'exec' }, '/usr/lib/node_modules/x.js'), true);
  assert.equal(underNpx({}, '/usr/lib/node_modules/@sekhon/exposurie/src/install.js'), false);
});

test('installState answers permanent and invocation together, from one place', () => {
  const yes = installState({ PATH: withBinary() }, 'linux', '/usr/lib/x.js');
  assert.equal(yes.permanent, true);
  assert.equal(yes.invocation, 'exposurie');

  const no = installState({ PATH: withoutBinary() }, 'linux', '/x/_npx/a/y.js');
  assert.equal(no.permanent, false);
  assert.equal(no.npx, true);
  assert.equal(no.invocation, NPX_INVOCATION);
});

// ------------------------------------------------------------------ pointer
test('the pointer names whatever invocation it is given', () => {
  assert.match(pointer('exposurie'), /^ {4}exposurie read --search/m);
  assert.match(pointer(NPX_INVOCATION), /^ {4}npx -y @sekhon\/exposurie read --search/m);
  assert.equal(pointer(), POINTER, 'the default is the permanent form');
});

test('reachAll defaults to an invocation that exists, not to the bare name', () => {
  // A caller that forgets to pass text must still write something runnable.
  // This is the whole class of bug: the component was correct and the default
  // was wrong, so every real caller inherited the wrong answer.
  const h = home();
  const path = withoutBinary();
  const saved = process.env.PATH;
  process.env.PATH = path;
  try {
    reachAll({ home: h });
  } finally {
    process.env.PATH = saved;
  }
  const written = readFileSync(agentsFile(h), 'utf8');
  assert.match(written, /npx -y @sekhon\/exposurie read --search/);
  assert.ok(!/\n {4}exposurie read --search/.test(written), 'must not name a command that is absent');
});

// ------------------------------------------------------- the end-to-end bug
test('REGRESSION: scaffolding with no exposurie on PATH never writes a dead command', () => {
  const h = home();
  run(h, ['scaffold'], withoutBinary());

  const written = readFileSync(agentsFile(h), 'utf8');
  assert.match(written, /npx -y @sekhon\/exposurie read --search/, 'the fallback must be named');
  assert.ok(
    !/\n {4}exposurie read --search/.test(written),
    'a bare `exposurie` here is the shipped bug: the command does not exist',
  );
});

test('scaffolding with the package installed writes the short, fast form', () => {
  const h = home();
  run(h, ['scaffold'], withBinary());
  assert.match(readFileSync(agentsFile(h), 'utf8'), /\n {4}exposurie read --search/);
});

test('scaffold says which command the pointer it just wrote actually names', () => {
  const h = home();
  const out = run(h, ['scaffold'], withoutBinary()).out;
  assert.match(out, /names\s+npx -y @sekhon\/exposurie read --search/);
  assert.match(out, new RegExp(INSTALL.replace(/[/@]/g, '\\$&')), 'it must name the one-line fix');
});

// --------------------------------------------------------------------- init
test('init makes the permanent install the FIRST step, before scaffold', () => {
  const out = run(home(), ['init'], withoutBinary()).out;
  assert.match(out, /NOT INSTALLED/, 'the state block must say so plainly');

  const install = out.indexOf(INSTALL);
  const scaffold = out.indexOf('exposurie scaffold');
  assert.ok(install > -1, 'the install line must be in the plan');
  assert.ok(scaffold > -1, 'scaffold must still be planned');
  assert.ok(install < scaffold, 'installing must come before the command that writes the pointer');
});

test('init does not nag about installing when it is already installed', () => {
  const out = run(home(), ['init'], withBinary()).out;
  assert.ok(!out.includes('NOT INSTALLED'));
  assert.ok(!out.includes(INSTALL), 'a step that does not apply is never printed');
});

// --------------------------------------------------------------- the repair
test('sync upgrades a pointer written under npx once the package is installed', () => {
  // scaffold is typed once, so without this the slow fallback is permanent —
  // including for the user who did exactly what we asked and installed it.
  const h = home();
  run(h, ['scaffold'], withoutBinary());
  assert.match(readFileSync(agentsFile(h), 'utf8'), /npx -y @sekhon\/exposurie read/);

  run(h, ['sync'], withBinary());
  const after = readFileSync(agentsFile(h), 'utf8');
  assert.match(after, /\n {4}exposurie read --search/, 'the pointer must shorten itself');
  assert.ok(!after.includes(NPX_INVOCATION), 'the stale fallback must be gone');
});

test('sync reaches a client that was installed after the brain was scaffolded', () => {
  const h = home();
  run(h, ['scaffold'], withBinary());
  mkdirSync(join(h, '.claude'), { recursive: true });

  run(h, ['sync'], withBinary());
  assert.match(readFileSync(join(h, '.claude', 'CLAUDE.md'), 'utf8'), /exposurie read --search/);
});

// ---------------------------------------------------------------- uninstall
test('uninstall states which of the two cases is actually true here', () => {
  const h = home();
  run(h, ['scaffold'], withBinary());

  const installed = run(h, ['uninstall'], withBinary()).out;
  assert.match(installed, new RegExp(UNINSTALL.replace(/[/@]/g, '\\$&')));

  const viaNpx = run(h, ['uninstall'], withoutBinary()).out;
  assert.match(viaNpx, /Nothing to remove/);
  assert.ok(!viaNpx.includes(UNINSTALL), 'never print a removal line for a package that is not there');
});

// ==========================================================================
// Leaving must name a command that EXISTS on the machine being left
// ==========================================================================
//
// Defect 3 of the first outside install was the pointer naming `exposurie` on
// a machine where the documented install was npx, which leaves no such command
// behind. That was fixed in reach.js and NOWHERE ELSE, so the same literal
// stayed in the output of `init`, `scaffold` and `help` -- including in the one
// sentence that promises the whole thing is reversible.
//
// It is worse here than it was in the pointer, for one reason. Everywhere else
// an agent reads the output, and an agent that has just run the tool knows the
// invocation that worked and can recover from "command not found". `uninstall`
// is documented as the user's own -- typed by a person, in a terminal, with no
// agent involved -- so a name that does not resolve has nobody to notice it,
// at the exact moment somebody has decided to stop trusting the tool.

test('nothing tells an npx user to type a command they do not have', () => {
  const h = mkdtempSync(join(tmpdir(), 'exposurie-leaving-'));
  mkdirSync(join(h, '.claude'), { recursive: true });

  // A machine where nothing installed exposurie. installState() scans PATH, so
  // removing the npm directory from it is the whole simulation.
  const bare = {
    ...process.env,
    HOME: h,
    USERPROFILE: h,
    PATH: dirname(process.execPath),
    Path: dirname(process.execPath),
  };
  const run = (args) => {
    try {
      return execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: bare });
    } catch (e) {
      return (e.stdout || '') + (e.stderr || '');
    }
  };

  for (const args of [['init'], ['scaffold'], ['help'], ['uninstall']]) {
    const out = run(args);
    assert.ok(
      !/(^|[^/\w-])exposurie uninstall/.test(out),
      `exposurie ${args[0]} tells a machine with no install to run "exposurie uninstall":\n${out}`,
    );
  }
});

test('...and the same output on an installed machine says the short form', () => {
  // Without this the test above passes on a build that never mentions leaving
  // at all, which would be a worse product and a green suite.
  const h = mkdtempSync(join(tmpdir(), 'exposurie-leaving-ok-'));
  mkdirSync(join(h, '.claude'), { recursive: true });
  const fake = join(h, 'bin');
  mkdirSync(fake, { recursive: true });
  writeFileSync(join(fake, process.platform === 'win32' ? 'exposurie.cmd' : 'exposurie'), '', 'utf8');

  const withIt = { ...process.env, HOME: h, USERPROFILE: h, PATH: fake, Path: fake };
  let out;
  try {
    out = execFileSync(process.execPath, [BIN, 'help'], { encoding: 'utf8', env: withIt });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
  }
  assert.match(out, /exposurie uninstall/, 'an installed machine should get the short command');
});
