// Exit codes are part of the output contract: an agent reads them to decide
// what to do next, so each one means exactly one thing and never drifts.
//
// The rule that shapes this list: a code above 0 means "stop and handle me".
// Staleness therefore does NOT get a code. A stale brain still works, and a
// health signal that fails the run over a non-problem gets muted — after which
// it is worth nothing on the day something is actually wrong.

import { cmd } from './install.js';

export const OK = 0;      // did the thing; nothing outstanding
export const ERROR = 1;   // actually broke; an ERROR block explains it
export const USAGE = 2;   // no such command / bad flags
export const HUMAN = 10;  // a step needs a person. NOT a failure.

export const FOOTERS = {
  [OK]: 'EXIT 0 — done.',
  [ERROR]: 'EXIT 1 — something failed. Read the ERROR block above. Do not retry blindly.',
  // "no such command" was the whole of this line for as long as a bad command
  // name was the only way to reach it. `--at` naming a path with no brain in it
  // reaches it too, and an agent that read this footer under an ERROR block
  // about a missing brain was being sent to the help text for a problem the
  // help text does not have. The code's own definition already said "bad
  // flags"; only what it printed was narrow.
  // USAGE is built in footer() instead of sitting here, because it is the one
  // footer that NAMES A COMMAND — and a command has to be spelled the way it
  // works on the machine reading it. A constant cannot do that: this module is
  // imported once and the answer depends on whether anything is on PATH.

  [HUMAN]:
    'EXIT 10 — there is a step for your user. Nothing has failed. ' +
    'Do the RUN steps above, relay the FOR YOUR USER steps, and carry on.',
};

export function footer(code) {
  if (code === USAGE) {
    return (
      'EXIT 2 — the call was wrong, not the machine. Nothing ran. Fix the ' +
      `command from the ERROR block above, or RUN: ${cmd('help')}`
    );
  }
  return FOOTERS[code] ?? `EXIT ${code}`;
}
