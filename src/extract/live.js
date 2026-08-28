// Conversations that are still happening.
//
// THE PROBLEM, AND IT IS STRUCTURAL. exposurie runs INSIDE a coding agent
// session, and that session is writing its transcript into the very directory
// exposurie reads. So the tool observes its own operation as material. On a
// real machine draining 165 Codex sessions, batch after batch came back as, in
// the agent's own words, "mostly expected duplication from the active setup
// task and its parallel analysis sessions". The longer the drain ran, the more
// of itself it ate, and every subagent spawned along the way multiplied it.
// It cost quota and it put the tool's own setup chatter in the brain.
//
// THE RULE, which is bigger than the bug. Do not read a conversation that is
// still being had. That covers the session driving this run, every subagent it
// spawns, and a half-written transcript belonging to nobody in particular — and
// it needs no per-client special case, so it holds for clients we have not met.
// Reading half a conversation is bad on its own terms: the half that explains
// why is usually the half not written yet.
//
// DEFERRED, NEVER DROPPED. This is not the exclusion gate. Exclusion is user
// policy and permanent; this is "not yet", and the next sync takes it. Nothing
// is lost, which is why it can be applied liberally without asking anyone.
//
// WHAT IS DELIBERATELY NOT DONE: the setup session is not banned forever. Once
// it is finished and cold it is ordinary material, and on the machine that
// exposed this it held real decisions — "get each and every session", "make it
// a slash command". Excluding it permanently would drop those. The transcript
// reader already discards pure tool work with nothing said, so a sync session
// that was only tool calls arrives empty on its own.

import { basename } from 'node:path';

/**
 * A conversation touched this recently is treated as ongoing.
 *
 * exposurie is invoked BY the agent, so the driving transcript was written
 * seconds before this process started — the window only has to be wider than
 * the lag between an agent writing its turn and flushing it to disk. Five
 * minutes is far wider than that and still narrower than any real gap between
 * work sessions, so yesterday's conversation is never held back.
 *
 * Ours to pick, never a setting: a knob here is a question billed to a user who
 * has no way to answer it, and the cost of being wrong is one sync's delay.
 */
export const IN_FLIGHT_MS = 5 * 60 * 1000;

/**
 * Transcript ids the CURRENT session is known to own, from the client itself.
 *
 * Read off a real machine rather than recalled, same rule as every other path
 * in this package: Claude Code sets `CLAUDE_CODE_SESSION_ID`, and its transcript
 * is `<that id>.jsonl` — verified 2026-08-28 by matching the variable against
 * the file being appended to at that moment.
 *
 * Codex and Cursor are absent here because no equivalent has been CONFIRMED,
 * not because they are unaffected. Guessing a variable name would produce a
 * filter that matches nothing while looking like protection — the exact shape
 * of bug this codebase keeps finding. They are covered by the window instead,
 * which needs no cooperation from the client.
 */
export function liveSessionIds(env = process.env) {
  const ids = [];
  if (env.CLAUDE_CODE_SESSION_ID) ids.push(String(env.CLAUDE_CODE_SESSION_ID));
  return ids;
}

/** `<id>.jsonl` -> `<id>`, so a path can be compared with a session id. */
const stem = (p) => basename(String(p)).replace(/\.[^.]+$/, '');

/**
 * Is this candidate a conversation still in progress?
 *
 * Returns a REASON string rather than a boolean, because this defers somebody's
 * material and a sync that quietly holds things back is the failure this
 * product is most afraid of. Whatever is deferred gets said out loud.
 */
export function stillBeingWritten(cand, { now = Date.now(), env = process.env, windowMs = IN_FLIGHT_MS } = {}) {
  // Only what is being written on this machine right now. A chat out of an
  // export is a snapshot of something already finished — its timestamp is the
  // server's, and holding it back would defer material that will never change.
  if (!cand || cand.local !== true) return null;

  if (liveSessionIds(env).includes(stem(cand.path))) {
    return 'this session — the one running exposurie right now';
  }

  const at = Number(cand.sortAt) || 0;
  if (at > 0 && now - at < windowMs) return 'still being written';
  return null;
}
