// `exposurie scaffold` — create the brain, and hand over the half that is theirs.
//
// This is the first command that writes anything, and it has one rule above all
// others: IT NEVER OVERWRITES. Every file it copies in becomes the user's — a
// schema their agent tuned to their life is the goal, not drift — so a second
// run tops up what is missing and reports what it left alone. Clobbering a
// tuned schema on a re-run would destroy exactly the thing the ownership split
// exists to protect.
//
// It also never creates a backup remote. The asymmetry decides it: no backup
// and the disk dies is bad and known; we push and a visibility flag is wrong
// once and every conversation the user has ever had with an AI is public,
// irreversibly, and by our hand.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detect, tilde, configPath } from '../context.js';
import { unresolved, record } from '../pending.js';
import { block, planBlock, wrap } from '../output.js';
import { OK, ERROR, HUMAN } from '../exit-codes.js';
import { version } from '../version.js';
import {
  DEFAULT_VAULT,
  expandPath,
  isVault,
  readSeam,
  writeSeam,
  seamDefaults,
  sha256,
  vaultState,
} from '../vault.js';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
const SEP = String.fromCharCode(92);

// source in the package -> destination in the brain, and what it is for.
// Everything here becomes `theirs` the moment it is written; the package keeps
// no claim on it and never edits it again.
const COPY = [
  ['CLAUDE.md', 'CLAUDE.md', 'the schema'],
  ['AGENTS.md', 'AGENTS.md', 'schema pointer, for agents that read that name'],
  ['index.md', 'index.md', 'the catalog'],
  ['log.md', 'log.md', 'the activity log'],
  ['wiki-prompt.md', join('.exposurie', 'wiki-prompt.md'), 'how pages get written'],
  ['sync.md', join('.exposurie', 'sync.md'), 'the sync procedure'],
  // The source file is `gitignore` with no dot, and it has to stay that way:
  // npm renames a `.gitignore` inside a published package to `.npmignore`, so
  // a dotted source file would simply not arrive on a user's machine — and the
  // brain would be missing its ignores with nothing reporting why.
  ['gitignore', '.gitignore', 'git ignores'],
];

const slash = (p) => p.split(SEP).join('/');

function dirs(seam) {
  return [
    '.exposurie',
    join('.exposurie', 'templates'),
    seam.raw,
    ...Object.values(seam.categories).map((rel) => join(...rel.split('/'))),
  ];
}

