// What is actually on this machine.
//
// Client paths are HARDCODED, deliberately. "Let the agent work out where
// Cursor keeps its config" is exactly the latent-space guess this tool exists
// to refuse: the agent supplies the identity, the package supplies the action.
//
// Every path below was read off a real machine on 2026-08-22 rather than
// recalled. Where a layout was seen but its file format was not, the client is
// marked `readable: false` and REPORTED as such — a client we cannot parse yet
// is a known gap, not a silent omission.

import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const SEP = String.fromCharCode(92); // backslash, written this way to survive shell heredocs

/** Recursively collect files matching a predicate. Depth-capped; never throws. */
function walk(dir, match, depth = 6, acc = []) {
  if (depth < 0 || !existsSync(dir)) return acc;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc; // permissions, junctions, a folder that vanished mid-walk
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, match, depth - 1, acc);
    else if (match(e.name)) acc.push(p);
  }
  return acc;
}

const isJsonl = (n) => n.endsWith('.jsonl');

export const CLIENTS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    root: join(HOME, '.claude'),
    readable: true,
    find: (root) => walk(join(root, 'projects'), isJsonl),
  },
  {
    id: 'codex',
    name: 'Codex',
    root: join(HOME, '.codex'),
    readable: true,
    // sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl
    find: (root) => walk(join(root, 'sessions'), (n) => n.startsWith('rollout-') && isJsonl(n)),
  },
  {
    id: 'cursor',
    name: 'Cursor',
    root: join(HOME, '.cursor'),
    // Layout confirmed: projects/<slug>/agent-transcripts/<uuid>/ — but the
    // files inside were never observed, so no reader is claimed.
    readable: false,
    find: (root) => {
      const base = join(root, 'projects');
      if (!existsSync(base)) return [];
      const out = [];
      for (const slug of readdirSync(base)) {
        const t = join(base, slug, 'agent-transcripts');
        if (existsSync(t)) {
          for (const id of readdirSync(t)) out.push(join(t, id));
        }
      }
      return out;
    },
  },
];

/** claude.ai export zips, left where the browser put them. */
export function findExports() {
  const dirs = [join(HOME, 'Downloads'), join(HOME, 'Desktop')];
  const out = [];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    try {
      for (const f of readdirSync(d)) {
        if (/^data-.*\.zip$/i.test(f)) {
          const p = join(d, f);
          out.push({ path: p, size: statSync(p).size });
        }
      }
    } catch {}
  }
  return out;
}

export const configPath = () => join(HOME, '.exposurie', 'config.json');

export function readConfig() {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8'));
  } catch {
    return null;
  }
}

/** One call, everything a command needs to decide what to print. */
export function detect() {
  const clients = CLIENTS.map((c) => {
    const present = existsSync(c.root);
    const files = present ? c.find(c.root) : [];
    return { ...c, present, count: files.length, files };
  });

  const config = readConfig();
  const vault = config?.vault && existsSync(config.vault) ? config.vault : null;

  return {
    home: HOME,
    clients,
    exports: findExports(),
    config,
    vault,
    // Only what we can actually parse counts toward the number we promise on.
    sessions: clients.filter((c) => c.readable).reduce((n, c) => n + c.count, 0),
  };
}

/** Shorten a path for display without lying about where it is. */
export function tilde(p) {
  if (!p || !p.startsWith(HOME)) return p;
  return '~' + p.slice(HOME.length).split(SEP).join('/');
}
