// `exposurie init` — the one line a user types into a session they already have.
//
// It does NOT scaffold. It reports what is on the machine and hands back an
// ordered task list, because the chain is tool -> agent -> human: the agent is
// what acts, and the agent is what talks to the person. Nothing here waits for
// input, and the human step is never a gate.

import { detect, tilde } from '../context.js';
import { unresolved, record } from '../pending.js';
import { block, planBlock, wrap } from '../output.js';
import { OK, HUMAN } from '../exit-codes.js';
import { DEFAULT_VAULT, expandPath, vaultState } from '../vault.js';
import { openZip, ZipError } from '../extract/zip.js';
import { CONVERSATIONS, MEMORIES } from '../extract/webchat.js';

/**
 * How much is actually in the export, without folding any of it in.
 *
 * Only `conversations.json` is inflated, and only to count the list — the whole
 * archive is never expanded. An export that will not open is reported by name
 * here rather than at sync time, because this is where a person is still
 * standing next to the download and can just request it again.
 */
function countExport(exports) {
  const newest = [...exports].sort((a, b) => b.size - a.size)[0];
  let zip;
  try {
    zip = openZip(newest.path);
    const list = zip.has(CONVERSATIONS) ? JSON.parse(zip.read(CONVERSATIONS)) : [];
    const all = Array.isArray(list) ? list : [];
    // A conversation the export listed but did not fill in. Counted here so the
    // very first command can say a split export is short, which is when the
    // person is still standing next to the download email.
    //
    // The count beside it is of conversations that will ACTUALLY be read, not
    // of rows in the file. Those are different numbers — an account collects
    // chats that were opened and never used — and printing the larger one here
    // would have this command promise 27 where sync then reports 21.
    const hasWords = (c) =>
      (c.chat_messages || []).some((m) => (m.content || []).length || String(m.text || '').trim());
    const hollow = all.filter((c) => (c.chat_messages || []).length > 0 && !hasWords(c)).length;
    return {
      conversations: all.filter(hasWords).length,
      hollow,
      memory: zip.has(MEMORIES),
      error: null,
    };
  } catch (e) {
    return {
      conversations: 0,
      hollow: 0,
      memory: false,
      error: e instanceof ZipError ? e.message : String(e.message || e),
    };
  } finally {
    if (zip) zip.close();
  }
}

