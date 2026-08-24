// Can a stranger's agent reach the brain at all?
//
// The brain's own `CLAUDE.md` is the schema, and it is large on purpose — but
// it only loads when the agent is standing IN the brain folder. Nobody works
// there. They work in a code repo, and that session has no idea a brain exists
// two folders over. That gap is not hypothetical: it is true on the machine
// this tool was written on.
//
// So the package writes a POINTER into each client's global instructions file —
// the one file that loads in every session, in every folder. A few hundred
// bytes: the brain exists, here is the one command. Never content. Whatever
// sits here is paid on every message of every project forever, so the schema
// stays in the brain where it belongs and this stays small enough not to matter.
//
// Why a markdown file and not an MCP server, since MCP would put the same
// pointer in the tool list for free: an MCP server fails inside another
// vendor's process, spawned by their app, in an environment we cannot inspect —
// so a stranger's bug report is unreproducible and therefore unfixable. This
// fails, if it fails at all, as prose in a file that nothing parses. No
// restart, no child process, no `npx`-not-found. We own the whole failure path.

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export const START = '<!-- exposurie:start -->';
export const END = '<!-- exposurie:end -->';

/**
 * The pointer itself. This is the product: whether a stranger's agent reaches
 * the brain is decided by these words and nothing else.
 *
 * Three choices, each against a specific failure:
 *   "You cannot see it - you must read it"  - the model answers from context
 *      and assumes it already knows the user.
 *   "before saying you do not know"         - that sentence is the exact moment
 *      the tool should fire, and a descriptive "you have a brain" fires on
 *      nothing. Conditions fire; statements do not.
 *   "names the exact next command"          - one entry is enough, so trying
 *      feels cheap. `read` never returns a dead end, and the agent should know
 *      that before it decides whether to bother.
 *
 * Changing this text changes the product. Measure before and after.
 */
// The pointer itself. Every word here is paid on every message, in every
// project, forever - so it earns its place or it goes.
//
// It claims precedence over ONE thing: what the agent assumes about the user.
// Not over instructions the user wrote, and not over the project it sits in.
// That scoping is deliberate and it is not politeness - authority is not a
// mechanism we control, and a block reading as 'ignore everything else' gets
// discounted as injection-shaped. What measured 6/6 was a conditional trigger,
// so the trigger is what got sharpened rather than the tone.
export const POINTER = [
  'The user has an external brain: a curated wiki of their past work,',
  'decisions, people and projects, built by this tool.',
  '',
  'On anything about THIS USER — their decisions, preferences, projects,',
  'people, history — the brain is authoritative. It outranks what you',
  'assume and whatever you infer from the current folder. You cannot see',
  'it; you must read it.',
  '',
  'Before answering any such question, and before saying you do not know',
  'something about them, run:',
  '',
  '    exposurie read --search "<topic>"',
  '',
  'Every result names the exact next command. Do not answer from memory first.',
].join('\n');

/**
 * Where each client keeps the file that loads in EVERY session.
 *
 * Same rule as the transcript roots in context.js: read off a real machine, not
 * recalled. `verified` means the location was OBSERVED here — for Claude Code
 * that is proven rather than assumed, since the file's contents arrive in the
 * model's context at session start. Everything else is the client's documented
 * convention, unconfirmed on this machine, and says so in the output.
 *
 * This table can afford to be wrong, and that is the whole reason the pointer
 * is a markdown file. A path we guessed wrong writes prose nothing reads: no
 * breakage, no support ticket, fixable in one line whenever someone tells us.
 * A wrong path in an MCP registration corrupts a config another tool depends
 * on. Same table, opposite blast radius.
 *
 * A client whose ROOT is absent is skipped entirely, so this list costs nothing
 * to extend — an entry for a client the user does not have never writes a byte.
 * That is what makes it safe to carry names ahead of confirmation.
 *
 * Windows and mac need no divergence for most of this, and that is a dividend
 * of dropping MCP rather than an accident: every path below is a dot-directory
 * in the home folder, which `homedir()` resolves identically on win32, darwin
 * and linux. The platform-specific mess — %APPDATA% vs ~/Library/Application
 * Support vs ~/.config — lives almost entirely in the MCP config files we are
 * no longer writing. OpenCode is the one client that genuinely splits, so both
 * of its locations are listed; an absent root is skipped, so carrying two
 * entries for one client costs nothing on a machine that has only one.
 *
 * AGENTS.md is doing real work here: Codex and OpenCode both read that one
 * filename, so four clients are three conventions, not four.
 *
 */
