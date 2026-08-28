// The ChatGPT export.
//
// The symmetric case to claude.ai, and the one that matters for anybody setting
// up a brain from Codex: their coding agent is OpenAI's, so their web history is
// at chatgpt.com, and asking them for a claude.ai export would be asking for an
// account they may not have.
//
// ─── WHAT IS PROVEN HERE, AND WHAT IS NOT ───────────────────────────────────
//
// This reader was originally written against the DOCUMENTED shape of the format
// rather than a real file, because there was no ChatGPT export on the machine it
// was built on — precisely the situation that produced the Codex bug, where a
// reader existed, was declared readable, and returned nothing from every file
// while the session count looked correct. The safety was never confidence in
// the parse; it was that a failed parse cannot be silent. `readChatGptExport`
// reports an archive yielding no conversation as UNREADABLE rather than as
// empty, and the sync prints that.
//
// THE PARSE IS NOW EVIDENCE. Run on a real export of 1,164 conversations on
// somebody else's machine (2026-08-26): 1,157 readable, 7 genuinely empty, no
// parse error. The tree walk below, `current_node` and all, is confirmed
// against the real thing rather than against OpenAI's docs.
//
// DISCOVERY IS NOT, AND IS THE OPEN DEFECT. That export reached this parser
// only because it was repackaged by hand first. OpenAI delivered it already
// unpacked into a dated folder, split across `conversations-000.json` through
// `conversations-011.json` — so context.js found no zip, and would not have
// recognised one, since sniff() requires a literal `conversations.json` member.
// Everything below works. Nothing was reaching it.
//
// ─── THE FORMAT ─────────────────────────────────────────────────────────────
//
// `conversations.json` is an array. Each conversation is a TREE, not a list:
//
//   { title, create_time, update_time, conversation_id, current_node,
//     mapping: { "<node-id>": { id, parent, children: [], message } } }
//
// and a message is:
//
//   { id, author: { role: user|assistant|system|tool, metadata },
//     create_time, content: { content_type, parts|text }, metadata }
//
// The tree exists because edits and regenerations branch it. `current_node` is
// the leaf of the branch the person actually ended up with, so walking parents
// from there reconstructs the conversation as they experienced it. Taking every
// node instead would fold three re-rolls of the same answer into the brain as
// three different things somebody said.

import { statSync } from 'node:fs';
import { openZip, ZipError } from './zip.js';

export const CONVERSATIONS = 'conversations.json';

/** ChatGPT's own marker file. Claude's export has no `chat.html`. */
export const SIGNATURE = 'chat.html';

/**
 * Content blocks that are not conversation.
 *
 * `code` and `execution_output` are the analysis tool; the `tether_*` types are
 * browsing. Same call as everywhere else in this product: the tool work is most
 * of the bytes and none of the motive.
 */
const SPOKEN_TYPES = new Set(['text', 'multimodal_text']);

function textOf(message) {
  const c = message.content;
  if (!c) return '';
  if (!SPOKEN_TYPES.has(c.content_type)) return '';
  const parts = Array.isArray(c.parts) ? c.parts : c.text ? [c.text] : [];
  return parts
    // In `multimodal_text`, image pointers arrive as objects alongside the
    // strings. Only the strings were typed.
    .filter((p) => typeof p === 'string')
    .join('\n')
    .trim();
}

/** Text the interface hides from the person is not part of their conversation. */
function hidden(message) {
  const m = message.metadata || {};
  return m.is_visually_hidden_from_conversation === true;
}

/**
 * Custom instructions — what the person told ChatGPT about themselves.
 *
 * These ride the `user` role but are not a turn: the same block is attached to
 * every conversation in the account, so leaving them inline would repeat one
 * paragraph several hundred times across a brain. They are hoisted into
 * standing context instead, which is where claude.ai's `memories.json` goes,
 * and for the same reason — it is already distilled and it is about them.
 */
function isCustomInstructions(message) {
  return (message.metadata || {}).is_user_system_message === true;
}

/**
 * The branch the person ended on, oldest turn first.
 *
 * Falls back to every node in creation order when `current_node` is missing or
 * does not resolve — an export truncated mid-write should still give up what it
 * has rather than nothing.
 */
function activeBranch(conv) {
  const mapping = conv.mapping || {};
  const chain = [];
  let id = conv.current_node;
  const guard = new Set();

  while (id && mapping[id] && !guard.has(id)) {
    guard.add(id);
    chain.push(mapping[id]);
    id = mapping[id].parent;
  }
  if (chain.length > 1) return chain.reverse();

  return Object.values(mapping)
    .filter((n) => n && n.message)
    .sort((a, b) => (a.message.create_time || 0) - (b.message.create_time || 0));
}

const stamp = (seconds) =>
  typeof seconds === 'number' && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : null;

