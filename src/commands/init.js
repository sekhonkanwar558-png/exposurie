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
  rows.push(['brain', d.vault ? tilde(d.vault) : `not created  (will go at ${tilde(vault)})`]);

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
  if (!d.vault) {
    steps.push({
      run: `exposurie scaffold --at ${tilde(vault)}`,
      note:
        `Creates the brain and copies in the schema, the page templates and the ` +
        `prompt that writes pages — those become the user's, and are never ` +
        `overwritten. Writes nothing else and reads no transcripts.`,
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
  const frontier = [
    '',
    'NOT IN THIS VERSION',
    ...wrap(
      `${d.sessions} readable session${d.sessions === 1 ? '' : 's'} are on this machine and ` +
        `none of them have been read. Reading them into pages is not built yet, so do ` +
        `not invent a command for it — scaffold is where this version stops.`,
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
