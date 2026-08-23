// The brain on disk, and the seam between what we own and what the user owns.
//
// The ownership split that shapes this file: machinery stays in the package and
// we update it; the prose describing a person's life is copied into the brain
// and is theirs forever. That split has one failure mode, and it is silent —
// the code hardcodes `wiki/entities` and the like, so a user whose agent decides
// `wiki/people` reads better renames a folder and search quietly stops seeing
// half the brain, with nothing reporting it.
//
// The fix is this file: ONE config both sides read. The user renames, the code
// follows. Anything the code genuinely cannot adapt to gets a blunt line in the
// config itself, where the person editing it is already looking.

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

export const DEFAULT_VAULT = join(homedir(), 'brain');

/** `~/brain` from a flag is a string, not a path. Expand it before use. */
export function expandPath(p) {
  if (!p) return null;
  const s = String(p).trim();
  if (s === '~') return homedir();
  if (s.startsWith('~/') || s.startsWith('~' + String.fromCharCode(92))) {
    return join(homedir(), s.slice(2));
  }
  return resolve(s);
}

export const seamPath = (vault) => join(vault, '.exposurie', 'config.json');
export const statePath = (vault) => join(vault, '.exposurie', 'state.json');

/**
 * The seam, with its defaults. `_readme` is not decoration: JSON has no
 * comments, and the one thing a person must know before editing this file is
 * which keys the code depends on.
 */
export function seamDefaults(version) {
  return {
    _readme:
      'This file is yours to edit. exposurie READS the paths in "categories" to ' +
      'find your pages — rename a folder on disk and change it here in the same ' +
      'edit, or search stops seeing it. "excludeFiles" is read once file ' +
      'ingestion ships; everything else here is live policy you own.',
    version,
    categories: {
      sources: 'wiki/sources',
      entities: 'wiki/entities',
      concepts: 'wiki/concepts',
      syntheses: 'wiki/syntheses',
    },
    raw: 'raw',
    index: 'index.md',
    log: 'log.md',
    // Two independent axes, because one list cannot do both jobs.
    //   conversations: material that is not part of this brain at all.
    //   files:         code and artifacts that are not content, while the
    //                  conversations ABOUT them are some of the best material.
    excludeConversations: [],
    excludeFiles: [],
    // A directory carrying its own .git is a project, not content. Deterministic,
    // needs no configuration, and covers the common case on its own.
    gitReposAreProjects: true,
    guards: {
      // Retrieval returns pages, so a page that is too long to open is a page
      // that gets answered from its headings instead of its content.
      maxPageLines: 300,
      // Whatever sits in an always-loaded instruction file is paid on every
      // message, in every project, forever. The fix for crossing this is
      // compression, never a bigger ceiling.
      maxSchemaChars: 40000,
      // How much conversation one sync stages. Whole sessions only, so a
      // batch stops before exceeding this rather than splitting one. Sized
      // from a measured corpus: a median session is ~7,000 characters.
      batchChars: 120000,
    },
    // What we copied in, and what it looked like when we did. Lets a later
    // version tell "unmodified, safe to offer an update" from "they tuned it".
    // We still never apply one.
    copied: {},
  };
}

export function readSeam(vault) {
  try {
    return JSON.parse(readFileSync(seamPath(vault), 'utf8'));
  } catch {
    return null;
  }
}

export function writeSeam(vault, seam) {
  mkdirSync(join(vault, '.exposurie'), { recursive: true });
  writeFileSync(seamPath(vault), JSON.stringify(seam, null, 2) + '\n', 'utf8');
}

export function readState(vault) {
  try {
    return JSON.parse(readFileSync(statePath(vault), 'utf8'));
  } catch {
    return null;
  }
}

export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Every category folder, as absolute paths, honouring a user's renames. */
export function categoryDirs(vault, seam) {
  const cats = seam?.categories || seamDefaults('0').categories;
  return Object.values(cats).map((rel) => join(vault, ...rel.split('/')));
}

function countMarkdown(dir) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.isDirectory()) n += countMarkdown(join(dir, e.name));
    else if (e.name.endsWith('.md')) n += 1;
  }
  return n;
}

export function countPages(vault, seam) {
  return categoryDirs(vault, seam).reduce((n, d) => n + countMarkdown(d), 0);
}

const DAY = 86400000;

/**
 * Everything the state line needs, read rather than assumed.
 *
 * The state line is the retention mechanism — v1 sync is manual, so the number
 * riding on output the agent already reads is what stops a brain going stale
 * unnoticed. A hardcoded zero here would make that mechanism a decoration.
 */
export function vaultState(vault, self) {
  if (!vault || !existsSync(vault)) return { vault: null, self };
  const seam = readSeam(vault);
  const st = readState(vault) || {};
  const last = st.lastSyncUtc ? Date.parse(st.lastSyncUtc) : null;
  return {
    vault,
    self,
    pages: countPages(vault, seam),
    unfiled: st.unfiled ?? 0,
    lastSyncDays: last ? Math.floor((Date.now() - last) / DAY) : null,
    lastBackup: st.lastBackupUtc ?? null,
  };
}

/** Is there a brain here, as opposed to a folder someone made by hand? */
export function isVault(dir) {
  return !!dir && existsSync(seamPath(dir));
}

/** Age of a path in whole days, or null. Used to spot a hand-made folder. */
export function ageDays(p) {
  try {
    return Math.floor((Date.now() - statSync(p).mtimeMs) / DAY);
  } catch {
    return null;
  }
}
