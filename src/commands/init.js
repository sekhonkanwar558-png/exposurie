// `exposurie init` — the one line a user types into a session they already have.
//
// It does NOT scaffold. It reports what is on the machine and hands back an
// ordered task list, because the chain is tool -> agent -> human: the agent is
// what acts, and the agent is what talks to the person. Nothing here waits for
// input, and the human step is never a gate.

import { detect, tilde } from '../context.js';
import { installState, INSTALL } from '../install.js';
import { unresolved, mirror, stepCtx } from '../pending.js';
import { block, planBlock, wrap } from '../output.js';
import { OK, HUMAN } from '../exit-codes.js';
import { DEFAULT_VAULT, expandPath, vaultState } from '../vault.js';
import { ZipError } from '../extract/zip.js';
import { openArchive, readConversations } from '../extract/archive.js';
import { MEMORIES } from '../extract/webchat.js';

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
    zip = openArchive(newest.path);
    // Across every numbered part, and out of a folder as readily as out of a
    // zip. Counting only a literal `conversations.json` at the root is what let
    // this command report an export it had correctly found as holding nothing.
    const read = readConversations(zip);
    const all = read.ok ? read.conversations : [];
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
  // `detect()`, not `detect({ at })`, and that is deliberate rather than the
  // dropped-flag bug it resembles. Everywhere else `--at` outranks the pointer
  // because it names the brain to ACT on. Here and in `scaffold` the question is
  // the other one -- which brain already EXISTS -- and one brain per person is
  // enforced against the pointer, not against a flag. So an existing brain wins
  // below: reporting a plan for somewhere else would print a plan that
  // `scaffold` then refuses, and init's whole job is to be the plan that works.
  const d = detect();
  const install = installState();
  const vault = d.vault || expandPath(at) || DEFAULT_VAULT;

  const rows = [];
  // Reported before anything else because it decides whether the rest of this
  // survives the session. Everything below assumes a command named `exposurie`
  // exists tomorrow; under npx it does not, and the pointer scaffold writes
  // would name nothing.
  // Two different ways to have no command, and they are not the same sentence.
  // Telling a developer running from a checkout that they are "in an npx cache"
  // is being confidently wrong about their own machine — the exact failure this
  // whole pass is about, reintroduced in the fix for it.
  rows.push([
    'exposurie',
    install.permanent
      ? `installed  (${tilde(install.binary)})`
      : install.npx
        ? 'NOT INSTALLED — running from a temporary npx cache, gone after this run'
        : 'NOT INSTALLED — no exposurie command on this PATH',
  ]);
  rows.push([
    'brain',
    d.configError
      ? `UNKNOWN — pointer unreadable (${d.configError.reason})`
      : d.vault
        ? tilde(d.vault)
        : `not created  (will go at ${tilde(vault)})`,
  ]);

  // The share is printed, not just held. Three clients were once listed here as
  // bare counts — 6, 165, 11 — and read downstream as three equally present
  // things, which is how a machine that is 91% Codex got asked three Claude
  // questions. The number that decides is the one on the page.
  //
  // Only when it says something: a single client is always 100%, and a row
  // asserting that is noise dressed as information.
  const counted = d.clients.filter((c) => c.present && c.readable && c.count > 0);
  const corpus = counted.reduce((n, c) => n + c.count, 0);
  const showShare = counted.length > 1 && corpus > 0;

  for (const c of d.clients) {
    if (!c.present) continue;
    const where = tilde(c.root);
    const share = showShare && c.readable ? ` · ${Math.round((c.count / corpus) * 100)}%` : '';
    rows.push([
      c.name.toLowerCase().replace(/\s+/g, '-'),
      c.readable
        ? `${c.count} session${c.count === 1 ? '' : 's'}${share}   (${where})`
        : `${c.count} found, NO READER YET — will be skipped   (${where})`,
    ]);
  }

  // Detection decides what is still owed, so a step cannot be falsely closed.
  const ctx = stepCtx(d);
  const open = unresolved(ctx, ['claude-code-retention', 'claude-web-export', 'chatgpt-web-export', 'obsidian']);

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
  // FIRST, and before scaffold on purpose. scaffold writes a pointer into every
  // client's global instructions naming the command that reads the brain — so
  // the command has to be one that still exists tomorrow. Under npx it is not:
  // the package sits in a temp cache, `exposurie` is not on PATH, and the
  // pointer would name nothing. That failed silently for a whole release, in
  // the one file paid for on every message forever.
  if (!install.permanent) {
    steps.push({
      run: INSTALL,
      note:
        (install.npx
          ? `You are running from a temporary npx cache, which leaves no command behind. `
          : `There is no exposurie command on this PATH. `) +
        `Install it before scaffolding: the brain is reached from every project ` +
        `through a one-line pointer that names this command, and retrieval is ` +
        `the whole product. This is the only install step, and ` +
        `\`exposurie uninstall\` reverses all of it.`,
    });
  }
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
        `Stages a batch of conversation — from this machine and from any chat ` +
        `export you have, newest first — and hands it back for you to fold into ` +
        `pages. THIS REPEATS. One batch is bounded so it fits in your context, ` +
        `not because the history is; the first run reads all of it, batch after ` +
        `batch, until nothing is waiting. Each batch tells you what is left. ` +
        `Keep going without asking — that is what building the brain is.`,
    });
  }
  for (const p of open) {
    steps.push({ ask: p.ask });
  }

  // Mirror to disk only once there is a vault to mirror into; until then the
  // step rides the output, which is the only surface that exists.
  //
  // Both directions, in one call. Writing the open ones was wired up from the
  // start and removing the finished ones never was, so a user who did the thing
  // kept a file telling them to do the thing.
  mirror(d.vault, open);

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
    'SCOPE',
    ...wrap(
      'Conversation is read directly — Claude Code, Codex and Cursor on this ' +
        'machine, plus claude.ai and ChatGPT chats from an export. Files dropped ' +
        'in raw/ are FOUND and handed to you to open; exposurie never parses a ' +
        'document itself, so a PDF becomes a page only because you read it. ' +
        'Documents attached to a claude.ai Project are listed but not fetched. ' +
        'A ChatGPT export that cannot be parsed is reported as a parse failure ' +
        'by name, never as an empty account. opencode, Gemini ' +
        'CLI, Windsurf and Aider are not read. Do not invent a command for any ' +
        'of that.',
      74,
      '  ',
    ),
  ];

  return {
    code: open.length ? HUMAN : OK,
    state: vaultState(d.vault, 'init'),
    // The PLANNED vault, not just the existing one. A step rendered by `init`
    // runs before any brain exists, so `d.vault` is null and every step that
    // names the path had nothing to name. The plan directly above says where
    // scaffold will put it, and steps are explicitly non-blocking — so by the
    // time anyone answers one of these, that folder is real. Falling back to
    // the planned path is the only way this reads as one coherent setup rather
    // than two commands that disagree about where the brain is.
    pending: open.map((s) => ({ ...s, ctx: { vault: d.vault || vault, settings: d.retention?.path } })),
    body: [
      ...block('STATE', rows),
      ...(steps.length ? ['', ...planBlock(steps)] : []),
      ...frontier,
    ],
    json: {
      brain: d.vault,
      plannedVault: vault,
      install: { permanent: install.permanent, npx: install.npx, invocation: install.invocation },
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
