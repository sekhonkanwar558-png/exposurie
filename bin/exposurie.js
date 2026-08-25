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
import { COMMANDS, NAMES } from '../src/commands/registry.js';

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
        done: { type: 'boolean' },
        section: { type: 'string' },
        nth: { type: 'string' },
        search: { type: 'string' },
        outline: { type: 'boolean' },
        full: { type: 'boolean' },
        because: { type: 'string' },
      },
    });
  } catch (e) {
    return { code: USAGE, error: { message: e.message, fix: 'RUN: exposurie help' } };
  }

  const cmd = parsed.positionals[0] ?? (parsed.values.help ? 'help' : 'init');
  const entry = COMMANDS[cmd];
  if (!entry) {
    return {
      code: USAGE,
      error: {
        message: `No command named "${cmd}". This version has: ${NAMES.join(', ')}.`,
        fix: 'RUN: exposurie help',
      },
    };
  }
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

const wantsJson = process.argv.includes('--json');
if (wantsJson && result.json) {
  process.stdout.write(JSON.stringify({ ...result.json, exit: result.code }, null, 2) + '\n');
} else {
  process.stdout.write(render(result) + footer(result.code) + '\n');
}
process.exit(result.code);
