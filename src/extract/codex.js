// Codex rollouts.
//
// This file exists because the client table said `readable: true` for Codex and
// nothing could read it. `init` reported "3 sessions" next to Claude Code's
// "162 sessions", sync opened all three, found no conversation in any of them,
// and marked them read. No error, no warning, no missing output — the correct
// number of sessions, quietly containing nobody.
//
// That is worse than the honest state next to it. Cursor is declared
// `readable: false` and reported as skipped, so a person knows. A client that
// claims a reader it does not have spends the user's trust on silence.
//
// THE FORMAT, read off a real machine on 2026-08-25 rather than recalled:
//
//   {"timestamp": ..., "type": "session_meta",   "payload": {id, cwd, originator, source, cli_version}}
//   {"timestamp": ..., "type": "event_msg",      "payload": {...}}            <- harness lifecycle
//   {"timestamp": ..., "type": "turn_context",   "payload": {...}}            <- harness lifecycle
//   {"timestamp": ..., "type": "response_item",  "payload": {type, role, content}}
//
// Only `response_item` with `payload.type === "message"` is conversation. The
// other payload types on one measured session: 19 reasoning, 19 function_call,
// 18 function_call_output, 4 web_search_call, against 9 messages. The same
// ~99%-is-not-conversation shape the Claude Code reader found, arriving through
// different field names.
//
// AND THE SAME IMPOSTOR PROBLEM, which is the part worth carrying over rather
// than rediscovering. Codex has three roles, not two:
//
//   developer  — system instructions. Never a person. 4 of them on this corpus.
//   user       — MOSTLY a person, and not always: the harness injects
//                <environment_context> and <turn_aborted> blocks wearing the
//                user role. Measured here: 4 injected against 7 actually typed,
//                so more than a third of what looks like this person's words
//                is the machine describing its own shell.
//   assistant  — the reply.
//
// A reader that trusts `role: "user"` builds a brain partly out of shell names
// and working directories, and looks like it is working the whole time.

import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * Blocks the harness wraps around its own injected text.
 *
 * Anchored at the start, because a person quoting one of these tags mid-message
 * is talking about it, and that is conversation.
 */
const INJECTED = [
  /^<environment_context>/i,
  /^<turn_aborted/i,
  /^<user_instructions>/i,
  /^<environment_details>/i,
];

/** Where a rollout was typed. `source` is Codex's own word for it. */
const SURFACES = {
  vscode: 'vscode',
  cli: 'terminal',
  exec: 'headless',
  app: 'desktop',
};

const textOf = (payload) =>
  (Array.isArray(payload.content) ? payload.content : [])
    .filter((b) => b && (b.type === 'input_text' || b.type === 'output_text'))
    .map((b) => b.text || '')
    .join('\n')
    .trim();

/**
 * Parse one rollout, optionally from a byte offset.
 *
 * Same resumption contract as the Claude Code reader: these files are
 * append-only, so a byte offset is enough to yield only new turns, and the
 * offset is resolved on decoded text so a multi-byte character never splits.
 */
export function readRollout(path, fromByte = 0) {
  let size;
  try {
    size = statSync(path).size;
  } catch {
    return null;
  }
  const start = fromByte > size ? 0 : fromByte;

  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const text = start > 0 ? raw.slice(sliceIndex(raw, start)) : raw;

  const turns = [];
  let id = null;
  let cwd = null;
  let surface = null;
  let first = null;
  let last = null;
  let dropped = 0;

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // a half-written last line while a session is live
    }

    if (o.timestamp) {
      first = first || o.timestamp;
      last = o.timestamp;
    }

    if (o.type === 'session_meta' && o.payload) {
      id = id || o.payload.id || null;
      cwd = cwd || o.payload.cwd || null;
      if (!surface && o.payload.source) {
        surface = SURFACES[o.payload.source] || o.payload.source;
      }
      continue;
    }

    if (o.type !== 'response_item') continue;
    const p = o.payload;
    if (!p || p.type !== 'message') continue;

    // Never a person, always the harness.
    if (p.role === 'developer' || p.role === 'system') {
      dropped += 1;
      continue;
    }

    const body = textOf(p);
    if (!body) continue;

    if (p.role === 'assistant') {
      turns.push({ role: 'assistant', text: body, at: o.timestamp });
      continue;
    }
    if (p.role !== 'user') continue;
    if (INJECTED.some((re) => re.test(body))) {
      dropped += 1;
      continue;
    }
    turns.push({ role: 'user', text: body, at: o.timestamp });
  }

  const chars = turns.reduce((n, t) => n + t.text.length, 0);
  return {
    path,
    id: id || basename(path, '.jsonl'),
    cwd,
    surface: surface || 'unknown',
    startedAt: first,
    endedAt: last,
    turns,
    chars,
    rawBytes: size,
    readTo: size,
    droppedImpostorTurns: dropped,
  };
}

/** Byte offset to string index, so a resume never lands mid-character. */
function sliceIndex(text, byteOffset) {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    bytes += Buffer.byteLength(text[i], 'utf8');
    if (bytes >= byteOffset) return i + 1;
  }
  return text.length;
}
