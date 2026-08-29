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
import { installState, INSTALL, PACKAGE } from '../install.js';
import { version } from '../version.js';
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

/**
 * `--version`, answered like `--help` and rendered like every other command.
 *
 * It carries the state line, which is not decoration: `help` was the one thing
 * in this product that returned no state, and that stayed invisible until the
 * flag reaching it started working — at which point the page a confused agent
 * lands on was printing "no brain yet" to people who had one. A flag answered
 * beside it must not repeat that.
 *
 * WHAT IT SAYS BEYOND THE NUMBER, and why it is not padding. The question
 * behind "what version am I on" is almost always "do I have the fix", and the
 * single most useful neighbouring fact is whether this copy is INSTALLED or is
 * a temporary npx unpack — because that is what decides whether the pointer in
 * their agent names a command that exists. It is the one piece of information
 * that would have shortened the first outside install, printed at the moment
 * somebody is already asking about their copy of the tool.
 *
 * `--json` gives `{ "version": "1.1.0", "exit": 0 }` for anything scripting
 * against it, because the state line comes first in human output, always, and
 * that is a rule rather than an accident.
 */
export function versionResult(at) {
  const install = installState();
  return {
    code: OK,
    state: vaultState(resolveVault(at), 'version'),
    body: [
      'VERSION',
      `  ${version()}`,
      '',
      `  ${PACKAGE} — MIT, zero runtime dependencies.`,
      ...(install.permanent
        ? [`  Installed on this machine at ${install.binary}`]
        : [
            '  NOT installed here — this is running from a temporary npx cache,',
            '  so no exposurie command is on PATH. That matters more than it',
            '  sounds: the pointer written into your agent names a command, and',
            '  it names the slow fallback until a real install lands.',
            '',
            `      RUN: ${INSTALL}`,
          ]),
    ],
    json: { version: version(), package: PACKAGE, installed: install.permanent },
  };
}

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
    '  --version       which release this is, and whether it is really installed',
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
    // Resolved, never the bare name, and on a line of its own rather than in a
    // padded column: the npx form is 24 characters where `exposurie` is 9, so a
    // hand-aligned block would come apart on exactly the machine that needs the
    // longer one. This is the ONE command in the product typed by a person with
    // no agent to notice "command not found" for them.
    `  ${installState().invocation} uninstall`,
    '      Takes the tool back off this machine. Your brain stays where it is,',
    '      in plain Markdown, and nothing in it needs this tool to be read.',
    '      Type it yourself; it does not need an agent.',
    '',
    'NOTHING HERE EVER PROMPTS. Every command runs to completion and exits.',
    'Exit 10 means a step needs a person — it does NOT mean anything failed.',
  ];
}