function toSession(conv, source) {
  const turns = [];
  const instructions = [];

  for (const node of activeBranch(conv)) {
    const m = node && node.message;
    if (!m) continue;

    const role = (m.author && m.author.role) || '';
    if (role === 'system' || role === 'tool') continue;
    if (hidden(m)) continue;

    const text = textOf(m);
    if (!text) continue;

    if (role === 'user' && isCustomInstructions(m)) {
      instructions.push(text);
      continue;
    }
    if (role !== 'user' && role !== 'assistant') continue;

    turns.push({ role, text, at: stamp(m.create_time) });
  }

  const chars = turns.reduce((n, t) => n + t.text.length, 0);
  const updated = stamp(conv.update_time) || stamp(conv.create_time);
  const id = conv.conversation_id || conv.id;

  return {
    // Prefixed by service, so a ChatGPT and a Claude conversation can never
    // collide on a uuid in the same state file.
    path: `chatgpt:${id}`,
    id: `chatgpt:${id}`,
    cwd: null,
    project: conv.title || 'untitled chat',
    surface: 'chatgpt',
    startedAt: stamp(conv.create_time),
    endedAt: updated,
    updatedAt: updated,
    turns,
    chars,
    attachments: 0,
    rawBytes: 0,
    readTo: chars,
    instructions,
    source,
  };
}

/**
 * Everything readable in one ChatGPT export.
 *
 * The `ok: false` on a zero-conversation archive is the whole safety story of
 * this file — see the warning at the top. An archive that parsed, held
 * conversations, and produced no words from any of them means the shape below
 * is wrong, and that must arrive as a failure with a name on it.
 */
export function readChatGptExport(path) {
  let zip;
  try {
    zip = openZip(path);
  } catch (e) {
    return { path, ok: false, error: e instanceof ZipError ? e.message : String(e.message || e), sessions: [] };
  }

  try {
    if (!zip.has(CONVERSATIONS)) {
      return { path, ok: false, error: `no ${CONVERSATIONS} in the archive`, sessions: [] };
    }

    let convs;
    try {
      convs = JSON.parse(zip.read(CONVERSATIONS));
    } catch (e) {
      return { path, ok: false, error: `${CONVERSATIONS} is not valid JSON (${e.message})`, sessions: [] };
    }
    if (!Array.isArray(convs)) {
      return {
        path,
        ok: false,
        error: `${CONVERSATIONS} is not a list of conversations — the export format may have changed`,
        sessions: [],
      };
    }

    const sessions = [];
    const instructions = new Set();
    let skippedEmpty = 0;

    for (const c of convs) {
      const s = toSession(c, path);
      for (const i of s.instructions) instructions.add(i);
      if (s.turns.length === 0) skippedEmpty += 1;
      else sessions.push(s);
    }

    // The guard. A non-empty archive that yields nobody is a parser failure
    // wearing the shape of an empty account, and this product has shipped that
    // exact bug once already.
    if (convs.length > 0 && sessions.length === 0) {
      return {
        path,
        ok: false,
        error:
          `${convs.length} conversations are in this export and none of them could be read. ` +
          `That is a bug in exposurie, not something wrong with the file — please report it.`,
        sessions: [],
      };
    }

    let size = 0;
    try {
      size = statSync(path).size;
    } catch {}

    return {
      path,
      ok: true,
      error: null,
      sessions,
      skippedEmpty,
      instructions: [...instructions],
      standing: standingFrom([...instructions]),
      zipBytes: size,
    };
  } catch (e) {
    return { path, ok: false, error: e instanceof ZipError ? e.message : String(e.message || e), sessions: [] };
  } finally {
    zip.close();
  }
}

/** Custom instructions as standing context, in the shape webchat.js renders. */
export function standingFrom(instructions) {
  if (!instructions || instructions.length === 0) return null;
  return {
    memory: instructions.join('\n\n'),
    memoryLabel: 'What they told ChatGPT about themselves',
    projectMemories: [],
    projects: [],
  };
}

/**
 * Every ChatGPT export on the machine, read as one corpus.
 *
 * Same de-duplication rule as claude.ai: exports are full snapshots, so keying
 * on the conversation's own id is what stops a person who exported twice from
 * getting their brain written out of two copies of every chat.
 */
export function readChatGptExports(paths) {
  const ordered = [...paths].sort((a, b) => {
    const at = (p) => {
      try {
        return statSync(p).mtimeMs;
      } catch {
        return 0;
      }
    };
    return at(b) - at(a);
  });

  const byId = new Map();
  const failed = [];
  const instructions = new Set();
  let duplicates = 0;
  let skippedEmpty = 0;

  for (const p of ordered) {
    const r = readChatGptExport(p);
    if (!r.ok) {
      failed.push({ path: p, error: r.error });
      continue;
    }
    skippedEmpty += r.skippedEmpty || 0;
    for (const i of r.instructions || []) instructions.add(i);
    for (const s of r.sessions) {
      if (byId.has(s.id)) {
        duplicates += 1;
        continue;
      }
      byId.set(s.id, s);
    }
  }

  return {
    sessions: [...byId.values()],
    standing: standingFrom([...instructions]),
    exports: ordered.length,
    failed,
    duplicates,
    skippedEmpty,
  };
}
