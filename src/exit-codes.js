// Exit codes are part of the output contract: an agent reads them to decide
// what to do next, so each one means exactly one thing and never drifts.
//
// The rule that shapes this list: a code above 0 means "stop and handle me".
// Staleness therefore does NOT get a code. A stale brain still works, and a
// health signal that fails the run over a non-problem gets muted — after which
// it is worth nothing on the day something is actually wrong.

export const OK = 0;      // did the thing; nothing outstanding
export const ERROR = 1;   // actually broke; an ERROR block explains it
export const USAGE = 2;   // no such command / bad flags
export const HUMAN = 10;  // a step needs a person. NOT a failure.

export const FOOTERS = {
  [OK]: 'EXIT 0 — done.',
  [ERROR]: 'EXIT 1 — something failed. Read the ERROR block above. Do not retry blindly.',
  [USAGE]: 'EXIT 2 — no such command. RUN: exposurie help',
  [HUMAN]:
    'EXIT 10 — there is a step for your user. Nothing has failed. ' +
    'Do the RUN steps above, relay the FOR YOUR USER steps, and carry on.',
};

export function footer(code) {
  return FOOTERS[code] ?? `EXIT ${code}`;
}