function git(vault, args) {
  return execFileSync('git', args, {
    cwd: vault,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

/**
 * Local history, and nothing beyond it.
 *
 * The common disaster is not a dead disk — it is an agent mangling a page, and
 * a first commit is the floor to undo back to. The commit deliberately does not
 * depend on a global git identity being configured, because failing there would
 * leave a repository with no restore point and an error about something the
 * user never asked for.
 */
function initGit(vault) {
  if (existsSync(join(vault, '.git'))) return 'already a repository — left alone';
  try {
    git(vault, ['init', '-q']);
  } catch {
    return 'git not found — no local history (nothing else is affected)';
  }
  try {
    git(vault, ['add', '-A']);
    try {
      git(vault, ['commit', '-q', '-m', 'brain: initial scaffold']);
    } catch {
      git(vault, [
        '-c',
        'user.name=exposurie',
        '-c',
        'user.email=exposurie@localhost',
        'commit',
        '-q',
        '-m',
        'brain: initial scaffold',
      ]);
    }
    return 'initialised, 1 commit — local only, no remote';
  } catch {
    return 'initialised, nothing committed yet';
  }
}

/** Write a file only if it is absent. Returns true when it actually wrote. */
function writeIfAbsent(path, text) {
  if (existsSync(path)) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return true;
}

export function scaffold({ at } = {}) {
  const d = detect();
  const asked = expandPath(at);
  const target = asked || d.vault || DEFAULT_VAULT;

  // One brain per person is a design decision, so a second location is almost
  // always a mistake rather than an intent. Refusing is recoverable; silently
  // re-pointing the config orphans a brain that still holds everything.
  if (d.vault && asked && asked !== d.vault) {
    return {
      code: ERROR,
      state: vaultState(d.vault, 'scaffold'),
      error: {
        message:
          `A brain already exists at ${tilde(d.vault)}, and a brain is meant to span ` +
          `everything rather than sit one per project. Nothing was written to ` +
          `${tilde(asked)}. To move it, move the folder yourself and then edit ` +
          `"vault" in ${tilde(configPath())}.`,
        // FIX is one short action on purpose: it is never wrapped, because
        // wrapping a command breaks it, and a test pins the length.
        fix: 'RUN: exposurie scaffold   (tops up the brain that exists)',
      },
    };
  }

  const fresh = !isVault(target);
  const v = version();
  const seam = readSeam(target) || seamDefaults(v);

  mkdirSync(target, { recursive: true });
  for (const rel of dirs(seam)) mkdirSync(join(target, rel), { recursive: true });

  const created = [];
  const kept = [];
  const copied = { ...(seam.copied || {}) };

  for (const [src, dest, what] of COPY) {
    const text = readFileSync(join(TEMPLATES, src), 'utf8');
    if (writeIfAbsent(join(target, dest), text)) {
      created.push([slash(dest), `${what} — yours now`]);
      // Record what we wrote and what it looked like, so a later version can
      // tell "untouched, safe to offer an update" from "they tuned it". It is
      // never the basis for applying one.
      copied[slash(dest)] = { version: v, sha256: sha256(text) };
    } else {
      kept.push([slash(dest), 'already there, not touched']);
    }
  }

  let newTemplates = 0;
  const pages = readdirSync(join(TEMPLATES, 'pages'));
  for (const name of pages) {
    const text = readFileSync(join(TEMPLATES, 'pages', name), 'utf8');
    if (writeIfAbsent(join(target, '.exposurie', 'templates', name), text)) {
      copied[`.exposurie/templates/${name}`] = { version: v, sha256: sha256(text) };
      newTemplates += 1;
    }
  }
  if (newTemplates) {
    created.push([
      '.exposurie/templates/',
      `${newTemplates} page template${newTemplates === 1 ? '' : 's'} — yours now`,
    ]);
  } else {
    kept.push(['.exposurie/templates/', `${pages.length} page templates, not touched`]);
  }

  seam.copied = copied;
  seam.version = seam.version || v;
  if (!seam.created) seam.created = new Date().toISOString();
  writeSeam(target, seam);

  const gitStatus = initGit(target);

  // The pointer every later command reads to find the brain, from any folder.
  // Machine-level and ours; the seam config inside the brain is the user's.
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(
    configPath(),
    JSON.stringify({ vault: target, version: v, created: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  );

  const open = unresolved({ exports: d.exports, obsidianInstalled: false }, ['claude-web-export']);
  // Now that a brain exists, an open step is mirrored to disk as well as
  // printed. Auto mode blows past a terminal; a file is still there tomorrow.
  for (const p of open) record(target, p);

  // The seam is listed even though writeSeam always runs: it is the one file
  // both sides read, so a person editing folder names needs to know it is there.
  if (fresh) {
    created.push(['.exposurie/config.json', 'the seam — folder names, exclusions, guards']);
  } else {
    kept.push(['.exposurie/config.json', 'the seam — your settings kept, stamps refreshed']);
  }

  const rows = [['brain', tilde(target)], ...created, ['git', gitStatus]];

  const body = [
    ...block(fresh ? 'CREATED' : 'TOPPED UP', rows),
    ...(kept.length ? ['', ...block('KEPT — yours, not touched', kept)] : []),
    '',
    'BACKUP',
    ...wrap(
      'This brain is on one disk. git gives local history and undo, which covers ' +
        'an agent mangling a page; it does not survive the disk dying. exposurie ' +
        'will never create a remote for you, because a visibility setting wrong ' +
        'once publishes every conversation the user has ever had with an AI.',
      74,
      '  ',
    ),
    '  TELL YOUR USER: their brain is local-only until they configure a remote.',
    '',
    ...planBlock([
      { read: join(target, 'CLAUDE.md') },
      { read: join(target, '.exposurie', 'wiki-prompt.md') },
    ]),
    '',
    ...wrap(
      'Both of those belong to the user now, not to us. They are meant to be ' +
        'edited as the brain finds its shape, and exposurie will never overwrite ' +
        'them.',
      74,
      '  ',
    ),
  ];

  return {
    code: open.length ? HUMAN : OK,
    state: vaultState(target, 'scaffold'),
    pending: open,
    body,
    json: {
      brain: target,
      fresh,
      created: created.map(([f]) => f),
      kept: kept.map(([f]) => f),
      git: gitStatus,
      config: configPath(),
      pending: open.map((p) => p.id),
    },
  };
}
