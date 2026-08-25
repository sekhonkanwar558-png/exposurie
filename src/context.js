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

import { readTranscript } from './extract/transcript.js';
import { readRollout } from './extract/codex.js';
import { openZip } from './extract/zip.js';
import { cursorRoot, readCursorSessions, countCursorSessions, cursorMtime } from './extract/cursor.js';
import { SIGNATURE as CHATGPT_SIGNATURE } from './extract/chatgpt.js';

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

/**
 * Every client, with the reader that backs its claim.
 *
 * `read` lives here on purpose. Codex was marked `readable: true` for a whole
 * release with no reader of its own: the Claude Code parser was pointed at a
 * completely different file format, returned zero turns from every rollout, and
 * the sync marked all three sessions read. Nothing errored, the session count
 * was correct, and the conversations simply were not there.
 *
 * With the reader in the table, `readable: true` and "there is a function that
 * reads it" are the same statement, and a test can check the two agree.
 */
export const CLIENTS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    root: join(HOME, '.claude'),
    readable: true,
    find: (root) => walk(join(root, 'projects'), isJsonl),
    read: readTranscript,
  },
  {
    id: 'codex',
    name: 'Codex',
    root: join(HOME, '.codex'),
    readable: true,
    // sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl
    find: (root) => walk(join(root, 'sessions'), (n) => n.startsWith('rollout-') && isJsonl(n)),
    read: readRollout,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    // NOT `~/.cursor`. That folder holds extensions and per-project scaffolding,
    // and its `agent-transcripts` directories are empty — the previous version
    // of this entry counted them and reported "2 found, NO READER YET", which
    // was an honest statement about a reader we lacked and a wrong one about
    // what was there. The conversations are in Cursor's app data, in SQLite.
    root: cursorRoot() || join(HOME, '.cursor'),
    readable: true,
    // Its unit is a row in a database, not a file on disk, so it yields
    // sessions directly rather than paths for someone else to open.
    find: () => [],
    sessions: readCursorSessions,
    count: countCursorSessions,
    mtime: cursorMtime,
  },
];

/**
 * Chat exports, left where the browser put them.
 *
 * Identified by what is INSIDE the zip, not by its name. Anthropic's download
 * is reliably `data-*.zip`; OpenAI's is not reliably anything, and a filename
 * rule would either miss every ChatGPT export or claim unrelated archives. The
 * two are told apart by their contents with no ambiguity:
 *
 *   claude.ai   conversations.json + users.json / projects/
 *   ChatGPT     conversations.json + chat.html
 *
 * This costs a central-directory read per zip and never inflates anything —
 * the index sits at the end of the file, so it is the same small read whether
 * the archive is 5 MB or 5 GB.
 */
/** Names Anthropic and OpenAI actually give their downloads. */
const LOOKS_LIKE_AN_EXPORT = [/^data-.*\.zip$/i, /chatgpt/i, /^conversations.*\.zip$/i];

function sniff(path, filename) {
  let zip;
  try {
    zip = openZip(path);
    const names = zip.names();
    if (!names.includes('conversations.json')) return null;
    if (names.includes(CHATGPT_SIGNATURE)) return 'chatgpt';
    if (
      names.includes('users.json') ||
      names.includes('memories.json') ||
      names.some((n) => n.startsWith('projects/') || n.startsWith('design_chats/'))
    ) {
      return 'claude';
    }
    // Anthropic's download is reliably named this way. It is a weaker signal
    // than a marker file, which is why it is last rather than first — but a
    // stripped-down export that carries only `conversations.json` is still
    // theirs, and refusing it would lose a whole history over a missing
    // `users.json`.
    if (/^data-.*\.zip$/i.test(filename)) return 'claude';
    // conversations.json and nothing that identifies it. Do not guess: handing
    // a file to the wrong reader is the failure this function is shaped around.
    return null;
  } catch (e) {
    // A zip that will not open is only OUR problem if it was plausibly an
    // export. Reporting every corrupt archive in someone's Downloads folder is
    // noise; saying nothing about a half-downloaded `data-*.zip` is the silent
    // failure this product keeps finding, moved down a layer — the file is
    // sitting right there and the tool says "nothing has changed".
    if (LOOKS_LIKE_AN_EXPORT.some((re) => re.test(filename))) {
      return { kind: 'broken', error: e.message || String(e) };
    }
    return null;
  } finally {
    if (zip) zip.close();
  }
}

export function findExports() {
  const dirs = [join(HOME, 'Downloads'), join(HOME, 'Desktop')];
  const out = [];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!/\.zip$/i.test(f)) continue;
      const p = join(d, f);
      let size;
      try {
        size = statSync(p).size;
      } catch {
        continue;
      }
      const kind = sniff(p, f);
      if (!kind) continue;
      if (typeof kind === 'object') out.push({ path: p, size, kind: 'broken', error: kind.error });
      else out.push({ path: p, size, kind });
    }
  }
  return out;
}

/**
 * Is Obsidian on this machine?
 *
 * Nothing in the product needs it — the brain is plain Markdown and the agent
 * reads the files. It is here because seeing the graph is the moment most
 * people start believing the thing is real, and that moment is the whole
 * retention problem.
 *
 * Detected, never marked. The step it gates was in the catalog for a release
 * with every caller hardcoding `false`, which meant it could never resolve: had
 * it ever been shown, it would have asked forever and taught the user that the
 * tool does not notice when they do what it asks. "Done is detected" is not a
 * style preference — without a detector, a step is a nag.
 *
 * The config folder is the signal rather than the binary: it appears when
 * Obsidian is first RUN, and an installed-but-never-opened copy has not
 * actually got the person to their graph.
 */
const OBSIDIAN_PATHS = [
  join(HOME, 'AppData', 'Roaming', 'obsidian'), // Windows
  join(HOME, 'Library', 'Application Support', 'obsidian'), // macOS
  join(HOME, '.config', 'obsidian'), // Linux
  join(HOME, '.var', 'app', 'md.obsidian.Obsidian'), // Linux, flatpak
];

export function obsidianInstalled() {
  return OBSIDIAN_PATHS.some((p) => existsSync(p));
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
  const exports = findExports();
  const clients = CLIENTS.map((c) => {
    const present = existsSync(c.root);
    const files = present ? c.find(c.root) : [];
    // A client whose conversations are not files counts them its own way.
    const count = present && c.count ? c.count(c.root) : files.length;
    return { ...c, present, count, files };
  });

  const cfg = configState();
  const config = cfg.config;
  const vault = config?.vault && existsSync(config.vault) ? config.vault : null;

  return {
    home: HOME,
    clients,
    exports: exports.filter((e) => e.kind === 'claude'),
    chatgptExports: exports.filter((e) => e.kind === 'chatgpt'),
    brokenExports: exports.filter((e) => e.kind === 'broken'),
    obsidianInstalled: obsidianInstalled(),
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