export function contextFiles(home = homedir()) {
  const xdg = (...r) => join(home, '.config', ...r);
  return [
    // Observed here: this file's contents arrive in the model's context at
    // session start, which is proof it loads rather than an assumption.
    m('claude-code', 'Claude Code', join(home, '.claude'), join(home, '.claude', 'CLAUDE.md'), true),

    m('codex', 'Codex', join(home, '.codex'), join(home, '.codex', 'AGENTS.md')),

    // OpenCode genuinely splits by platform; both are listed rather than
    // switched on process.platform, since an absent root writes nothing.
    m('opencode', 'OpenCode', xdg('opencode'), xdg('opencode', 'AGENTS.md')),
    m('opencode', 'OpenCode', join(appData(home), 'opencode'), join(appData(home), 'opencode', 'AGENTS.md')),

    // Cursor reads a RULES DIRECTORY, so we write our own file into it instead
    // of appending to a file of theirs. Nothing of the user's is in it, so
    // removal deletes it outright and there is no merge to get wrong.
    m('cursor', 'Cursor', join(home, '.cursor'), join(home, '.cursor', 'rules', 'exposurie.mdc'), false, true),

  ];
}

/**
 * One row. `verified` is false unless the location was observed on a real
 * machine — the list is deliberately AHEAD of confirmation, because a client we
 * have not seen yet is a user we silently fail rather than a risk we avoided.
 *
 * What makes running ahead safe is the invariant below: every target is
 * markdown. A guessed path that lands on a .json or .toml a client parses could
 * break that client; a guessed .md path is, at worst, a file nothing reads.
 */
function m(id, name, root, file, verified = false, owned = false) {
  if (!/\.(md|mdc)$/.test(file)) {
    throw new Error(`reach: ${id} target must be markdown, got ${file}`);
  }
  return { id, name, root, file, verified, owned };
}

/** %APPDATA%, honouring the env var when it is set since it can be redirected. */
const appData = (home) =>
  home === homedir() && process.env.APPDATA
    ? process.env.APPDATA
    : join(home, 'AppData', 'Roaming');

const bounded = (text) => `${START}\n${text}\n${END}`;

/**
 * Put the pointer in, or bring it up to date, without touching a byte the user
 * wrote.
 *
 * An existing block is replaced WHERE IT SITS rather than moved to the end: the
 * file belongs to the user, and silently reordering it on every scaffold is the
 * kind of churn that makes a person stop trusting a tool with their files.
 */
export function inject(path, text = POINTER) {
  const desired = bounded(text);
  const had = existsSync(path);
  const before = had ? readFileSync(path, 'utf8') : '';

  const s = before.indexOf(START);
  const e = before.indexOf(END);

  let after;
  if (s !== -1 && e !== -1 && e > s) {
    after = before.slice(0, s) + desired + before.slice(e + END.length);
  } else if (before.trim() === '') {
    after = desired + '\n';
  } else {
    // Appended, never prepended. The user's first lines are theirs and may be
    // ordered on purpose.
    after = before.replace(/\s*$/, '') + '\n\n' + desired + '\n';
  }

  if (had && after === before) return { action: 'unchanged', bytes: desired.length };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, after, 'utf8');
  return { action: had ? 'updated' : 'created', bytes: desired.length };
}

/**
 * Take it back out, leaving the rest exactly as found. Uninstall has to be real
 * for "we own the failure path" to mean anything - a pointer we cannot remove
 * is a pointer we have imposed.
 */
export function remove(path, { owned = false } = {}) {
  if (!existsSync(path)) return { action: 'absent' };
  const before = readFileSync(path, 'utf8');
  const s = before.indexOf(START);
  const e = before.indexOf(END);
  if (s === -1 || e === -1 || e < s) return { action: 'absent' };

  const after = (before.slice(0, s) + before.slice(e + END.length)).replace(/\n{3,}/g, '\n\n');
  // A file that only ever held our block is ours to delete. Leaving an empty
  // file behind in someone's rules directory is litter, and a client that scans
  // that directory would go on loading nothing forever.
  if (owned && after.trim() === '') {
    rmSync(path);
    return { action: 'removed' };
  }
  writeFileSync(path, after, 'utf8');
  return { action: 'removed' };
}

/**
 * Every client present on this machine, pointed at the brain.
 *
 * A client whose root does not exist is SKIPPED, not created: making a
 * `~/.cursor` on a machine with no Cursor is littering in someone's home
 * directory to no effect.
 */
export function reachAll({ home = homedir(), text = POINTER } = {}) {
  return contextFiles(home)
    .filter((c) => existsSync(c.root))
    .map((c) => ({ ...c, ...inject(c.file, text) }));
}

export function unreachAll({ home = homedir() } = {}) {
  return contextFiles(home)
    .filter((c) => existsSync(c.root))
    .map((c) => ({ ...c, ...remove(c.file, { owned: c.owned }) }));
}
