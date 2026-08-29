// How this copy of exposurie got here, and what the pointer is allowed to name.
//
// THE FAILURE THIS EXISTS FOR. reach.js writes a pointer into every client's
// global instructions file, and the pointer's one actionable line names a
// command. `npx @sekhon/exposurie init` leaves NO command behind: the package
// lands in a temporary cache and `exposurie` is not on PATH afterwards. So the
// documented first line a person types produced a pointer naming a command that
// does not exist — in a file paid for on every message, in every project,
// forever. Retrieval is the product, and it was dead at rest on the default
// install path with nothing reporting it.
//
// It was found the only way it could be: a real install on somebody else's
// machine, where the agent went looking for `exposurie sync` and reported the
// gap back. Nothing on the developer's own machine could ever have shown it —
// there, the binary is on PATH for unrelated reasons.
//
// THE RULE. The pointer names the invocation that works on THIS machine, and
// the install path we push is the permanent one. npx stays supported so a
// pointer is never dead, but it is a fallback rather than the target: `read` is
// meant to be cheap enough that an agent tries it speculatively, and a cold npx
// resolve is not cheap. A slow retrieval is a retrieval that stops being tried.

import { statSync } from 'node:fs';
import { join, delimiter } from 'node:path';

export const PACKAGE = '@sekhon/exposurie';

/** The one install line. Written here so nothing can print a different one. */
export const INSTALL = `npm install -g ${PACKAGE}`;

/** And its exact inverse, for the command whose whole job is being reversible. */
export const UNINSTALL = `npm uninstall -g ${PACKAGE}`;

/** What the pointer says when there is no binary to name. Never dead, just slow. */
export const NPX_INVOCATION = `npx -y ${PACKAGE}`;

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
 * Are we running out of npx's temporary cache right now?
 *
 * npm 7+ unpacks an `npx` run into `<cache>/_npx/<hash>/node_modules/...`, so
 * our own module path carries the answer. `npm_command` is checked as well
 * because a future layout change would break the path test silently, and this
 * is a claim we make to the user about their own setup.
 */
export function underNpx(env = process.env, selfPath = import.meta.url) {
  if (/[\\/]_npx[\\/]/.test(String(selfPath))) return true;
  return env.npm_command === 'exec';
}

/**
 * The one answer every caller needs, computed in one place.
 *
 * `invocation` is what goes in the pointer. `permanent` is whether this machine
 * has the install we actually want — it is the thing `init` acts on, and the
 * thing `scaffold` reports, so both cannot disagree about it.
 */
export function installState(env = process.env, platform = process.platform, selfPath = import.meta.url) {
  const binary = onPath(env, platform);
  const npx = underNpx(env, selfPath);
  return {
    binary,
    permanent: Boolean(binary),
    npx,
    invocation: binary ? 'exposurie' : NPX_INVOCATION,
  };
}

/** Just the string the pointer should name. */
export const invocation = (...a) => installState(...a).invocation;

/**
 * EVERY command this tool prints, spelled the way it works on THIS machine.
 *
 * `cmd('sync --done')` is `exposurie sync --done` where a binary exists and
 * `npx -y @sekhon/exposurie sync --done` where one does not.
 *
 * WHY THIS IS A FUNCTION AND NOT A CONSTANT, which is the whole history of the
 * bug it closes. The pointer used to hardcode `exposurie`, while the documented
 * install was `npx` — which leaves no such command behind — so every npx
 * install wrote an instruction naming nothing. That was fixed in reach.js on
 * 2026-08-28 **and nowhere else**, because the fix was made where the bug was
 * reported rather than where it lived. The same literal stayed in thirty-one
 * other places, and surfaced again on 2026-08-29 in `uninstall` — the one
 * command a person types with no agent to notice "command not found" for them.
 *
 * So the rule is now mechanical rather than remembered: **no printed command is
 * ever written as a literal.** A test runs every command on a PATH with no
 * exposurie on it and fails if a bare one appears in any output, which is a
 * property a future command cannot forget to satisfy.
 *
 * It resolves per call rather than being computed once, and that is deliberate:
 * `npm install -g` during a session changes the answer, and a value captured at
 * import would go on printing the slow form for the rest of the run.
 */
export const cmd = (rest = '') => (rest ? `${invocation()} ${rest}` : invocation());
