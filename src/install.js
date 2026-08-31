// How this copy of exposurie got here, and what the pointer is allowed to name.
//
// THE FAILURE THIS EXISTS FOR. reach.js writes a pointer into every client's
// global instructions file, and the pointer's one actionable line names a
// command. A package run out of a temporary cache leaves NO command behind, so
// the documented first line a person typed produced a pointer naming a command
// that does not exist — in a file paid for on every message, in every project,
// forever. Retrieval is the product, and it was dead at rest with nothing
// reporting it.
//
// It was found the only way it could be: a real install on somebody else's
// machine, where the agent went looking for `exposurie sync` and reported the
// gap back. Nothing on the developer's own machine could ever have shown it —
// there, the binary is on PATH for unrelated reasons.
//
// THE RULE, and it changed on 2026-08-29. There is exactly one invocation:
// `exposurie`. The tool used to carry a second, slower one for machines with
// nothing on PATH, so that a pointer was never dead. That is gone. The
// invariant it protected is now kept the other way round: **the commands that
// write a pointer refuse to run until the command they would name exists.**
// `init` already gated on it; `scaffold` does now too.
//
// This is the stronger version of the same promise. A fallback form guarantees
// the pointer resolves; it does not guarantee the pointer is worth having —
// every lookup paid a package resolve, and a retrieval that is slow is a
// retrieval that stops being tried, which is the same failure as a broken one,
// arriving later. Requiring the install costs one line at setup, once, and
// after that there is one spelling of every command on every machine forever.

import { statSync } from 'node:fs';
import { join, delimiter } from 'node:path';

export const PACKAGE = '@sekhon/exposurie';

/** The one install line. Written here so nothing can print a different one. */
export const INSTALL = `npm install -g ${PACKAGE}`;

/** And its exact inverse, for the command whose whole job is being reversible. */
export const UNINSTALL = `npm uninstall -g ${PACKAGE}`;

/** The one invocation. There is no second one, and there must not be. */
export const INVOCATION = 'exposurie';

/**
 * Windows resolves a bare command name through PATHEXT; POSIX executes the file
 * itself. The empty string is last on both so a real extension always wins.
 */
const WINDOWS_EXTS = ['.cmd', '.exe', '.bat', '.ps1', ''];

/**
 * Where `exposurie` would resolve from, or null.
 *
 * Scanning PATH rather than spawning `which`/`where`: no child process, no
 * platform branch on the command name, and it works identically under a test
 * harness that hands us a fake env. A directory that happens to be named
 * `exposurie` is not a command, hence the isFile check — the cheap version of
 * this returned a false positive on exactly that.
 */
export function onPath(env = process.env, platform = process.platform) {
  const raw = env.PATH || env.Path || env.path || '';
  if (!raw) return null;
  const exts = platform === 'win32' ? WINDOWS_EXTS : [''];
  for (const dir of raw.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, `exposurie${ext}`);
      try {
        if (statSync(p).isFile()) return p;
      } catch {
        // Missing, or a directory we cannot stat. Both mean "not here".
      }
    }
  }
  return null;
}

/**
 * The one answer every caller needs, computed in one place.
 *
 * `permanent` is whether this machine has the install the product requires. It
 * is what `init` acts on and what `scaffold` now refuses on, so the two cannot
 * disagree about it. `invocation` is kept as a field rather than inlined at
 * forty call sites: it is a fact about the product, and one place to read it is
 * how it stays that way.
 */
export function installState(env = process.env, platform = process.platform) {
  const binary = onPath(env, platform);
  return {
    binary,
    permanent: Boolean(binary),
    invocation: INVOCATION,
  };
}

/**
 * Shell-safe quoting for one argument of a printed command.
 *
 * Every printed command is executed by an agent, so an argument that needs
 * quoting and does not get it is a command that runs and does the WRONG THING
 * rather than one that fails. Titles were quoted from the start; paths were
 * not, and paths are the ones that carry spaces on Windows, where
 * `C:\Users\First Last` is the normal shape of a home directory.
 *
 * What that cost: `init` on a machine belonging to anybody with a space in
 * their name printed `RUN: exposurie scaffold --at C:\Users\Priya Sharma\brain`.
 * An agent running that line built the brain at `C:\Users\Priya`, reported
 * success, and exited 10 — the code that means "nothing has failed". The first
 * command of the product, wrong, silent, and only on other people's machines.
 *
 * `~` is safe inside the quotes: no shell expands it there, and expandPath()
 * resolves it itself, so the tool never depended on the shell for that.
 */
export function q(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`;
}

/** Just the string the pointer should name. */
export const invocation = () => INVOCATION;

/**
 * EVERY command this tool prints, in the one spelling there is.
 *
 * `cmd('sync --done')` is `exposurie sync --done`, everywhere, always.
 *
 * WHY THIS IS STILL A FUNCTION now that it resolves nothing. It was the seam
 * that made "no printed command is ever written as a literal" a mechanical rule
 * instead of a remembered one, and that rule is what a test can enforce. The
 * second invocation is gone; the discipline that catches the next one is not.
 * Thirty-one call sites went on printing a bare literal for a whole release
 * because the fix was made where the bug was reported rather than where it
 * lived, and this is the shape that stops that recurring.
 */
export const cmd = (rest = '') => (rest ? `${INVOCATION} ${rest}` : INVOCATION);
