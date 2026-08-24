// `exposurie init` — the one line a user types into a session they already have.
//
// It does NOT scaffold. It reports what is on the machine and hands back an
// ordered task list, because the chain is tool -> agent -> human: the agent is
// what acts, and the agent is what talks to the person. Nothing here waits for
// input, and the human step is never a gate.

import { detect, tilde } from '../context.js';
import { unresolved, record } from '../pending.js';
import { block, planBlock, wrap } from '../output.js';
import { OK, HUMAN } from '../exit-codes.js';
import { DEFAULT_VAULT, expandPath, vaultState } from '../vault.js';

export function init({ at } = {}) {
  const d = detect();
  const vault = d.vault || expandPath(at) || DEFAULT_VAULT;

  const rows = [];
  rows.push([
    'brain',
    d.configError
      ? `UNKNOWN — pointer unreadable (${d.configError.reason})`
      : d.vault
        ? tilde(d.vault)
        : `not created  (will go at ${tilde(vault)})`,
  ]);

  for (const c of d.clients) {
    if (!c.present) continue;
    const where = tilde(c.root);
    rows.push([
      c.name.toLowerCase().replace(/\s+/g, '-'),
      c.readable
        ? `${c.count} session${c.count === 1 ? '' : 's'}   (${where})`
        : `${c.count} found, NO READER YET — will be skipped   (${where})`,
    ]);
  }

  rows.push([
    'web chats',
    d.exports.length
      ? `${d.exports.length} export${d.exports.length === 1 ? '' : 's'} found   (${tilde(d.exports[0].path)})`
      : 'not found',
  ]);

  // Detection decides what is still owed, so a step cannot be falsely closed.
  const ctx = { exports: d.exports, obsidianInstalled: false };
  const open = unresolved(ctx, ['claude-web-export']);

  const steps = [];
  // Never offer scaffold while the pointer is broken: it is the one command
  // that would act on the wrong answer and orphan an existing brain.
  if (d.configError) {
    steps.push({
      read: d.configError.path,
      note:
        `This file names the brain and is not valid JSON, so exposurie cannot ` +
        `tell whether a brain exists. Repair it — it holds {"vault": "<path>"} — ` +
        `and nothing else here is affected.`,
    });
  }
  if (!d.vault && !d.configError) {
    steps.push({
      run: `exposurie scaffold --at ${tilde(vault)}`,
      note:
        `Creates the brain and copies in the schema, the page templates and the ` +
        `prompt that writes pages — those become the user's, and are never ` +
        `overwritten. Writes nothing else and reads no transcripts.`,
    });
  }
  if (d.vault && d.sessions > 0) {
    steps.push({
      run: 'exposurie sync',
      note:
        `Stages a batch of conversation out of those sessions, newest first, and ` +
        `hands it back for you to fold into pages. It is resumable, so this can be ` +
        `run as many times as it takes.`,
    });
  }
  for (const p of open) {
    steps.push({ ask: p.ask });
  }

  // Mirror to disk only once there is a vault to mirror into; until then the
  // step rides the output, which is the only surface that exists.
  if (d.vault) for (const p of open) record(d.vault, p);

  // Saying where the build actually stops, rather than naming a command that
  // does not exist yet. An agent handed a plan whose steps fail learns that the
  // plan is not worth following — and that lesson is not undone by shipping the
  // command later.
  //
  // It rots the other way too, which is what happened: this block went on
  // denying `read` and the client pointer for a whole release after both
  // shipped, while `scaffold` printed the REACH table three lines below it.
  // Denying a capability we have is the same lie as promising one we lack, so
  // a test now pins this text against the command table.
  const frontier = [
    '',
    'NOT IN THIS VERSION',
    ...wrap(
      'Curating the brain as it grows is not built yet — merging pages that say the ' +
        'same thing, catching two pages that disagree, and retiring what a newer ' +
        'session superseded. Everything here fills the brain and reads it back; ' +
        'nothing yet prunes it. Do not invent a command for that.',
      74,
      '  ',
    ),
  ];

  return {
    code: open.length ? HUMAN : OK,
    state: vaultState(d.vault, 'init'),
    pending: open,
    body: [
      ...block('STATE', rows),
      ...(steps.length ? ['', ...planBlock(steps)] : []),
      ...frontier,
    ],
    json: {
      brain: d.vault,
      plannedVault: vault,
      sessions: d.sessions,
      clients: d.clients.map((c) => ({ id: c.id, present: c.present, count: c.count, readable: c.readable })),
      exports: d.exports.map((e) => e.path),
      pending: open.map((p) => p.id),
    },
  };
}
