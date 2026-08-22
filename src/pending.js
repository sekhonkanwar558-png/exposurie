// Human steps: the few things an agent genuinely cannot do for its user.
//
// The design constraint that shapes this whole file: the first run reads
// silently and auto mode blows past the terminal, so a step that is merely
// PRINTED is a step that gets buried and never returns. Four requirements come
// out of that, and each maps to something here:
//
//   1. exact words, not the topic   -> `verbatim`, relayed without paraphrase
//   2. write it to disk as well     -> record()
//   3. repeat until done            -> unresolved(), called by every command
//   4. never block                  -> nothing here is awaited, ever
//
// "Done" is DETECTED, never marked. Nobody has to remember to tick a box, and
// a step cannot be falsely closed by an agent that assumed it worked.

import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The catalog. Every human step in the product is declared here and nowhere
 * else, so the exact wording is reviewable in one place.
 *
 * resolved(ctx) -> boolean   : detected from disk, never from a claim
 */
export const STEPS = {
  'claude-web-export': {
    id: 'claude-web-export',
    title: 'claude.ai chat export',
    why:
      'Your claude.ai web conversations live on Anthropic servers, not on this ' +
      'disk. There is no API for your own chat history, so only you can request ' +
      'them — it needs your logged-in browser and your inbox.',
    ask:
      'Your brain is being built from the sessions on this machine right now. ' +
      'Your claude.ai web chats are not on here — want to grab those too? It ' +
      'takes about a minute of clicking, then a wait.',
    verbatim: [
      '1. Open claude.ai in your browser and sign in.',
      '2. Click your initials at the bottom-left, then Settings.',
      '3. Open the Privacy tab.',
      '4. Click "Export data".',
      '5. Anthropic emails you a download link. This can take a few HOURS.',
      '   Nothing appears on screen. It has not failed — close the tab.',
      '6. When the email arrives, download the .zip into your Downloads folder',
      '   and leave it there. Do not unzip it.',
    ],
    doneWhen: 'a data-*.zip appears in the Downloads folder',
    resolved: (ctx) => (ctx.exports?.length ?? 0) > 0,
  },

  obsidian: {
    id: 'obsidian',
    title: 'Obsidian (to read the brain by hand)',
    why:
      'Nothing in the system needs Obsidian — the brain is plain Markdown and ' +
      'your agent reads the files directly. It is here so the user can browse ' +
      'and see the graph, which is the moment most people start trusting it.',
    ask:
      'Want to see your brain as an actual linked graph? Obsidian is free and ' +
      'opens the folder as-is — nothing gets converted or locked in.',
    verbatim: [
      'Try installing it for them first, then fall back to asking:',
      '  Windows:  winget install Obsidian.Obsidian',
      '  macOS:    brew install --cask obsidian',
      '  Linux:    flatpak install flathub md.obsidian.Obsidian',
      'If none of those work, send them to https://obsidian.md and walk them',
      'through it in conversation. Do NOT tell them to run a terminal command.',
    ],
    doneWhen: 'the user says it is installed, or an Obsidian vault config appears',
    resolved: (ctx) => ctx.obsidianInstalled === true,
  },
};

/** Steps still outstanding, given detected state. Order is catalog order. */
export function unresolved(ctx = {}, ids = Object.keys(STEPS)) {
  return ids.map((id) => STEPS[id]).filter((s) => s && !s.resolved(ctx));
}

const dir = (vault) => join(vault, '.exposurie', 'pending');

/**
 * Mirror a step to disk. The terminal scrolls away; a file is still there
 * tomorrow, and the user can find it without us.
 */
export function record(vault, step) {
  if (!vault) return null;
  const d = dir(vault);
  mkdirSync(d, { recursive: true });
  const path = join(d, `${step.id}.md`);
  const body = [
    `# ${step.title}`,
    '',
    `_Waiting on you. Nothing is broken, and nothing is blocked by this._`,
    '',
    '## Why this one needs you',
    '',
    step.why,
    '',
    '## What to do',
    '',
    ...step.verbatim,
    '',
    `**Done when:** ${step.doneWhen}`,
    '',
    `_exposurie checks for this on its own. Delete nothing — this file`,
    `disappears by itself once the step is detected as complete._`,
    '',
  ].join('\n');
  writeFileSync(path, body, 'utf8');
  return path;
}

/** Remove the disk record once detection says the step is done. */
export function reap(vault, ctx = {}) {
  if (!vault || !existsSync(dir(vault))) return [];
  const open = new Set(unresolved(ctx).map((s) => s.id));
  const gone = [];
  for (const f of readdirSync(dir(vault))) {
    const id = f.replace(/\.md$/, '');
    if (STEPS[id] && !open.has(id)) {
      try {
        // Best-effort: a stale reminder is a nuisance, a crash is a bug.
        unlinkSync(join(dir(vault), f));
        gone.push(id);
      } catch {}
    }
  }
  return gone;
}
