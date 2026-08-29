
// ==========================================================================
// THE GUARD: no output ever names a command the machine does not have
// ==========================================================================
//
// This is defect 3 of the first outside install, and by 2026-08-29 it had
// appeared three times: the pointer (fixed 08-28, in reach.js and NOWHERE
// ELSE), then `uninstall`, then thirty-one other sites found by looking.
//
// Each time the fix was applied where the bug was REPORTED rather than where it
// lived, so each fix was correct and the class survived it. What was missing
// was never care -- it was a check that does not depend on anyone remembering.
//
// So this asserts a PROPERTY of the whole product rather than a list of sites:
// run every command on a PATH with no exposurie on it, and no line of any
// output may name a bare `exposurie <command>`. A site added next year is
// covered without anyone thinking of it, which is the only kind of guard worth
// having for a mistake that has now been made three times.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { NAMES } from '../src/commands/names.js';
import { localise } from '../src/commands/scaffold.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'exposurie.js');

/**
 * A bare `exposurie <cmd>`, not preceded by `/` or `@` -- so the PACKAGE name
 * (`npx -y @sekhon/exposurie sync`) never matches and the check stays honest.
 *
 * String.raw, and that is not a style choice. Written as an ordinary template
 * literal this reads `` `(^|[^\w/@-])exposurie (...)\b` ``, where `\w` is an
 * unknown escape that collapses to a literal `w` and `\b` becomes a BACKSPACE
 * character -- a regular expression that matches nothing, in a test that then
 * passes on every build forever. It did exactly that here, and was caught only
 * by breaking the fix on purpose and noticing the guard did not care.
 *
 * Which is this product's own signature bug wearing a test's clothes: a checker
 * that reports success while checking nothing is worth less than no checker,
 * because it also stops anyone else from looking.
 */
const BARE = new RegExp(String.raw`(^|[^\w/@-])exposurie (${NAMES.join('|')})\b`);

/** A home with a brain, a finished conversation, and an export -- so output is rich. */
function home(prefix) {
  const h = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(h, 'Downloads'), { recursive: true });
  const dir = join(h, '.claude', 'projects', 'w');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'a.jsonl');
  writeFileSync(
    p,
    JSON.stringify({
      type: 'user',
      cwd: 'C:/w',
      sessionId: 's1',
      timestamp: '2026-08-20T10:01:00Z',
      message: { role: 'user', content: [{ type: 'text', text: 'a real typed sentence about a decision' }] },
    }) + '\n',
    'utf8',
  );
  // Backdated so it models a conversation that ENDED. sync correctly defers
  // anything still being written, and a fixture written this millisecond is one
  // -- which would leave the guard checking only the "nothing new" path, the
  // thinnest output the product has, instead of the staged plan where a
  // hardcoded command would actually hide.
  const past = new Date(Date.now() - 3600 * 1000);
  utimesSync(p, past, past);
  return h;
}

/** That machine, with nothing named exposurie anywhere on PATH. */
function bare(h) {
  return { ...process.env, HOME: h, USERPROFILE: h, PATH: dirname(process.execPath), Path: dirname(process.execPath) };
}

function run(env, args) {
  try {
    return execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

const CALLS = [
  ['init'], ['scaffold'], ['sync'], ['help'], ['uninstall'], ['decline'],
  ['read'], ['read', '--search', 'decision'], ['read', 'Nothing At All'],
  ['sync', '--done'], ['sync', '--done', '--abort'],
  ['nonsense'], ['--version'], ['scaffold', '--at', '/no/such/place'],
];

test('no command, on a machine with no install, ever prints a bare exposurie', () => {
  const h = home('exposurie-guard-');
  const env = bare(h);
  run(env, ['scaffold']); // a brain, so the later calls produce real output

  for (const args of CALLS) {
    const out = run(env, args);
    const bad = out.split('\n').filter((l) => BARE.test(l));
    assert.deepEqual(
      bad,
      [],
      `exposurie ${args.join(' ')} named a command this machine does not have:\n  ${bad.join('\n  ')}`,
    );
  }
});

test('...and the calls that MUST name a command name the resolved one', () => {
  // Without this, a build that printed no commands at all would pass the test
  // above by saying nothing -- and printing the exact next command is rule 3 of
  // the output contract. Named calls rather than a count, because "10 of 14 is
  // enough" is not a property anyone can reason about later.
  const h = home('exposurie-guard-live-');
  const env = bare(h);
  run(env, ['scaffold']);

  const MUST = [
    [['init'], 'the first-run plan has to say what to run next'],
    [['help'], 'the help text lists reading and leaving as commands'],
    [['nonsense'], 'a usage error points at help'],
    [['sync'], 'a sync hands back the step that closes it'],
  ];

  for (const [args, why] of MUST) {
    assert.match(
      run(env, args),
      /npx -y @sekhon\/exposurie /,
      `exposurie ${args.join(' ')} named no command at all — ${why}`,
    );
  }
});

test('the files copied into the brain name a command that runs there too', () => {
  // sync.md is the file the agent is sent to on EVERY sync, and scaffold never
  // overwrites it -- so a wrong command in there is wrong for the life of the
  // brain. It is localised at copy time and this reads what actually landed.
  const h = home('exposurie-guard-tmpl-');
  run(bare(h), ['scaffold']);

  const brain = join(h, 'brain');
  const walk = (d, acc = []) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, acc);
      else if (/\.(md|txt)$/.test(e.name)) acc.push(p);
    }
    return acc;
  };

  for (const f of walk(brain)) {
    const text = readFileSync(f, 'utf8');
    const bad = text.split('\n').filter((l) => BARE.test(l));
    assert.deepEqual(bad, [], `${f} names a command this machine does not have:\n  ${bad.join('\n  ')}`);
  }
});

test('localise leaves an installed machine alone, and never doubles itself', () => {
  const src = 'RUN `exposurie sync` then `exposurie sync --done`. Install: npx -y @sekhon/exposurie init';
  assert.equal(localise(src, 'exposurie'), src, 'an installed machine must be untouched');

  const once = localise(src, 'npx -y @sekhon/exposurie');
  assert.ok(once.includes('`npx -y @sekhon/exposurie sync`'));
  assert.ok(once.includes('npx -y @sekhon/exposurie init'), 'the package name must survive');
  assert.equal(localise(once, 'npx -y @sekhon/exposurie'), once, 'a second pass must be a no-op');
});
