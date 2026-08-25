// Files the user put in their brain.
//
// `scaffold` has always created a `raw/` folder and nothing has ever read it.
// A person does the obvious thing — drops a PDF, a lecture note, a contract in
// there — and it sits there forever. That is worse than an unbuilt feature: the
// folder is an invitation the product does not honour.
//
// THE JOB IS SMALLER THAN IT LOOKS, and mistaking its size is why it stayed
// unbuilt. "Ingest PDFs with no dependencies" is a hard problem. It is also not
// this problem: the agent reading the batch opens files natively — Claude Code,
// Codex and Cursor all do. So the deterministic half is only ever
//
//   notice what is new  ->  gate it  ->  point at it
//
// which is the same division as everywhere else in this product. We never parse
// a document, and we never inline one either: a file is POINTED AT, always,
// whatever its size. One rule, no threshold to get wrong, and the model reads
// the real bytes rather than our idea of them.
//
// The gate runs before anything is opened, because that is what a gate means —
// and here it finally makes `excludeFiles` and `fileExcluded()` live. Both had
// been shipped and wired to nothing.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

import { fileExcluded } from './exclude.js';

/**
 * Extensions no agent can do anything with.
 *
 * A denylist rather than an allowlist, deliberately. An allowlist decides in
 * advance what a person is allowed to keep, and gets it wrong in the direction
 * that loses their material — a `.eml`, a `.srt`, a `.tex` are all somebody's
 * notes. What is excluded here is only what cannot be READ at all: compressed
 * bundles, executables, and time-based media.
 */
const UNREADABLE = new Set([
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.iso', '.dmg',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.msi', '.deb', '.rpm', '.app',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv',
  '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.db', '.sqlite', '.sqlite3', '.lock', '.pyc', '.class', '.o', '.a',
]);

/** Folders that are never content, whatever they contain. */
const SKIP_DIRS = new Set([
  '.git', '.exposurie', 'node_modules', '__pycache__', '.venv', 'venv',
  '.DS_Store', '.idea', '.vscode', 'dist', 'build', 'target',
]);

const MAX_DEPTH = 8;

function walk(dir, root, acc, depth = 0) {
  if (depth > MAX_DEPTH) return acc;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc; // permissions, a folder that vanished mid-walk
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.isDirectory()) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, root, acc, depth + 1);
    else if (!e.name.startsWith('.')) acc.push(p);
  }
  return acc;
}

const human = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
};

/**
 * What is in `raw/` that the brain has not been told about yet.
 *
 * Identity is `raw:<relative path>` rather than an absolute path, so a brain
 * that moves folders does not re-stage everything it already read. Freshness is
 * size plus modification time: a document is not append-only, so there is no
 * byte offset to resume from — a changed file is simply pointed at again.
 */
export function findNewFiles(vault, seam, seen = {}, limit = 25) {
  const rawRel = seam?.raw || 'raw';
  const root = join(vault, ...String(rawRel).split('/'));
  if (!existsSync(root)) {
    return { files: [], excluded: [], unreadable: [], remaining: 0, root };
  }

  const all = walk(root, root, []);
  const files = [];
  const excluded = [];
  const unreadable = [];

  for (const path of all) {
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }

    const rel = relative(vault, path).split(String.fromCharCode(92)).join('/');
    const key = `raw:${relative(root, path).split(String.fromCharCode(92)).join('/')}`;

    // The gate, before anything is opened. `fileExcluded` also knows that a
    // directory carrying its own .git is somebody's project rather than a page
    // of a brain, which needs no configuration and covers the common case.
    const why = fileExcluded(path, seam, vault);
    if (why) {
      excluded.push({ rel, why });
      continue;
    }

    const ext = extname(path).toLowerCase();
    if (UNREADABLE.has(ext)) {
      // Reported, not silently dropped: a person who put a video in their brain
      // should be told it was left alone rather than left to assume it landed.
      unreadable.push({ rel, ext, size: st.size });
      continue;
    }

    const prior = seen[key];
    if (prior && prior.size === st.size && prior.mtime === st.mtimeMs) continue;

    files.push({
      key,
      path,
      rel,
      ext,
      size: st.size,
      human: human(st.size),
      mtime: st.mtimeMs,
      isNew: !prior,
    });
  }

  // Newest first, for the same reason conversation is: recent material is what
  // makes older material legible.
  files.sort((a, b) => b.mtime - a.mtime);
  const batch = files.slice(0, limit);
  return { files: batch, excluded, unreadable, remaining: files.length - batch.length, root };
}

/**
 * The list the agent is handed.
 *
 * A file per plan step would make a plan of forty lines, so the plan gets one
 * step pointing here and this page carries the paths. Sizes are printed because
 * the model is the thing deciding what a 40 MB PDF is worth opening — a rule we
 * invented for that would be a guess about somebody else's document.
 */
export function renderFiles(found, vault) {
  const out = [
    '# Files waiting in the brain',
    '',
    `${found.files.length} file${found.files.length === 1 ? '' : 's'} in \`${found.root}\` ` +
      'that have not been folded into any page yet.',
    '',
    '**Open each one and fold what it says into the wiki**, the same way a',
    'conversation is folded in: the point is what it MEANS for this person, not',
    'a copy of its contents. Cite it from the page it belongs to.',
    '',
    'Nothing here has been read by exposurie. It notices files and points; you',
    'are the thing that can actually open a PDF.',
    '',
    '| file | size |',
    '|---|---|',
    ...found.files.map((f) => `| \`${f.rel}\` | ${f.human} |`),
    '',
  ];

  if (found.unreadable.length) {
    out.push('## Left alone', '');
    out.push(
      'Archives, executables and time-based media. Nothing can read these as ' +
        'text, so they are recorded here rather than skipped in silence:',
      '',
    );
    for (const u of found.unreadable) out.push(`- \`${u.rel}\` (${human(u.size)})`);
    out.push('');
  }

  if (found.excluded.length) {
    out.push('## Excluded by your settings', '');
    for (const e of found.excluded) out.push(`- \`${e.rel}\` — ${e.why}`);
    out.push('');
  }

  if (found.remaining > 0) {
    out.push(
      `## ${found.remaining} more waiting`,
      '',
      'They come next, newest first, on the following sync.',
      '',
    );
  }

  return out.join('\n');
}
