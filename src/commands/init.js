// `exposurie init` — the one line a user types into a session they already have.
//
// It does NOT scaffold. It reports what is on the machine and hands back an
// ordered task list, because the chain is tool -> agent -> human: the agent is
// what acts, and the agent is what talks to the person. Nothing here waits for
// input, and the human step is never a gate.

import { join } from 'node:path';
import { homedir } from 'node:os';
import { detect, tilde } from '../context.js';
import { unresolved, record } from '../pending.js';
import { block, planBlock } from '../output.js';
import { OK, HUMAN } from '../exit-codes.js';

const DEFAULT_VAULT = join(homedir(), 'brain');

export function init({ at } = {}) {
  const d = detect();
  const vault = d.vault || at || DEFAULT_VAULT;

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
        `Builds the brain from the ${d.sessions} readable session${d.sessions === 1 ? '' : 's'} above. ` +
        `Reads conversation only — never tool output — and is resumable if it stops.`,
    });
  }
  for (const p of open) {
    steps.push({ ask: p.ask });
  }
  steps.push({ run: 'exposurie mcp-install', note: 'Registers the brain with every client detected above.' });

  // Mirror to disk only once there is a vault to mirror into; until then the
  // step rides the output, which is the only surface that exists.
  if (d.vault) for (const p of open) record(d.vault, p);

  return {
    code: open.length ? HUMAN : OK,
    state: d.vault
      ? { vault: d.vault, pages: 0, lastSyncDays: null, self: 'init' }
      : { vault: null, self: 'init' },
    pending: open,
    body: [...block('STATE', rows), '', ...planBlock(steps)],
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
