// The claude.ai export — which is not a side channel, it is the main one.
//
// Measured on a real export against the same person's local transcripts:
//
//     claude.ai web chats     264 KB of their own typed words
//     every Claude Code session on the machine    166 KB
//
// The web is where people think out loud. The machine is where they work. For
// anyone who has not spent a year in a terminal it is not 1.6x — it is all of
// it, and a brain built without this is a brain built out of the smaller half
// of someone's life. That is the whole reason the export is asked for, and it
// is why the request had to stop being a dead end.
//
// FOUR THINGS COME OUT OF ONE ZIP, and only the first is chat:
//
//   conversations.json   the chats. Same doctrine as a transcript: text only,
//                        no thinking, no tool blocks, no pasted file bodies.
//   memories.json        claude.ai's own distilled memory of the person. Prose,
//                        already curated, the highest signal-per-byte in the
//                        archive. Nothing else in the product has anything
//                        like it.
//   projects/*.json      project instructions — what they are building and how
//                        they want it done. Motive, stated by them, on purpose.
//   design_chats/*.json  the same shape as a conversation under another name.
//
// Reading only `conversations.json` would leave the two most concentrated
// files in the archive on the floor.
//
// WHAT IS DROPPED, and why it is the same call the transcript reader makes:
// on a measured export, 15.5 MB of JSON carried 264 KB of human text. Assistant
// replies, thinking, tool blocks and the extracted bodies of pasted attachments
// are ~98% of it. Attachments are the one that looks like a loss and is not —
// a pasted document is a file, and what the person SAID about it is the part
// that carries motive. Files are a separate, unbuilt capability, and quietly
// folding their contents in here would ship it by accident and badly.

import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { ZipError } from './zip.js';
import { openArchive, readConversations } from './archive.js';

export const CONVERSATIONS = 'conversations.json';
export const MEMORIES = 'memories.json';

const isProjectEntry = (n) => n.startsWith('projects/') && n.endsWith('.json');
const isDesignChat = (n) => n.startsWith('design_chats/') && n.endsWith('.json');

/** Text a person or the assistant actually said, with everything else removed. */
function spoken(blocks, fallback) {
  const out = (Array.isArray(blocks) ? blocks : [])
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
  // `text` mirrors the text blocks and is the only field older exports carry.
  // Falling back to it is not a guess: it is the same content, flattened.
  return out || String(fallback || '').trim();
}

/**
 * One conversation, in the same shape a transcript reader returns.
 *
 * Message order is `created_at`, not the `parent_message_uuid` tree. Edited
 * conversations branch, and on a measured export 6 of 93 did, contributing 28
 * extra messages out of 3,220 — under 1%. Walking to a single leaf would drop
 * whichever branch was not chosen, and a person's abandoned line of thought is
 * exactly the material this brain is for. Duplication is the cheaper error.
 */
function toSession(conv, source) {
  const messages = [...(conv.chat_messages || [])].sort((a, b) =>
    String(a.created_at || '').localeCompare(String(b.created_at || '')),
  );

  const turns = [];
  let attachments = 0;
  for (const m of messages) {
    attachments += (m.attachments || []).length;
    const text = spoken(m.content, m.text);
    if (!text) continue;
    turns.push({
      role: m.sender === 'human' ? 'user' : 'assistant',
      text,
      at: m.created_at,
    });
  }

  const chars = turns.reduce((n, t) => n + t.text.length, 0);
  return {
    // Synthetic, and stable across exports: the conversation's own uuid is the
    // identity, so the same chat in two different export zips is one thing.
    path: `claude.ai:${conv.uuid}`,
    id: conv.uuid,
    cwd: null,
    project: conv.name || 'untitled chat',
    surface: 'claude.ai',
    startedAt: conv.created_at,
    endedAt: conv.updated_at,
    updatedAt: conv.updated_at,
    turns,
    chars,
    attachments,
    // No byte offset exists for a web chat: a conversation is not append-only
    // and an export is a snapshot. `updatedAt` is the resumption key instead.
    rawBytes: 0,
    readTo: chars,
    source,
  };
}

