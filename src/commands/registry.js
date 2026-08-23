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
import { OK } from '../exit-codes.js';
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
  help: {
    summary: 'this',
    run: () => ({ code: OK, body: helpText() }),
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
    '  --at <path>     where the brain should live (default ~/brain)',
    '  --json          machine-readable output instead of the task list',
    '',
    'NOTHING HERE EVER PROMPTS. Every command runs to completion and exits.',
    'Exit 10 means a step needs a person — it does NOT mean anything failed.',
  ];
}
