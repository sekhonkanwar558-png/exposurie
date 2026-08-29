// The command table — one place, so nothing can disagree with it.
//
// This exists because of a specific failure the product had: `init` printed
// `RUN: exposurie scaffold` months before `scaffold` existed, so an agent
// following the plan hit "no such command" and had nothing to do with that.
// A tool whose own output names a command it does not have has taught the
// agent reading it that the plan is not to be trusted.
//
// So the dispatcher, the help text and the test that greps every printed plan
// all read this same table. A command exists here or the output cannot name it.

import { init } from './init.js';
import { scaffold } from './scaffold.js';
import { sync } from './sync.js';
import { read } from './read.js';
import { decline } from './decline.js';
import { uninstall } from './uninstall.js';
import { OK } from '../exit-codes.js';
import { vaultState } from '../vault.js';
import { resolveVault } from '../context.js';
import { NAMES } from './names.js';

export const COMMANDS = {
  init: {
    summary: 'report what is on this machine and what to do about it',
    run: (v) => init({ at: v.at }),
  },
  scaffold: {
    summary: 'create the brain and copy in the files that become yours',
    run: (v) => scaffold({ at: v.at }),
  },
  sync: {
    summary: 'stage what is new so your agent can fold it into the brain',
    run: (v) => sync({ done: v.done, abort: v.abort, at: v.at }),
  },
  read: {
    summary: 'open a page, one section of it, or find which page holds a thing',
    run: (v, pos) => read(v, pos),
  },
  decline: {
    summary: 'record that your user said no to a pending step, so it stops asking',
    run: (v, pos) => decline(v, pos),
  },
  uninstall: {
    summary: 'remove everything exposurie put on this machine, keeping your brain',
    run: (v) => uninstall({ at: v.at }),
  },
  help: {
    summary: 'this',
    // Help carries the state line like every other command. It used to be the
    // one command that did not, which was invisible while `--help` was being
    // swallowed by whatever positional preceded it — and became a lie the
    // moment the flag started working: help printed `no brain yet` and pointed
    // at `init` on machines with a brain sitting right there. The state line is
    // how the sync nudge reaches an agent at all, so the command a confused
    // agent runs is the last one that should be missing it.
    run: (v) => ({ code: OK, state: vaultState(resolveVault(v.at), 'help'), body: helpText() }),
  },
};

// The table and the name list must agree. Asserting it at load turns a
// forgotten entry into an immediate, obvious failure instead of a wrong
// arrow printed at a user months later.
const keys = Object.keys(COMMANDS);
if (keys.join() !== NAMES.join()) {
  throw new Error(
    `registry has [${keys.join()}] but names.js lists [${NAMES.join()}] — they must match`,
  );
}

export { NAMES };

export function helpText() {
  const w = Math.max(...NAMES.map((n) => n.length));
  return [
    'exposurie — an external brain your coding agent builds, curates and reads.',
    '',
    'COMMANDS',
    ...NAMES.map((n) => `  ${n.padEnd(w)}  ${COMMANDS[n].summary}`),
    '',
    'FLAGS',
    '  --help          this, on any command. It never runs the command.',
    '  --at <path>     the brain to use; where a new one goes (default ~/brain)',
    '  --json          machine-readable output instead of the task list',
    '  --done          (sync) the pages are written; move the cutoff',
    '  --abort         (sync) throw the staged batch away; the cutoff stays put',
    '  --because "..." (decline) what your user actually said',
    '',
    'READING',
    '  exposurie read "<page>"                     the page, or a map if large',
    '  exposurie read "<page>" --section "<name>"  one section of it',
    '  exposurie read "<page>" --outline           the map, whatever the size',
    '  exposurie read "<page>" --full              the whole page regardless',
    '  exposurie read --search "<query>"           which page holds a thing',
    '',
    '  A large page returns a MAP, not the page — every line of it carries the',
    '  exact command that opens that section. You never have to build one.',
    '',
    'LEAVING',
    '  exposurie uninstall     takes the tool back off this machine. Your brain',
    '                          stays where it is, in plain Markdown, and nothing',
    '                          in it needs this tool to be read. Type it yourself;',
    '                          it does not need an agent.',
    '',
    'NOTHING HERE EVER PROMPTS. Every command runs to completion and exits.',
    'Exit 10 means a step needs a person — it does NOT mean anything failed.',
  ];
}
