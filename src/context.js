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

/**
 * The pointer file, and an HONEST answer about it.
 *
 * This used to be one try/catch returning null, which made a corrupt config
 * indistinguishable from a machine that has no brain. Every command then said
 * "no brain yet -> RUN: exposurie init" — a dead end, since init cannot repair
 * JSON. Worse than useless, in fact: following that advice into `scaffold`
 * builds a SECOND brain at the default path while the real one sits elsewhere,
 * still named by the file nothing said was broken.
 *
 * A hand-edit or a bad merge is all it takes. So absent and unreadable are now
 * different answers, and every command that would act on the difference asks.
 */
export function configState() {
  const path = configPath();
  if (!existsSync(path)) return { status: 'absent', path, config: null };

  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { status: 'unreadable', path, config: null, reason: e.code || 'could not be opened' };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { status: 'unreadable', path, config: null, reason: String(e.message) };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'unreadable', path, config: null, reason: 'not a JSON object' };
  }
  return { status: 'ok', path, config: parsed };
}

export function readConfig() {
  const s = configState();
  return s.status === 'ok' ? s.config : null;
}

/**
 * One error, shared by every command that would otherwise act on a wrong
 * assumption. It names the file, says what is wrong with it, and states the
 * consequence — the reason to stop is not tidiness, it is that continuing
 * orphans a brain.
 */
export function brokenConfig(state) {
  return {
    message:
      `The pointer telling exposurie where the brain lives could not be read ` +
      `(${state.reason}). Nothing was changed, and nothing here is lost. Until ` +
      `it is valid, a corrupt pointer cannot be told apart from a machine with ` +
      `no brain at all — and creating a new one would orphan the brain you have.`,
    fix: `EDIT: ${state.path}   (JSON, holding {"vault": "<path to your brain>"})`,
  };
}

/** One call, everything a command needs to decide what to print. */
export function detect() {
  const clients = CLIENTS.map((c) => {
    const present = existsSync(c.root);
    const files = present ? c.find(c.root) : [];
    return { ...c, present, count: files.length, files };
  });

  const cfg = configState();
  const config = cfg.config;
  const vault = config?.vault && existsSync(config.vault) ? config.vault : null;

  return {
    home: HOME,
    clients,
    exports: findExports(),
    config,
    configStatus: cfg.status,
    configError: cfg.status === 'unreadable' ? cfg : null,
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
