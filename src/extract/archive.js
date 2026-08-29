// An export is not always a zip, and `conversations.json` is not always a file.
//
// ─── THE DEFECT THIS CLOSES ─────────────────────────────────────────────────
//
// A 1,164-conversation ChatGPT export sat in Downloads on the first machine
// this product was ever installed on by somebody who did not build it, and
// nothing saw it. Two reasons, and neither is about parsing:
//
//   1. OpenAI delivered it ALREADY UNPACKED, into a dated folder. `findExports`
//      only ever looked at `*.zip`, so there was nothing to open.
//   2. Inside it there was no `conversations.json`. The conversations were
//      split across `conversations-000.json` ... `conversations-011.json`, and
//      the sniffer required that literal name.
//
// The parser was correct the entire time — 1,157 of 1,164 readable, no error —
// and it only ever got a look because the export was repackaged BY HAND first.
// **A reader nothing reaches is worth exactly what a broken one is, and it is
// harder to notice, because everything it does report is right.** That is this
// codebase's signature failure and this is its fourth instance.
//
// ─── THE SHAPE OF THE FIX ───────────────────────────────────────────────────
//
// A directory is presented as an archive, behind the same handle `openZip`
// returns, so every reader above this file works on both without knowing which
// one it was given. Deliberately not a ChatGPT fix: Anthropic splits large
// accounts across numbered zips, and a person who unzips one by hand lands in
// exactly the same hole. Fixing it for one vendor would have left the other
// half of the same bug sitting there — which is what happened the first time,
// when `batch-000N` was handled and `conversations-000.json` was not.
//
// Nothing here parses a conversation. This layer only answers "what is in it"
// and "give me those bytes"; what the bytes mean stays with the vendor readers.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { openZip, ZipError } from './zip.js';

/**
 * How deep inside an unpacked export we look for its members.
 *
 * A zip index is flat and free to read; a directory is not, so this is a real
 * bound rather than a formality. Four levels covers `projects/<uuid>/...` with
 * room to spare, and stops a folder somebody dropped in Downloads from turning
 * a detection pass into a disk walk.
 */
const MAX_MEMBER_DEPTH = 4;

/**
 * `conversations.json`, or the numbered parts it arrives in.
 *
 * Matched on the BASENAME, so an export that unpacked into a wrapper folder is
 * still read. The old rule was the literal string at the root of a zip, which
 * is the narrowest possible reading of a name two vendors both vary.
 */
const CONVERSATIONS_PART = /^conversations(-\d+)?\.json$/i;

const base = (name) => name.slice(name.lastIndexOf('/') + 1);

export const isConversationsPart = (name) => CONVERSATIONS_PART.test(base(name));

/** The numeric suffix, with the unnumbered file sorting first. */
function partIndex(name) {
  const m = base(name).match(/-(\d+)\.json$/i);
  return m ? Number(m[1]) : -1;
}

/**
 * Every conversations file in an archive, in the order they must be read.
 *
 * Sorted numerically rather than lexically: `conversations-2.json` before
 * `conversations-10.json` is the difference between a history in order and one
 * that is subtly not, and OpenAI pads its numbers while nothing guarantees it
 * always will.
 */
export function conversationParts(archive) {
  return archive
    .names()
    .filter(isConversationsPart)
    .sort((a, b) => partIndex(a) - partIndex(b) || a.localeCompare(b));
}

/**
 * The conversations in an archive, across however many files they came in.
 *
 * Returns a result rather than throwing, and names the PART that failed. One
 * bad file out of twelve is a thing a person can act on; "the export is not
 * valid JSON" about a folder with twelve files in it is not.
 */
export function readConversations(archive) {
  const parts = conversationParts(archive);
  if (!parts.length) return { ok: false, reason: 'missing', parts };

  const all = [];
  for (const name of parts) {
    let json;
    try {
      json = JSON.parse(archive.read(name));
    } catch (e) {
      return { ok: false, reason: 'invalid', part: name, detail: e.message, parts };
    }
    if (!Array.isArray(json)) return { ok: false, reason: 'not-a-list', part: name, parts };
    all.push(...json);
  }
  return { ok: true, conversations: all, parts };
}

function walk(root, dir, prefix, out, depth) {
  if (depth < 0) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // permissions, a junction, a folder that vanished mid-walk
  }
  for (const e of entries) {
    const name = prefix ? `${prefix}/${e.name}` : e.name;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      // Directories are members too. The Claude reader looks for `projects/`,
      // and in a zip index that name exists whether or not it holds anything.
      out.set(name, null);
      walk(root, p, name, out, depth - 1);
    } else {
      out.set(name, p);
    }
  }
}

/**
 * An unpacked export, behind the handle a zip gives back.
 *
 * Member names use `/` on every platform, because that is what a zip index
 * contains and what every reader above this file already matches against.
 */
function openDirectory(path) {
  const members = new Map();
  walk(path, path, '', members, MAX_MEMBER_DEPTH);

  let size = 0;
  for (const p of members.values()) {
    if (!p) continue;
    try {
      size += statSync(p).size;
    } catch {}
  }

  return {
    path,
    size,
    names: () => [...members.keys()],
    has: (name) => members.get(name) != null,
    entry: (name) => (members.get(name) ? { name } : null),
    read(name) {
      const p = members.get(name);
      // ZipError on purpose: callers already catch it, and "this member is not
      // readable" means the same thing whichever container it came from.
      if (!p) throw new ZipError(`the export has no "${name}"`);
      try {
        return readFileSync(p, 'utf8');
      } catch (e) {
        throw new ZipError(`"${name}" could not be read (${e.message})`);
      }
    },
    close() {},
  };
}

export const isDirectory = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** One opener for both shapes. Throws `ZipError` the way `openZip` does. */
export function openArchive(path) {
  if (!existsSync(path)) throw new ZipError(`there is nothing at ${path}`);
  return isDirectory(path) ? openDirectory(path) : openZip(path);
}

export { ZipError };
