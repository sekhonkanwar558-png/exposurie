#!/usr/bin/env node
// Entry point. Thin on purpose: parse, dispatch, render, exit.
//
// There is exactly one writer to stdout (render) and one place the exit code is
// chosen, so the output contract cannot be bypassed by a command author.

import { parseArgs } from 'node:util';
import { render } from '../src/output.js';
import { OK, ERROR, USAGE, footer } from '../src/exit-codes.js';
import { init } from '../src/commands/init.js';

const HELP = [
  'exposurie — an external brain your coding agent builds, curates and reads.',
  '',
  'COMMANDS',
  '  init            report what is on this machine and what to do about it',
  '  help            this',
  '',
  'FLAGS',
  '  --at <path>     where the brain should live (default ~/brain)',
  '  --json          machine-readable output instead of the task list',
  '',
  'NOTHING HERE EVER PROMPTS. Every command runs to completion and exits.',
  'Exit 10 means a step needs a person — it does NOT mean anything failed.',
];

function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { at: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean' } },
    });
  } catch (e) {
    return { code: USAGE, error: { message: e.message, fix: 'RUN: exposurie help' } };
  }

  const cmd = parsed.positionals[0] ?? (parsed.values.help ? 'help' : 'init');

  switch (cmd) {
    case 'init':
      return init({ at: parsed.values.at });
    case 'help':
      return { code: OK, body: HELP };
    default:
      return {
        code: USAGE,
        error: { message: `No command named "${cmd}".`, fix: 'RUN: exposurie help' },
      };
  }
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
