// Cursor.
//
// Cursor was in the client table for a release as `readable: false` — honest,
// and reported to the user as skipped — with a note saying its layout had been
// seen but its files never opened. Opening them found two things.
//
// FIRST: `~/.cursor/projects/<slug>/agent-transcripts/<uuid>/` is EMPTY. The
// count the tool printed ("2 found, NO READER YET") was two empty directories.
// It was skipping nothing and reporting it accurately, which is a strange place
// to end up: honest about a reader it lacked, wrong about what was there.
//
// SECOND: the conversations are in SQLite, in `state.vscdb`, in a key/value
// table. Two kinds of row matter, and nothing else does:
//
//   composerData:<composerId>   the conversation — its name, when it was
//                               created and last touched, and the ORDER of its
//                               messages in `fullConversationHeadersOnly`
//   bubbleId:<composerId>:<id>  one message — `type` 1 is the person, 2 is the
//                               agent, and `text` is what was said
//
// Everything else in a bubble is tool work: `toolResults`, `gitDiffs`,
// `attachedCodeChunks`, `codebaseContextChunks`, `suggestedCodeBlocks`,
// `recentlyViewedFiles`. Measured on a real database: 443 bubbles, 103 with any
// text at all, 31 of them from the person. The same ratio as everywhere else.
//
// WHICH PROJECT a conversation belongs to is not in the conversation. It is
// assembled from two other places: each workspace folder carries a
// `workspace.json` naming the folder it is for, and that workspace's own
// `state.vscdb` lists the composers belonging to it. That matters because the
// working directory is what the exclusion gate matches on — without it, a
// person could not keep a client's repository out of their brain.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

import { openDb, SqliteError } from './sqlite.js';

const HOME = homedir();

/**
 * Where Cursor keeps its user data, per platform.
 *
 * Hardcoded and read off a real machine, like every other path in this product.
 * `~/.cursor` is NOT this: that folder holds extensions and per-project
 * scaffolding, and its `agent-transcripts` directories are empty.
 */
export const CURSOR_ROOTS = [
  join(HOME, 'AppData', 'Roaming', 'Cursor', 'User'), // Windows
  join(HOME, 'Library', 'Application Support', 'Cursor', 'User'), // macOS
  join(HOME, '.config', 'Cursor', 'User'), // Linux
];

export function cursorRoot() {
  return CURSOR_ROOTS.find((p) => existsSync(join(p, 'globalStorage', 'state.vscdb'))) || null;
}

const json = (v) => {
  try {
    return JSON.parse(Buffer.isBuffer(v) ? v.toString('utf8') : String(v));
  } catch {
    return null;
  }
};

/** `file:///c%3A/Users/x/thing` -> `c:/Users/x/thing`. */
function fromFileUri(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('file:///')) return null;
  try {
    return decodeURIComponent(uri.slice('file:///'.length));
  } catch {
    return null;
  }
}

/**
 * composerId -> the folder the conversation happened in.
 *
 * Best effort by design: a conversation started in an empty window belongs to
 * no folder, and that is a real state rather than a failure. It comes back
 * without a working directory and is identified by its title instead, exactly
 * like a web chat.
 */
function projectMap(root) {
  const out = new Map();
  const base = join(root, 'workspaceStorage');
  if (!existsSync(base)) return out;

  let dirs;
  try {
    dirs = readdirSync(base);
  } catch {
    return out;
  }

  for (const d of dirs) {
    const folderFile = join(base, d, 'workspace.json');
    const dbFile = join(base, d, 'state.vscdb');
    if (!existsSync(folderFile) || !existsSync(dbFile)) continue;

    const meta = json(readFileSync(folderFile, 'utf8'));
    const folder = fromFileUri(meta?.folder);
    if (!folder) continue;

    let db;
    try {
      db = openDb(dbFile);
      for (const [key, value] of db.rows('ItemTable')) {
        if (key !== 'composer.composerData') continue;
        const data = json(value);
        for (const c of data?.allComposers || []) {
          if (c?.composerId) out.set(c.composerId, folder);
        }
      }
    } catch {
      // A locked or unreadable workspace database costs us the project name for
      // its conversations, and nothing else. Never the conversations themselves.
    } finally {
      if (db) db.close();
    }
  }
  return out;
}

const stamp = (ms) => (typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : null);

