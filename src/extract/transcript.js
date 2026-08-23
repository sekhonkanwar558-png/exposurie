// Turning a client transcript into conversation.
//
// A transcript is mostly not conversation. Measured across a real 128 MB corpus
// of 127 sessions: tool results, tool calls, attachments, file snapshots and
// thinking are ~99% of the bytes, and what a person and their agent actually
// said to each other is ~1.2%. Dropping the rest is an 84x reduction that costs
// nothing, because none of it carries motive — and motive is the whole reason
// this brain is worth building.
//
// THE FILTER THAT MATTERS MOST IS NOT THE OBVIOUS ONE. Text arrives wearing a
// `user` role that no person typed, and on that same corpus it outweighed the
// human's own words 9 to 1 — 1.50 MB of injected context against 0.17 MB of
// typing. A naive reader that trusts `role: "user"` builds a brain mostly out of
// directory listings and harness boilerplate, and it would look like it was
// working. Four shapes, all excluded here:
//
//   1. `isMeta` lines — injected context, hook output, environment blocks.
//      This is the big one, and nothing about the text itself gives it away.
//   2. `tool_result` blocks, which the format carries on user-role lines.
//   3. slash-command echoes and harness notices like an interrupt marker.
//   4. `isSidechain` lines — a subagent talking, not the person.
//
// One signal that looks perfect and is not: `promptSource: "typed"`. On the same
// corpus only 65 of 800 human turns carried it, because the desktop app routes
// prompts through the SDK path. Filtering on it would discard most of a person's
// life. It is measured, not guessed, and it is not used.

import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const HARNESS_TEXT = [
  /^\[Request interrupted/i,
  /^\[No response requested/i,
  /^<(command-name|command-message|command-args|local-command)/i,
];

const SURFACES = {
  'claude-desktop': 'desktop',
  cli: 'terminal',
  'claude-vscode': 'vscode',
  'sdk-cli': 'headless',
};

const blocksOf = (content) => {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return [];
};

/** Did a person type this, or did something inject it wearing their role? */
function isHumanTurn(line) {
  if (line.isMeta || line.isSidechain) return false;
  return line.type === 'user';
}

function textOf(line) {
  return blocksOf(line.message?.content)
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join('\n')
    .trim();
}

/**
 * Parse one transcript, optionally from a byte offset.
 *
 * The offset is what makes a sync resumable without re-reading a year of
 * history: these files are append-only, so remembering how far we got is
 * enough, and a session someone is still using simply yields its new turns
 * next time rather than the whole thing again.
 */
export function readTranscript(path, fromByte = 0) {
  const size = statSync(path).size;
  // A file that shrank was rotated or replaced; the offset means nothing now.
  const start = fromByte > size ? 0 : fromByte;

  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  // Slicing by byte on a UTF-8 string is wrong, so seek on the decoded text
  // only when the offset lands on a line boundary we can find.
  const text = start > 0 ? raw.slice(sliceIndex(raw, start)) : raw;

  const turns = [];
  let sessionId = null;
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
    sessionId = sessionId || o.sessionId || null;
    cwd = cwd || o.cwd || null;
    if (o.entrypoint && !surface) surface = SURFACES[o.entrypoint] || o.entrypoint;
    if (o.timestamp) {
      first = first || o.timestamp;
      last = o.timestamp;
    }

    if (o.type !== 'user' && o.type !== 'assistant') continue;
    if (o.isSidechain) continue;

    const body = textOf(o);
    if (!body) continue;

    if (o.type === 'assistant') {
      turns.push({ role: 'assistant', text: body, at: o.timestamp });
      continue;
    }
    if (!isHumanTurn(o)) {
      dropped += 1;
      continue;
    }
    if (HARNESS_TEXT.some((re) => re.test(body))) {
      dropped += 1;
      continue;
    }
    turns.push({ role: 'user', text: body, at: o.timestamp });
  }

  const chars = turns.reduce((n, t) => n + t.text.length, 0);
  return {
    path,
    id: sessionId || basename(path, '.jsonl'),
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

/**
 * Where in a decoded string does a byte offset land?
 *
 * Node gives file sizes in bytes and strings in code units, and this corpus is
 * full of em-dashes and emoji, so treating one as the other would resume mid
 * character and corrupt the first turn of every incremental sync.
 */
function sliceIndex(text, byteOffset) {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    bytes += Buffer.byteLength(text[i], 'utf8');
    if (bytes >= byteOffset) return i + 1;
  }
  return text.length;
}

/** Human-facing shape of one session, for a manifest row. */
export function describe(s) {
  const human = s.turns.filter((t) => t.role === 'user').length;
  return {
    id: s.id,
    project: s.cwd ? basename(s.cwd) : 'unknown',
    surface: s.surface,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    turns: s.turns.length,
    humanTurns: human,
    chars: s.chars,
    rawBytes: s.rawBytes,
  };
}