export function init({ at } = {}) {
  const d = detect();
  const vault = d.vault || expandPath(at) || DEFAULT_VAULT;

  const rows = [];
  rows.push([
    'brain',
    d.configError
      ? `UNKNOWN — pointer unreadable (${d.configError.reason})`
      : d.vault
        ? tilde(d.vault)
        : `not created  (will go at ${tilde(vault)})`,
  ]);

  for (const c of d.clients) {
    if (!c.present) continue;
    const where = tilde(c.root);
    rows.push([
      c.name.toLowerCase().replace(/\s+/g, '-'),
      c.readable
        ? `${c.count} session${c.count === 1 ? '' : 's'}   (${where})`
        : `${c.count} found, NO READER YET — will be skipped   (${where})`,
    ]);
  }

  // Detection decides what is still owed, so a step cannot be falsely closed.
  const ctx = { exports: d.exports, obsidianInstalled: d.obsidianInstalled, clients: d.clients, chatgptExports: d.chatgptExports };
  const open = unresolved(ctx, ['claude-web-export', 'chatgpt-web-export', 'obsidian']);

  // Counted, not just detected. "1 export found" and "93 conversations, ready"
  // are the same fact, and only one of them tells a person their own life is
  // about to be read. This is the one command that can afford the read: it is
  // typed once, and every other command gets the count from sync's own pass.
  const web = d.exports.length ? countExport(d.exports) : null;
  const wantsClaude = open.some((p) => p.id === 'claude-web-export');
  const wantsGpt = open.some((p) => p.id === 'chatgpt-web-export');
  rows.push([
    'claude.ai chats',
    web
      ? web.error
        ? `export found but UNREADABLE — ${web.error}`
        : `${web.conversations} conversation${web.conversations === 1 ? '' : 's'}` +
          `${web.memory ? ', plus what claude.ai remembers about you' : ''}   (${tilde(d.exports[0].path)})`
      : wantsClaude
        ? 'no export yet — the step below gets it'
        : 'none, and not asked for — nothing here suggests a Claude account',
  ]);
  // Only shown to somebody it could apply to. A Claude Code user does not need
  // a row telling them they have no ChatGPT export.
  if (d.chatgptExports.length || wantsGpt) {
    rows.push([
      'chatgpt chats',
      d.chatgptExports.length
        ? `export found   (${tilde(d.chatgptExports[0].path)})`
        : 'no export yet — the step below gets it',
    ]);
  }
  if (web && !web.error && web.hollow > 0) {
    rows.push([
      '',
      `${web.hollow} more listed with no text — the export is split across ` +
        `numbered zips and only one is here`,
    ]);
  }

  const steps = [];
  // Never offer scaffold while the pointer is broken: it is the one command
  // that would act on the wrong answer and orphan an existing brain.
  if (d.configError) {
    steps.push({
      read: d.configError.path,
      note:
        `This file names the brain and is not valid JSON, so exposurie cannot ` +
        `tell whether a brain exists. Repair it — it holds {"vault": "<path>"} — ` +
        `and nothing else here is affected.`,
    });
  }
  if (!d.vault && !d.configError) {
    steps.push({
      run: `exposurie scaffold --at ${tilde(vault)}`,
      note:
        `Creates the brain and copies in the schema, the page templates and the ` +
        `prompt that writes pages — those become the user's, and are never ` +
        `overwritten. Writes nothing else and reads no transcripts.`,
    });
  }
  // The export counts as material. Gating this on local sessions alone was the
  // bug that mattered most: someone who has only ever used claude.ai has 0
  // sessions and a full life in that zip, and the tool told them there was
  // nothing to do.
  if (d.vault && (d.sessions > 0 || (web && !web.error && web.conversations > 0))) {
    steps.push({
      run: 'exposurie sync',
      note:
        `Stages a batch of conversation — from this machine and from your claude.ai ` +
        `export together, newest first — and hands it back for you to fold into ` +
        `pages. It is resumable, so this can be run as many times as it takes.`,
    });
  }
  for (const p of open) {
    steps.push({ ask: p.ask });
  }

  // Mirror to disk only once there is a vault to mirror into; until then the
  // step rides the output, which is the only surface that exists.
  if (d.vault) for (const p of open) record(d.vault, p);

  // Saying where the build actually stops, rather than naming a command that
  // does not exist yet. An agent handed a plan whose steps fail learns that the
  // plan is not worth following — and that lesson is not undone by shipping the
  // command later.
  //
  // It rots the other way too, which is what happened: this block went on
  // denying `read` and the client pointer for a whole release after both
  // shipped, while `scaffold` printed the REACH table three lines below it.
  // Denying a capability we have is the same lie as promising one we lack, so
  // a test now pins this text against the command table.
  const frontier = [
    '',
    'NOT IN THIS VERSION',
    ...wrap(
      'Only conversation is read — Claude Code, Codex and Cursor on this machine, ' +
        'plus claude.ai and ChatGPT chats from an export. Files are not: notes, ' +
        'documents and PDFs dropped into the brain are stored and linked rather ' +
        'than ingested, and documents attached to a claude.ai Project are listed ' +
        'but not opened. The ChatGPT reader has never met a real export, so it ' +
        'reports a parse it cannot do instead of pretending the account is empty. ' +
        'opencode, Gemini CLI, Windsurf and Aider are not read. Do not invent a ' +
        'command for any of that.',
      74,
      '  ',
    ),
  ];

  return {
    code: open.length ? HUMAN : OK,
    state: vaultState(d.vault, 'init'),
    pending: open.map((s) => ({ ...s, ctx: { vault: d.vault } })),
    body: [
      ...block('STATE', rows),
      ...(steps.length ? ['', ...planBlock(steps)] : []),
      ...frontier,
    ],
    json: {
      brain: d.vault,
      plannedVault: vault,
      sessions: d.sessions,
      clients: d.clients.map((c) => ({ id: c.id, present: c.present, count: c.count, readable: c.readable })),
      exports: d.exports.map((e) => e.path),
      webChats: web ? web.conversations : 0,
      webChatsWithoutText: web ? web.hollow : 0,
      webExportError: web ? web.error : null,
      obsidian: d.obsidianInstalled,
      pending: open.map((p) => p.id),
    },
  };
}
