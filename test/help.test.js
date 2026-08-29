// Tests for `--help`, which used to be an instruction rather than a question.
//
// The dispatcher read `positionals[0] ?? (values.help ? 'help' : 'init')`, so a
// command name always won and the flag was parsed and then thrown away. Asking
// what a command does ran it. On the first install on somebody else's machine
// `exposurie sync --help` staged a real batch, and the agent driving the setup
// had to go and clean up work it had never meant to start.
//
// Nothing crashed and no number was wrong — the same shape as every other
// defect that install found. The tool did exactly what it was told; it was told
// the wrong thing by its own argument parsing.
//
// So the property under test is not "help prints help". It is that ASKING
// CANNOT ACT: after `--help`, the machine is byte-for-byte what it was. That is
// checked against the whole home directory rather than the brain, because the
// commands with the most to lose here write outside it — `scaffold` creates a
// second brain and registers it with every client, `uninstall` takes the
// pointer back out — and it is checked for every name in the command table, so
// a command added later cannot reintroduce this by forgetting a flag.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  utimesSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { NAMES } from '../src/commands/names.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'exposurie.js');

function run(h, args) {
  const opts = { encoding: 'utf8', env: { ...process.env, HOME: h, USERPROFILE: h } };
  try {
    return { code: 0, out: execFileSync(process.execPath, [BIN, ...args], opts) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

/**
 * A machine mid-life: a brain that exists, and one finished conversation that a
 * real sync would stage. Both halves matter — "nothing changed" is worth
 * nothing on a machine where nothing would have changed anyway.
 */
function home() {
  const h = mkdtempSync(join(tmpdir(), 'exposurie-help-'));
  mkdirSync(join(h, 'Downloads'), { recursive: true });
  const dir = join(h, '.claude', 'projects', 'w');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'a.jsonl');
  writeFileSync(
    p,
    [
      {
        type: 'user',
        cwd: 'C:/w',
        sessionId: 's1',
        timestamp: '2026-08-20T10:01:00Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'SENTINEL: use postgres, mysql lost us a week' }],
        },
      },
      {
        type: 'assistant',
        cwd: 'C:/w',
        sessionId: 's1',
        timestamp: '2026-08-20T10:02:00Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'agreed, postgres.' }] },
      },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n') + '\n',
    'utf8',
  );
  // Backdated so it models a conversation that ENDED. sync correctly defers
  // anything still being written, and a fixture written this millisecond is one.
  const past = new Date(Date.now() - 3600 * 1000);
  utimesSync(p, past, past);
  run(h, ['scaffold']);
  return h;
}

/** Every file under a tree, with its bytes. Content, not timestamps: reading is allowed. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    const entries = readdirSync(d, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[relative(dir, p).split('\\').join('/')] = readFileSync(p).toString('base64');
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

// ------------------------------------------------------------------ the point
test('asking what a command does never does it — for every command there is', () => {
  const h = home();
  const before = snapshot(h);

  for (const name of NAMES) {
    const r = run(h, [name, '--help']);
    assert.equal(r.code, 0, `exposurie ${name} --help exited ${r.code}`);
    assert.match(r.out, /^COMMANDS$/m, `exposurie ${name} --help did not print help`);
    assert.deepEqual(
      snapshot(h),
      before,
      `exposurie ${name} --help changed something on this machine. A question must not act.`,
    );
  }
});

test('...and the same command without the flag DOES act, so the check above means something', () => {
  const h = home();
  const before = snapshot(h);

  const asked = run(h, ['sync', '--help']);
  assert.equal(asked.code, 0);
  assert.deepEqual(snapshot(h), before, 'sync --help staged a batch');

  const did = run(h, ['sync']);
  assert.match(did.out, /^STAGED$/m, 'the fixture never stages, so nothing was proved above');
  assert.notDeepEqual(snapshot(h), before, 'a real sync changed nothing — the fixture is inert');
});

test('the answer does not depend on which command was asked about', () => {
  // Not a style preference: it is what makes the guarantee above checkable at
  // all. One answer, so `--help` has exactly one behaviour to reason about.
  const h = home();
  const plain = run(h, ['help']);
  for (const name of NAMES) {
    assert.equal(run(h, [name, '--help']).out, plain.out, `${name} --help differs from help`);
  }
  assert.equal(run(h, ['--help']).out, plain.out, 'bare --help differs from help');
});

// ------------------------------------------------------------ the second half
test('help carries the state line, like every other command', () => {
  // help was the one command that returned no state, which was invisible while
  // the flag it belongs to was being swallowed. The moment `--help` started
  // working, help became the page an agent lands on — printing "no brain yet"
  // and an arrow to `init` on a machine whose brain is sitting right there.
  const h = home();
  const out = run(h, ['help']).out;

  assert.doesNotMatch(out, /no brain yet/, 'help denies a brain that exists');
  assert.doesNotMatch(out, /RUN: exposurie init/, 'help sends a user to build a second brain');
  assert.match(out, /^exposurie {2}\d+ pages? · /m, 'help prints no state at all');
});

test('with no brain, help still says so and points at the one command that helps', () => {
  const h = mkdtempSync(join(tmpdir(), 'exposurie-help-bare-'));
  const out = run(h, ['help']).out;
  assert.match(out, /no brain yet/);
  assert.match(out, /RUN: exposurie init/);
});

// ----------------------------------------------------------------- the corner
test('a name that is not a command is still a usage error, flag or no flag', () => {
  // --help sits after the unknown-name check on purpose. Exit 0 and a help page
  // would tell an agent that its typo worked; exit 2 and the list of real names
  // is both the error and the answer to the question it was asking.
  const h = home();
  const r = run(h, ['snyc', '--help']);
  assert.equal(r.code, 2, 'an unknown command with --help exited as if it succeeded');
  assert.match(r.out, /No command named "snyc"/);
  assert.match(r.out, /sync/, 'the error does not name the command they meant');
});
