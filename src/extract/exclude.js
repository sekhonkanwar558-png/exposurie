// Exclusion is a gate, not a broom.
//
// It runs BEFORE the read, always. If it ran afterwards the quota is already
// spent and the transcript under NDA has already been read — an apology, not a
// control. So nothing here is a cleanup pass over staged material; it decides
// what is opened at all.
//
// Two axes, and they are independent because one list cannot do both jobs:
//
//   conversations — work that is not part of this brain. Coursework, a client
//                   under NDA. Do not ingest those chats at all.
//   files         — code and artifacts that are not content, while the
//                   conversations ABOUT them stay. A repository living inside
//                   the brain folder is the case: the code is noise, and the
//                   design discussion about it is some of the best material
//                   there is.
//
// Collapse them into one list and one of the two comes out backwards.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const norm = (p) => String(p || '').split(String.fromCharCode(92)).join('/').toLowerCase();

/** Shell-style glob to regex. `*` spans anything, `?` is one character. */
export function globToRegExp(pattern) {
  const escaped = String(pattern)
    .split(String.fromCharCode(92))
    .join('/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

const matchesAny = (value, patterns) => {
  const v = norm(value);
  return (patterns || []).some((p) => {
    const g = norm(p);
    // A bare word is a contains-match; anything with a glob is anchored.
    return g.includes('*') || g.includes('?') ? globToRegExp(g).test(v) : v.includes(g);
  });
};

/**
 * Should this session be skipped entirely?
 *
 * Matched against the working directory the session ran in, which is the only
 * durable identity a conversation has — a transcript filename is a uuid, and a
 * project folder is what a person recognises.
 */
export function conversationExcluded(session, seam) {
  const pats = seam?.excludeConversations || [];
  if (pats.length === 0) return null;
  const hit = matchesAny(session.cwd || '', pats);
  return hit ? (session.cwd || 'unknown') : null;
}

/**
 * Should this path be read as content?
 *
 * The deterministic half needs no configuration and covers the common case on
 * its own: a directory carrying its own `.git` is somebody's project, not a
 * page of a brain.
 */
export function fileExcluded(path, seam, vault) {
  if (matchesAny(path, seam?.excludeFiles || [])) return 'exclude list';
  if (seam?.gitReposAreProjects !== false && isNestedRepo(path, vault)) return 'a project (has its own .git)';
  return null;
}

function isNestedRepo(path, vault) {
  if (!vault) return false;
  let dir = path;
  // Walk up to the brain root; a .git found before arriving is a nested repo.
  for (let i = 0; i < 40; i += 1) {
    const parent = dir.slice(0, dir.lastIndexOf('/') + 1 || dir.lastIndexOf(String.fromCharCode(92)) + 1);
    if (!parent || parent === dir) return false;
    dir = parent.replace(/[/\\]$/, '');
    if (norm(dir) === norm(vault)) return false;
    if (existsSync(join(dir, '.git'))) return true;
  }
  return false;
}
