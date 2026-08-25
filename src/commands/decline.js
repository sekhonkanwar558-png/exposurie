// `exposurie decline <id> --because "<what they said>"`
//
// The counterpart to detection. Every other way a pending step closes is
// something the tool can see: a file appeared, a setting changed, an app got
// installed. A person deciding against a step leaves nothing to see, so the
// catalog would ask again on every command for the rest of the install.
//
// This is agent-facing, not a command the user types — the same way `read` is.
// The user says no in conversation; their agent records it here. That keeps the
// one-command promise intact: what a person types recurringly is still `sync`.

import { OK, USAGE } from '../exit-codes.js';
import { STEPS, decline as record, declined } from '../pending.js';
import { detect } from '../context.js';
import { vaultState } from '../vault.js';

export function decline(values = {}, positionals = []) {
  const id = positionals[0];

  if (!id) {
    return {
      code: USAGE,
      error: {
        message: 'decline needs the id of the step your user said no to.',
        fix: `RUN: exposurie decline <id> --because "<what they said>"   ids: ${Object.keys(STEPS).join(', ')}`,
      },
    };
  }

  if (!STEPS[id]) {
    // Naming the real ids rather than saying "unknown". An agent that guessed
    // wrong has no way to discover the right answer from a refusal alone.
    return {
      code: USAGE,
      error: {
        message: `No pending step is called "${id}".`,
        fix: `The steps in this version are: ${Object.keys(STEPS).join(', ')}`,
      },
    };
  }

  const d = detect({ at: values.at });
  if (!d.vault) {
    return {
      code: USAGE,
      error: {
        message: 'There is no brain here to record that in.',
        fix: 'RUN: exposurie scaffold',
      },
    };
  }

  if (declined(d.vault).has(id)) {
    return {
      code: OK,
      state: vaultState(d.vault, 'decline'),
      body: [
        `ALREADY SET ASIDE — ${id}`,
        '',
        '  Nothing changed. exposurie had already stopped asking about this one.',
      ],
    };
  }

  const path = record(d.vault, id, values.because);
  const step = STEPS[id];

  // A decline is worth one honest line about what it costs. Not a warning and
  // not an argument — the decision is theirs and it has already been made — but
  // a step is being closed without the thing behind it being true, which is the
  // one case in this product where that happens.
  return {
    code: OK,
    state: vaultState(d.vault, 'decline'),
    body: [
      `SET ASIDE — ${step.title}`,
      '',
      `  exposurie will not ask about this again.`,
      `  ${path}`,
      '',
      `  TELL YOUR USER, in your own words: this stays their call, and`,
      `  deleting that file brings the step back. Nothing else changes.`,
      ...(values.because
        ? []
        : [
            '',
            '  NOTE: no reason was recorded. If they gave one, run this again',
            '  with --because "<their words>" so the file says why.',
          ]),
    ],
  };
}