/** A design chat wears a different field name for the same thing. */
function designToSession(chat, source) {
  const messages = [...(chat.messages || [])].sort((a, b) =>
    String(a.created_at || '').localeCompare(String(b.created_at || '')),
  );
  const turns = [];
  for (const m of messages) {
    const text = spoken(m.content, m.text);
    if (!text) continue;
    turns.push({ role: m.role === 'assistant' ? 'assistant' : 'user', text, at: m.created_at });
  }
  const chars = turns.reduce((n, t) => n + t.text.length, 0);
  return {
    path: `claude.ai:${chat.uuid}`,
    id: chat.uuid,
    cwd: null,
    project: chat.title || chat.project?.name || 'design chat',
    surface: 'claude.ai',
    startedAt: chat.created_at,
    endedAt: chat.updated_at,
    updatedAt: chat.updated_at,
    turns,
    chars,
    attachments: 0,
    rawBytes: 0,
    readTo: chars,
    source,
  };
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * Standing context: what claude.ai already knows about this person, and what
 * they told it about each project.
 *
 * This is not conversation and must not be batched as if it were. It is small,
 * it is already distilled, and it belongs in front of the first batch rather
 * than in the queue behind a year of chat.
 *
 * Project *docs* are deliberately listed and not included. A doc is a file, the
 * product does not ingest files yet, and inlining 18 KB of attached document
 * here would ship that capability by accident, unmeasured, through a side door.
 */
function readStanding(zip) {
  const out = { memory: null, projectMemories: [], projects: [], docs: 0 };

  if (zip.has(MEMORIES)) {
    const mem = parse(zip.read(MEMORIES));
    const record = Array.isArray(mem) ? mem[0] : mem;
    if (record) {
      if (typeof record.conversations_memory === 'string' && record.conversations_memory.trim()) {
        out.memory = record.conversations_memory.trim();
      }
      for (const [id, text] of Object.entries(record.project_memories || {})) {
        if (typeof text === 'string' && text.trim()) {
          out.projectMemories.push({ id, text: text.trim() });
        }
      }
    }
  }

  for (const name of zip.names().filter(isProjectEntry)) {
    const p = parse(zip.read(name));
    if (!p) continue;
    const docs = p.docs || [];
    out.docs += docs.length;
    out.projects.push({
      id: p.uuid,
      name: p.name || basename(name, '.json'),
      description: (p.description || '').trim(),
      instructions: (p.prompt_template || '').trim(),
      docs: docs.map((d) => ({ filename: d.filename, chars: (d.content || '').length })),
      createdAt: p.created_at,
    });
  }

  return out;
}

/**
 * Everything readable in one export zip.
 *
 * Never throws for a bad archive: a corrupt or half-downloaded export is a
 * thing that happens to users, and the right response is to name it in the
 * output and carry on with the rest of the sync — not to take the whole command
 * down with a stack trace.
 */
export function readExport(path) {
  let zip;
  try {
    zip = openArchive(path);
  } catch (e) {
    return {
      path,
      ok: false,
      error: e instanceof ZipError ? e.message : String(e.message || e),
      sessions: [],
      standing: null,
    };
  }

  try {
    const sessions = [];
    let skippedEmpty = 0;
    // Conversations that HAVE messages and no words in any of them. This is a
    // different fact from "an empty chat", it is common, and it is the one thing
    // in this file a person can act on — so it is counted separately instead of
    // being folded into a skip count that reads like housekeeping. See
    // `emptyBodies` below.
    const hollow = [];

    // `conversations.json`, or the numbered parts it can arrive in. Anthropic
    // splits a large account across numbered ZIPS, which this file already
    // handled; nothing handled numbered FILES, which is how the same split
    // looks once an export is unpacked, and how OpenAI ships it either way.
    // One rule covers both now, and the error names the part that failed.
    const read = readConversations(zip);
    if (!read.ok && read.reason !== 'missing') {
      return {
        path,
        ok: false,
        error:
          read.reason === 'invalid'
            ? `${read.part} is not valid JSON (${read.detail})`
            : `${read.part} is not a list of conversations — the export may be from a format we have not seen`,
        sessions: [],
        standing: null,
      };
    }
    if (read.ok) {
      for (const c of read.conversations) {
        const s = toSession(c, path);
        if (s.turns.length === 0) {
          skippedEmpty += 1;
          if ((c.chat_messages || []).length > 0) {
            hollow.push({ at: c.updated_at || c.created_at, messages: c.chat_messages.length });
          }
        } else sessions.push(s);
      }
    }

    for (const name of zip.names().filter(isDesignChat)) {
      const chat = parse(zip.read(name));
      if (!chat) continue;
      const s = designToSession(chat, path);
      if (s.turns.length === 0) skippedEmpty += 1;
      else sessions.push(s);
    }

    const standing = readStanding(zip);

    let size = 0;
    try {
      size = statSync(path).size;
    } catch {}

    const dates = hollow.map((h) => h.at).filter(Boolean).sort();
    return {
      path,
      ok: true,
      error: null,
      sessions,
      standing,
      skippedEmpty,
      emptyBodies: hollow.length
        ? { count: hollow.length, from: dates[0] || null, to: dates[dates.length - 1] || null }
        : null,
      zipBytes: size,
    };
  } catch (e) {
    return {
      path,
      ok: false,
      error: e instanceof ZipError ? e.message : String(e.message || e),
      sessions: [],
      standing: null,
    };
  } finally {
    zip.close();
  }
}

/**
 * Every export on the machine, read as ONE corpus.
 *
 * Exports overlap by design: each one is a full snapshot, and Anthropic splits
 * large accounts into `batch-0000`, `batch-0001` and so on. Someone who has
 * requested an export twice has every old conversation in both files. Keyed by
 * the conversation's own uuid, with the newest zip winning, that is a
 * non-event; keyed by anything else it silently triples a person's brain and
 * every page gets written from three copies of the same chat.
 */
export function readExports(paths) {
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
  const standings = [];
  const failed = [];
  const hollow = [];
  let duplicates = 0;
  let skippedEmpty = 0;

  for (const p of ordered) {
    const r = readExport(p);
    if (!r.ok) {
      failed.push({ path: p, error: r.error });
      continue;
    }
    skippedEmpty += r.skippedEmpty || 0;
    if (r.emptyBodies) hollow.push(r.emptyBodies);
    for (const s of r.sessions) {
      if (byId.has(s.id)) {
        duplicates += 1;
        continue; // the newer zip already provided it
      }
      byId.set(s.id, s);
    }
    if (r.standing) standings.push({ path: p, ...r.standing });
  }

  const dates = hollow.flatMap((h) => [h.from, h.to]).filter(Boolean).sort();
  return {
    sessions: [...byId.values()],
    // Newest export wins here too: standing context is a snapshot of a
    // person's current setup, not a history of it.
    standing: standings[0] || null,
    exports: ordered.length,
    failed,
    duplicates,
    skippedEmpty,
    /**
     * Conversations the export listed and did not fill in.
     *
     * Found on the first real export this reader was pointed at: 66 of 93 chats
     * arrived with messages, no title, no summary and not one word of text —
     * every one of them older than the 27 that were intact. The file was named
     * `batch-0000`. Anthropic splits a large account across numbered zips, and
     * only the first had been downloaded.
     *
     * Nothing about that is an error, which is the danger: the conversations
     * are present, the count looks right, and the sync would have reported
     * them as "nothing said in them" and moved the cutoff past four months of
     * someone's life. It is reported instead, because it is the rare finding
     * the person can actually do something about.
     */
    emptyBodies: hollow.length
      ? {
          count: hollow.reduce((n, h) => n + h.count, 0),
          from: dates[0] || null,
          to: dates[dates.length - 1] || null,
        }
      : null,
  };
}

/**
 * Standing context as a page the agent reads before the first batch.
 *
 * Returns null when there is nothing in it, so an export without memories
 * produces no file rather than an empty one that reads like a bug.
 */
export function renderStanding(standing) {
  if (!standing) return null;
  const hasMemory = !!standing.memory;
  const hasProjects = standing.projects.some((p) => p.description || p.instructions);
  const hasProjectMemory = standing.projectMemories.length > 0;
  if (!hasMemory && !hasProjects && !hasProjectMemory) return null;

  const out = [
    '# What claude.ai already knows',
    '',
    'This is not conversation. It is the standing context out of the export —',
    'the memory claude.ai keeps about this person, and the instructions they',
    'wrote for their own projects. It is already distilled, so it is the best',
    'material in the archive per byte.',
    '',
    '**Read this before the batch.** It says who the person is and what they are',
    'working on, which is what makes the conversations legible.',
    '',
  ];

  if (hasMemory) {
    // The heading names the source. claude.ai keeps a memory it wrote itself;
    // ChatGPT carries custom instructions the person wrote. Calling both
    // "memory" would tell the reader something untrue about where it came from.
    out.push(`## ${standing.memoryLabel || 'Memory across conversations'}`, '', standing.memory, '');
  }

  const named = new Map(standing.projects.map((p) => [p.id, p.name]));
  if (hasProjectMemory) {
    out.push('## Memory, per project', '');
    for (const pm of standing.projectMemories) {
      out.push(`### ${named.get(pm.id) || pm.id}`, '', pm.text, '');
    }
  }

  if (hasProjects) {
    out.push('## Projects, in their own words', '');
    for (const p of standing.projects) {
      if (!p.description && !p.instructions) continue;
      out.push(`### ${p.name}`, '');
      if (p.description) out.push(p.description, '');
      if (p.instructions) out.push('**Instructions they set:**', '', p.instructions, '');
      if (p.docs.length) {
        out.push(
          `*${p.docs.length} attached document${p.docs.length === 1 ? '' : 's'} not read: ` +
            p.docs.map((d) => d.filename).join(', ') +
            '. Files are not ingested yet.*',
          '',
        );
      }
    }
  }

  return out.join('\n');
}
