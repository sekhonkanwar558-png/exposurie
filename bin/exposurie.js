#!/usr/bin/env node
// Entry point. Thin on purpose: parse, dispatch, render, exit.
//
// There is exactly one writer to stdout (render) and one place the exit code is
// chosen, so the output contract cannot be bypassed by a command author. The
// command table lives in src/commands/registry.js, which is also what the help
// text and the tests read — a command exists in one place or not at all.

import { parseArgs } from 'node:util';
import { render } from '../src/output.js';
import { ERROR, USAGE, footer } from '../src/exit-codes.js';
import { COMMANDS, NAMES, versionResult } from '../src/commands/registry.js';
import { cmd } from '../src/install.js';

// The parsed flags, hoisted so the one writer below can consult them rather
// than re-reading argv. Null until parsing succeeds, and null forever if it
// throws — which is exactly the case the fallback down there covers.
let parsedValues = null;

function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        at: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean' },
        version: { type: 'boolean' },
        done: { type: 'boolean' },
        abort: { type: 'boolean' },
        section: { type: 'string' },
        nth: { type: 'string' },
        search: { type: 'string' },
        outline: { type: 'boolean' },
        full: { type: 'boolean' },
        because: { type: 'string' },
      },
    });
  } catch (e) {
    return { code: USAGE, error: { message: e.message, fix: `RUN: ${cmd('help')}` } };
  }

  parsedValues = parsed.values;

  // Named `asked` rather than `cmd`, because `cmd` is now the imported helper
  // that spells a command the way it works on this machine — and a local const
  // of the same name shadowed it here, turning every usage error into a crash.
  const asked = parsed.positionals[0] ?? 'init';
  const entry = COMMANDS[asked];
  if (!entry) {
    return {
      code: USAGE,
      error: {
        message: `No command named "${asked}". This version has: ${NAMES.join(', ')}.`,
        fix: `RUN: ${cmd('help')}`,
      },
    };
  }
  // `--help` is a question, and a question must never be able to perform an
  // action. The flag used to be consulted only when nothing was named —
  // `positionals[0] ?? (values.help ? 'help' : 'init')` — so a command name won
  // and the flag was parsed and then dropped. `exposurie sync --help` ran a real
  // sync; on the first install on somebody else's machine it staged a batch the
  // agent then had to go and clean up. Asking what a command does cost the user
  // the command. Answering the question BEFORE dispatch makes that impossible
  // for every command in the table, including ones this version does not have
  // yet — a new command cannot reintroduce it by forgetting to check a flag.
  //
  // It sits AFTER the unknown-name check on purpose. A name that is not a
  // command is a usage error whatever else is on the line, and exit 0 with a
  // help page would tell an agent its typo worked.
  if (parsed.values.help) return COMMANDS.help.run(parsed.values, parsed.positionals);

  // `--version` is the same kind of thing as `--help` — a question — so it is
  // answered in the same place, under the same two rules, and for the same
  // reason: a question that can reach a command can perform an action.
  //
  // It was not a flag at all until 1.1.0. `parseArgs` rejected it, which is
  // safe — exit 2, nothing ran, the fix printed — but it is a wrong answer to a
  // reasonable question, and the person asking it is usually somebody checking
  // whether they have the release that fixed the thing that bit them. That is
  // the audience this product now actually has.
  //
  // Below `--help` on purpose. If somebody asks both, they are lost rather than
  // curious, and the help text is the better answer to being lost.
  if (parsed.values.version) return versionResult(parsed.values.at);

  return entry.run(parsed.values, parsed.positionals.slice(1));
}

let result;
try {
  result = main(process.argv.slice(2));
} catch (e) {
  result = {
    code: ERROR,
    error: { message: e.stack || e.message, fix: 'This is a bug in exposurie. Nothing was written.' },
  };
}

// Asked as a parsed flag, not by scanning argv for the string. The scan also
// matched a `--json` that was somebody's DATA — `read --search "--json"` hands
// that word to `--search`, and the search then answered in a format nobody
// asked for. Falls back to the scan only when parsing itself failed, which is
// the one case where there are no parsed values to consult.
const wantsJson = parsedValues ? Boolean(parsedValues.json) : process.argv.includes('--json');

if (wantsJson) {
  // ALWAYS JSON once it has been asked for. This used to be
  // `wantsJson && result.json`, so a command with no structured payload — the
  // librarian among them — answered a machine caller with prose at exit 0.
  // That is the worst shape a failure can take here: valid-looking, silent,
  // and only discovered by whatever was parsing it. docs/output-contract.md
  // promises every command that returns data supports the flag, so the
  // guarantee is made structurally rather than command by command, and a
  // command added later cannot forget to keep it.
  const payload = result.json
    ? { ...result.json, exit: result.code }
    : {
        exit: result.code,
        ok: result.code === 0,
        error: result.error ? { message: result.error.message, fix: result.error.fix ?? null } : null,
        // The full human rendering, so nothing this command said is lost just
        // because it has no structured form yet.
        text: render(result) + footer(result.code),
      };
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
} else {
  process.stdout.write(render(result) + footer(result.code) + '\n');
}

// `process.exitCode`, not `process.exit()`. On Windows a write to a TTY is
// asynchronous, and `process.exit()` does not wait for it — so exiting on the
// line after the write can truncate the output on the one platform this was
// built on. Setting the code lets Node drain stdout and exit on its own. Every
// command here is synchronous and holds nothing open, so there is nothing to
// keep the loop alive once the write lands.
process.exitCode = result.code;