/**
 * Every Cursor conversation on this machine, in the shape a transcript reader
 * returns.
 *
 * Never throws. Cursor is usually running while this executes — the SQLite
 * reader handles that by reading the write-ahead log, but a database mid-write
 * is still a thing that can fail, and it must fail as a reported problem rather
 * than take a sync down.
 */
export function readCursorSessions(root = cursorRoot()) {
  if (!root) return { sessions: [], error: null };

  const dbFile = join(root, 'globalStorage', 'state.vscdb');
  // Not installed is not a failure. Only a database that EXISTS and will not
  // open is worth a person's attention; reporting the other case would put an
  // error in front of everyone who has never used Cursor.
  if (!existsSync(dbFile)) return { sessions: [], error: null };

  let db;
  try {
    db = openDb(dbFile);
  } catch (e) {
    return {
      sessions: [],
      error: e instanceof SqliteError ? e.message : String(e.message || e),
    };
  }

  try {
    const composers = new Map();
    const bubbles = new Map();

    for (const [key, value] of db.rows('cursorDiskKV')) {
      const k = String(key);
      if (k.startsWith('composerData:')) {
        const d = json(value);
        if (d) composers.set(k.slice('composerData:'.length), d);
      } else if (k.startsWith('bubbleId:')) {
        const d = json(value);
        if (d) bubbles.set(k.slice('bubbleId:'.length), d);
      }
    }

    const folders = projectMap(root);
    const sessions = [];

    for (const [id, c] of composers) {
      // The header list is the only record of message ORDER. Without it the
      // bubbles are an unordered bag, and a conversation read out of order is
      // worse than one not read at all.
      const headers = Array.isArray(c.fullConversationHeadersOnly)
        ? c.fullConversationHeadersOnly
        : [];

      const turns = [];
      for (const h of headers) {
        const bubble = bubbles.get(`${id}:${h?.bubbleId}`);
        const text = String(bubble?.text || '').trim();
        if (!text) continue;
        const type = bubble.type ?? h.type;
        if (type !== 1 && type !== 2) continue;
        turns.push({ role: type === 1 ? 'user' : 'assistant', text, at: stamp(c.createdAt) });
      }
      if (turns.length === 0) continue;

      const cwd = folders.get(id) || null;
      const chars = turns.reduce((n, t) => n + t.text.length, 0);
      const updated = stamp(c.lastUpdatedAt) || stamp(c.createdAt);

      sessions.push({
        path: `cursor:${id}`,
        id: `cursor:${id}`,
        cwd,
        project: c.name || (cwd ? basename(cwd) : 'untitled chat'),
        surface: 'cursor',
        startedAt: stamp(c.createdAt),
        endedAt: updated,
        // A row in a database has no byte offset, so freshness is the key —
        // the same contract a web chat resumes on.
        updatedAt: updated,
        turns,
        chars,
        rawBytes: 0,
        readTo: chars,
      });
    }

    return { sessions, error: null };
  } catch (e) {
    return {
      sessions: [],
      error: e instanceof SqliteError ? e.message : String(e.message || e),
    };
  } finally {
    db.close();
  }
}

/** How many conversations are there, without building them all. Used by `init`. */
export function countCursorSessions(root = cursorRoot()) {
  if (!root) return 0;
  let db;
  try {
    db = openDb(join(root, 'globalStorage', 'state.vscdb'));
    let n = 0;
    for (const [key, value] of db.rows('cursorDiskKV')) {
      if (!String(key).startsWith('composerData:')) continue;
      const d = json(value);
      if ((d?.fullConversationHeadersOnly || []).length > 0) n += 1;
    }
    return n;
  } catch {
    return 0;
  } finally {
    if (db) db.close();
  }
}

let cachedStat = null;

/** Newest change to Cursor's database, so a sync can tell if anything moved. */
export function cursorMtime(root = cursorRoot()) {
  if (!root) return 0;
  if (cachedStat && cachedStat.root === root) return cachedStat.mtime;
  let mtime = 0;
  for (const f of ['state.vscdb', 'state.vscdb-wal']) {
    try {
      mtime = Math.max(mtime, statSync(join(root, 'globalStorage', f)).mtimeMs);
    } catch {}
  }
  cachedStat = { root, mtime };
  return mtime;
}
