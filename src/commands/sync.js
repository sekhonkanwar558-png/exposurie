// `exposurie sync` — find what is new, stage it, and never lose it.
//
// Sync is deliberately two halves. The deterministic half is here: find what is
// new, apply the exclusion gate, read conversation out of the transcripts, and
// write a batch. The other half — folding it into pages — is an LLM job, and it
// lives as a procedure file in the brain, so no client's skill format is
// load-bearing and the user can change how their own brain gets written.
//
// Three properties this has to have, and each is a decision:
//
//   NEWEST FIRST, AND RESUMABLE. History is not truncated, because "we only
//   read the last 30 days" is a quality compromise. Instead it is ORDERED, in
//   bounded batches, with the remainder reported. The first run costs the user
//   real quota on their own plan, and one long unbounded job at minute one —
//   before they have any reason to trust this — is how a tool gets uninstalled.
//
//   THE CUTOFF MOVES LAST. It is the only record of what has been read, so
//   advancing it before the pages exist turns an interrupted sync into
//   permanent, silent data loss.
//
//   AND IT MOVES ON EVIDENCE, NOT ON A CLAIM. `--done` checks that the brain
//   actually changed. Nobody ticks a box, and an agent cannot close a batch by
//   assuming it worked.
//
// AND IT CURATES, EVERY TIME. This is the one command a person types after
// setup, so everything that makes the brain better lives inside it rather than
// beside it. Curation is not a phase that starts once the brain is a mess — by
// then the mess IS the brain — so it runs from the very first batch onward, on
// exactly one path per invocation: after `--done`, when pages have just been
// written, and on the nothing-new path, so that typing the command when there
// is no new material still leaves the brain better than it found it.

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import { join, basename } from 'node:path';

import { detect, brokenConfig } from '../context.js';
import { block, planBlock, wrap } from '../output.js';
import { OK, ERROR } from '../exit-codes.js';
import { describe } from '../extract/transcript.js';
import { readExports, renderStanding } from '../extract/webchat.js';
import { readChatGptExports } from '../extract/chatgpt.js';
import { redact } from '../extract/redact.js';
import { conversationExcluded } from '../extract/exclude.js';
import { curate, report } from '../curate.js';
import { readSeam, readState, statePath, vaultState, categoryDirs } from '../vault.js';

const DEFAULT_BATCH_CHARS = 120000;

const stagedDir = (vault) => join(vault, '.exposurie', 'staged');
const iso = () => new Date().toISOString();
const stamp = () => iso().replace(/[:.]/g, '-').slice(0, 19);

function writeState(vault, state) {
  mkdirSync(join(vault, '.exposurie'), { recursive: true });
  writeFileSync(statePath(vault), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * The working directory of a session, without reading the session.
 *
 * Exclusion is a gate: a conversation the user excluded must not be loaded at
 * all. User and assistant lines carry `cwd`, so the head of the file answers it
 * and an excluded transcript is never read past its first few KB.
 */
function peekCwd(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(65536);
    const n = readSync(fd, buf, 0, buf.length, 0);
    // NOT just the first line. A transcript opens with mode/system lines that
    // carry no `cwd`, so reading one line makes exclusion silently never fire —
    // the user sets a denylist, nothing is excluded, and nothing says so.
    for (const line of buf.toString('utf8', 0, n).split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o.cwd) return o.cwd;
      } catch {
        // a line split by the read boundary; keep looking
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

/** Newest activity in the brain's pages, so "did the writing happen" is answerable. */
function newestPageWrite(vault, seam) {
  let newest = 0;
  const walk = (d) => {
    if (!existsSync(d)) return;
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) {
        try {
          newest = Math.max(newest, statSync(p).mtimeMs);
        } catch {}
      }
    }
  };
  for (const d of categoryDirs(vault, seam)) walk(d);
  for (const f of ['index.md', 'log.md']) {
    const p = join(vault, f);
    if (existsSync(p)) {
      try {
        newest = Math.max(newest, statSync(p).mtimeMs);
      } catch {}
    }
  }
  return newest;
}

/**
 * The curator, run as a stage of this command rather than as a command.
 *
 * It applies the two lossless fixes without asking — bumping a date git proves
 * is wrong, and wrapping a first plain mention in brackets — and reports
 * everything that needs a judgement. Both halves of that were asked for at once
 * and pull against each other productively: lossless, and unattended.
 *
 * The subtlety is in what our own edits mean to the cutoff. `--done` advances
 * only when the brain changed since the batch was staged, which is how an
 * interrupted sync re-stages rather than losing material. A date the curator
 * bumped is a change to the brain that is NOT the pages being written, so it
 * would forge exactly that evidence — and a batch would be marked read that
 * nothing ever read. So when a batch is pending, the watermark moves with our
 * own edits and the evidence check keeps meaning what it says.
 */
function curateStage(vault, seam) {
  const result = curate(vault, seam, { fix: true });
  if (result.fixed.length) {
    const state = readState(vault) || {};
    if (state.pendingBatch) {
      writeState(vault, {
        ...state,
        pendingBatch: { ...state.pendingBatch, pagesAt: newestPageWrite(vault, seam) },
      });
    }
  }
  return {
    body: report(result, vault),
    json: {
      pages: result.pages,
      links: result.links,
      fixed: result.fixed,
      broken: result.broken,
      notice: result.notice,
      retired: result.suppressed,
    },
  };
}

const noBrain = () => ({
  code: ERROR,
  state: { vault: null, self: 'sync' },
  error: {
    message: 'There is no brain on this machine yet, so there is nowhere to put anything.',
    fix: 'RUN: exposurie scaffold',
  },
});

// --------------------------------------------------------------------- stage
function stage(vault, d) {
  const seam = readSeam(vault) || {};
  const state = readState(vault) || { files: {} };
  const seen = state.files || {};
  const budget = seam.guards?.batchChars || DEFAULT_BATCH_CHARS;

  // Candidates: readable clients only, and only transcripts with unread bytes.
  const candidates = [];
  for (const c of d.clients) {
    if (!c.readable || !c.present) continue;
    for (const f of c.files) {
      let size;
      try {
        size = statSync(f).size;
      } catch {
        continue;
      }
      const from = seen[f]?.bytes ?? 0;
      if (size <= from) continue;
      candidates.push({
        kind: 'transcript',
        path: f,
        client: c.id,
        // The reader comes from the client table rather than being assumed, so
        // a rollout is never handed to a parser written for another format.
        read: c.read,
        size,
        from,
        sortAt: statSync(f).mtimeMs,
      });
    }
  }

  // The claude.ai export, which is the other half of a person — and for most
  // people the larger half. Measured on one real account: 264 KB of their own
  // words on the web against 166 KB across every local session. Somebody who
  // has never opened a terminal has the first number and a zero.
  //
  // It is read here rather than by a command of its own because it is the same
  // job: material in, conversation out. A second command would also be a second
  // thing to remember, and forgetting is what this product is against.
  //
  // ONE HONEST DIFFERENCE from a transcript, and it is a property of zips
  // rather than a decision: a conversation's title cannot be known without
  // decompressing the single file that holds every conversation, so the
  // exclusion gate cannot run before the read the way it does for transcripts.
  // It still runs before anything is staged, redacted, or written to disk.
  const claude = readExports(d.exports.map((e) => e.path));
  const gpt = readChatGptExports((d.chatgptExports || []).map((e) => e.path));
  // One list. Which service a conversation came from decides nothing after this
  // point — it is all somebody talking, and the brain does not have a Claude
  // half and an OpenAI half.
  const web = {
    sessions: [...claude.sessions, ...gpt.sessions],
    standing: claude.standing || gpt.standing,
    exports: claude.exports + gpt.exports,
    failed: [
      ...claude.failed,
      ...gpt.failed,
      // Archives that never even opened, so no reader ever saw them.
      ...(d.brokenExports || []).map((e) => ({ path: e.path, error: e.error })),
    ],
    duplicates: claude.duplicates + gpt.duplicates,
    skippedEmpty: claude.skippedEmpty + gpt.skippedEmpty,
    emptyBodies: claude.emptyBodies,
  };
  for (const s of web.sessions) {
    const prior = seen[s.path];
    // A web chat has no byte offset — an export is a snapshot, not an
    // append-only file — so `updated_at` is the resumption key. Unchanged since
    // the last read means skip it whole rather than stage it twice.
    if (prior && prior.updatedAt && prior.updatedAt === s.updatedAt) continue;
    candidates.push({
      kind: 'webchat',
      path: s.path,
      client: 'claude.ai',
      session: s,
      sortAt: Date.parse(s.updatedAt || s.endedAt || '') || 0,
    });
  }

  // Newest first, across both sources: recent context is what makes older
  // material legible, and a sync that stops early then leaves a useful brain
  // rather than an ancient one.
  candidates.sort((a, b) => b.sortAt - a.sortAt);

  // The gate runs over everything first, not inside the batching loop. It is a
  // policy about what may be opened at all, so it cannot depend on where a
  // batch happens to stop — and "still waiting" would otherwise count sessions
  // that are never going to be read.
  const included = [];
  const excluded = [];
  const eligible = [];
  for (const cand of candidates) {
    const identity =
      cand.kind === 'webchat'
        ? { cwd: null, title: cand.session.project }
        : { cwd: peekCwd(cand.path) };
    const hit = conversationExcluded(identity, seam);
    if (hit) excluded.push({ path: cand.path, why: hit });
    else eligible.push(cand);
  }

  const empty = [];
  let chars = 0;
  let redactions = {};

  for (const cand of eligible) {
    const s = cand.kind === 'webchat' ? cand.session : cand.read(cand.path, cand.from);
    if (!s || s.turns.length === 0) {
      // Nothing said in it. Real: 16 of 127 sessions on a measured corpus, and
      // 6 of 93 conversations on a measured export.
      empty.push({
        path: cand.path,
        readTo: cand.kind === 'webchat' ? (s ? s.readTo : 0) : cand.size,
        updatedAt: cand.kind === 'webchat' ? cand.session.updatedAt : undefined,
      });
      continue;
    }

    // Whole sessions only — half a conversation is worse than none, because the
    // half that explains why is usually the half that gets cut. So a session
    // that would blow the budget is left for a batch of its own, and the first
    // session always goes in, or a brain with one enormous session never
    // progresses.
    //
    // It SKIPS rather than stops, and that difference is worth the line: with a
    // stop, one short conversation at the top of the list ends the batch, and a
    // person with a year of history gets a first run holding a single 2,900
    // character chat. That happened on the first real export this was pointed
    // at. Order is still newest-first; what changes is that a big session
    // defers itself instead of ending everyone else's turn.
    if (included.length > 0 && chars + s.chars > budget) continue;

    const r = redact(s.turns.map((t) => t.text).join('\n'));
    if (r.count) {
      for (const [k, n] of Object.entries(r.found)) redactions[k] = (redactions[k] || 0) + n;
      for (const t of s.turns) t.text = redact(t.text).text;
    }

    included.push({ ...s, client: cand.client });
    chars += s.chars;
  }

  if (included.length === 0) {
    const why = eligible.length === 0
      ? (excluded.length ? `Nothing new outside your exclude list, which held back ${excluded.length} session${excluded.length === 1 ? '' : 's'}.` : 'Nothing on this machine has changed since the last sync.')
      : `${eligible.length} transcript${eligible.length === 1 ? '' : 's'} changed, but none held any conversation — ` +
        'they were tool work with nothing said.';

    // An export that would not open has to be reported HERE too, and this is
    // the path where it matters most: when the export is the only material a
    // person has, a failure to read it lands on "nothing has changed since the
    // last sync" — which is not merely unhelpful, it is false. The bug was
    // real, and it is the house failure class exactly: silence that reads as a
    // clean result.
    const trouble = [];
    for (const f of web.failed) {
      trouble.push(['EXPORT UNREADABLE', `${basename(f.path)} — ${f.error}`]);
    }
    if (web.emptyBodies) {
      trouble.push([
        'EXPORT INCOMPLETE',
        `${web.emptyBodies.count} chats listed with no text in them` +
          (web.emptyBodies.from
            ? ` (${web.emptyBodies.from.slice(0, 10)} to ${web.emptyBodies.to.slice(0, 10)})`
            : ''),
      ]);
    }
    // Sessions with nothing in them are still finished with, or they are
    // re-examined forever.
    if (empty.length) {
      const next = { ...state, files: { ...seen } };
      for (const e of empty) {
        next.files[e.path] = { bytes: e.readTo, updatedAt: e.updatedAt, at: iso() };
      }
      next.lastSyncUtc = iso();
      next.unfiled = 0;
      writeState(vault, next);
    }
    // Nothing new is not nothing to do. The brain still drifts — links break
    // when a page is renamed, an index goes out of date, a date lies about
    // freshness — so the one command a person types still curates.
    const c = curateStage(vault, seam);
    return {
      code: OK,
      state: { ...vaultState(vault, 'sync'), unfiled: 0 },
      body: [
        ...block('NOTHING NEW', [['result', 'nothing to stage'], ...trouble]),
        '',
        ...wrap(why, 74, '  '),
        ...(web.failed.length
          ? [
              '',
              ...wrap(
                'That export could not be opened, so nothing was taken from it. This is ' +
                  'usually a download that stopped early — ask them to download it again, ' +
                  'or to request a fresh export. Nothing already in the brain is affected.',
                74,
                '  ',
              ),
            ]
          : []),
        '',
        ...c.body,
      ],
      json: {
        staged: 0,
        candidates: candidates.length,
        excluded: excluded.length,
        empty: empty.length,
        exports: {
          found: web.exports,
          failed: web.failed.map((f) => ({ path: f.path, error: f.error })),
        },
        curate: c.json,
      },
    };
  }

  const id = stamp();
  const dir = join(stagedDir(vault), id);
  mkdirSync(dir, { recursive: true });

  const rows = included.map(describe);
  const rawTotal = included.reduce((n, s) => n + s.rawBytes, 0);
  const remaining = eligible.length - included.length - empty.length;

  // Standing context goes in front of the batch, not into the queue behind it.
  // It is what claude.ai already knows about the person plus the instructions
  // they wrote for their own projects — small, already distilled, and the thing
  // that makes a year of conversation legible on the first read rather than the
  // fifth. Written on every batch, because a batch is read on its own.
  const standingText = renderStanding(web.standing);
  if (standingText) writeFileSync(join(dir, 'standing.md'), standingText, 'utf8');

  writeFileSync(join(dir, 'conversations.md'), renderConversations(id, included), 'utf8');
  writeFileSync(
    join(dir, 'MANIFEST.md'),
    renderManifest(id, rows, { excluded, empty, remaining, chars, rawTotal, redactions, web }),
    'utf8',
  );

  // Recorded, not applied: these offsets become the cutoff only once the pages
  // exist. An abandoned sync must re-stage the same material, not skip it.
  const pending = { id, stagedAt: iso(), files: {}, sessions: included.length };
  for (const s of included) {
    pending.files[s.path] = { bytes: s.readTo, updatedAt: s.updatedAt, at: iso() };
  }
  for (const e of empty) {
    pending.files[e.path] = { bytes: e.readTo, updatedAt: e.updatedAt, at: iso() };
  }
  writeState(vault, {
    ...state,
    files: seen,
    pendingBatch: { ...pending, pagesAt: newestPageWrite(vault, seam) },
    unfiled: remaining,
  });

  const fromWeb = included.filter((s) => s.surface === 'claude.ai' || s.surface === 'chatgpt').length;
  const fromMachine = included.length - fromWeb;

  const summary = [
    ['batch', id],
    ['sessions', `${included.length} staged${remaining > 0 ? `, ${remaining} still waiting` : ''}`],
    // Where a batch came from is not decoration: someone who has only ever used
    // the web should see their own life in this line, not a zero.
    [
      'from',
      // Named, not lumped. "3 from the web" tells somebody nothing about their
      // own setup; "3 from claude.ai" is a fact about them.
      [
        `${fromMachine} on this machine`,
        ...['claude.ai', 'chatgpt']
          .map((svc) => {
            const n = included.filter((s) => s.surface === svc).length;
            return n ? `${n} from ${svc}` : null;
          })
          .filter(Boolean),
      ].join(', '),
    ],
    [
      'conversation',
      `${chars.toLocaleString('en-US')} chars` +
        (rawTotal > 0
          ? `, out of ${(rawTotal / 1048576).toFixed(1)} MB of transcript  (${Math.round(rawTotal / Math.max(chars, 1))}x smaller)`
          : ''),
    ],
  ];
  if (standingText) {
    summary.push([
      'standing',
      `what claude.ai already knows${web.standing?.projects?.length ? `, plus ${web.standing.projects.length} project brief${web.standing.projects.length === 1 ? '' : 's'}` : ''}`,
    ]);
  }
  if (excluded.length) summary.push(['excluded', `${excluded.length} by your exclude list`]);
  if (empty.length) summary.push(['no conversation', `${empty.length} skipped`]);
  if (web.duplicates) {
    summary.push(['already had', `${web.duplicates} chats repeated across your exports`]);
  }
  if (web.emptyBodies) {
    summary.push([
      'EXPORT INCOMPLETE',
      `${web.emptyBodies.count} chats listed with no text in them` +
        (web.emptyBodies.from ? ` (${web.emptyBodies.from.slice(0, 10)} to ${web.emptyBodies.to.slice(0, 10)})` : ''),
    ]);
  }
  if (Object.keys(redactions).length) {
    summary.push(['redacted', Object.entries(redactions).map(([k, n]) => `${n} ${k}`).join(', ')]);
  }
  // An export that would not open is reported here rather than swallowed. A
  // half-downloaded zip is a normal thing to happen to a person, and it is
  // indistinguishable from "you have no web chats" unless we say so.
  for (const f of web.failed) {
    summary.push(['EXPORT UNREADABLE', `${basename(f.path)} — ${f.error}`]);
  }

  return {
    code: OK,
    state: { ...vaultState(vault, 'sync'), unfiled: remaining },
    body: [
      ...block('STAGED', summary),
      '',
      ...planBlock([
        ...(standingText ? [{ read: join(dir, 'standing.md') }] : []),
        { read: join(dir, 'conversations.md') },
        { read: join(vault, '.exposurie', 'wiki-prompt.md') },
        {
          write: 'Fold this batch into the brain, following the prompt above. Update ' +
            'existing pages before creating new ones, then update index.md and ' +
            'append one entry to log.md.',
        },
        { run: 'exposurie sync --done' },
      ]),
      '',
      ...wrap(
        'The last step is what moves the cutoff, and it refuses to move if the brain ' +
          'did not change — so an interrupted sync re-stages this material rather ' +
          'than losing it.',
        74,
        '  ',
      ),
    ],
    json: {
      batch: id,
      dir,
      staged: included.length,
      fromMachine,
      fromWeb,
      remaining,
      chars,
      rawBytes: rawTotal,
      excluded: excluded.length,
      empty: empty.length,
      redactions,
      standing: !!standingText,
      exports: {
        found: web.exports,
        duplicates: web.duplicates,
        failed: web.failed.map((f) => ({ path: f.path, error: f.error })),
      },
    },
  };
}

// ---------------------------------------------------------------------- done
function done(vault) {
  const seam = readSeam(vault) || {};
  const state = readState(vault) || {};
  const batch = state.pendingBatch;

  if (!batch) {
    return {
      code: ERROR,
      state: vaultState(vault, 'sync'),
      error: {
        message: 'There is no staged batch waiting, so there is no cutoff to move.',
        fix: 'RUN: exposurie sync',
      },
    };
  }

  const now = newestPageWrite(vault, seam);
  if (!(now > (batch.pagesAt || 0))) {
    return {
      code: ERROR,
      state: vaultState(vault, 'sync'),
      error: {
        message:
          `Batch ${batch.id} is still staged and nothing in the brain has changed since ` +
          `it was staged, so the pages were not written. The cutoff has NOT moved and ` +
          `the material is still there — read the batch, write the pages, then run this again.`,
        fix: 'READ: .exposurie/staged/' + batch.id + '/conversations.md',
      },
      json: { advanced: false, batch: batch.id },
    };
  }

  const files = { ...(state.files || {}), ...batch.files };
  const next = { ...state, files, lastSyncUtc: iso(), unfiled: state.unfiled ?? 0 };
  delete next.pendingBatch;
  writeState(vault, next);

  // Pages have just been written, which is the moment the brain is most likely
  // to have drifted: new pages nothing links to, links to pages that were never
  // created, index entries missing. Curating here rather than later is the
  // whole reason it is a stage — a brain curated only once the mess exists is a
  // brain where the mess got there first.
  const c = curateStage(vault, seam);

  return {
    code: OK,
    state: { ...vaultState(vault, 'sync'), unfiled: next.unfiled },
    body: [
      ...block('FILED', [
        ['batch', batch.id],
        ['sessions', `${batch.sessions} now marked as read`],
        ['still waiting', String(next.unfiled ?? 0)],
      ]),
      '',
      ...c.body,
      '',
      ...planBlock([
        { read: join(vault, '.exposurie', 'curate.md') },
        {
          write:
            'Act on the findings above, then do the half no checker can: two pages ' +
            'that disagree, a claim a newer session superseded, an idea now named on ' +
            'several pages that deserves its own. Scope it to the pages this batch ' +
            'touched — that keeps it cheap and continuous rather than a rescue ' +
            'operation later.',
        },
      ]),
      ...(next.unfiled > 0
        ? ['', ...wrap(`${next.unfiled} session${next.unfiled === 1 ? '' : 's'} have not been read yet. Run sync again for the next batch.`, 74, '  ')]
        : []),
    ],
    json: { advanced: true, batch: batch.id, remaining: next.unfiled ?? 0, curate: c.json },
  };
}

export function sync({ done: isDone } = {}) {
  const d = detect();
  // An unreadable pointer is not a machine without a brain. Saying "RUN:
  // exposurie scaffold" here sends the user to build a second one.
  if (d.configError) {
    return {
      code: ERROR,
      state: { vault: null, self: 'sync', brokenPointer: true },
      error: brokenConfig(d.configError),
    };
  }
  if (!d.vault) return noBrain();
  return isDone ? done(d.vault) : stage(d.vault, d);
}

// ------------------------------------------------------------------ rendering
function renderConversations(id, sessions) {
  const out = [
    `# Staged conversation — ${id}`,
    '',
    `${sessions.length} session${sessions.length === 1 ? '' : 's'}, newest first.`,
    '',
    'This is conversation only. Tool calls, tool output, thinking, file contents',
    'and injected context were dropped before this file was written — none of it',
    'carries motive, and motive is what a brain is for.',
    '',
  ];
  sessions.forEach((s, i) => {
    const m = describe(s);
    out.push('---', '');
    out.push(`## ${i + 1} of ${sessions.length} — ${m.project}`);
    out.push('');
    out.push(
      `*${(m.startedAt || '').slice(0, 16).replace('T', ' ')} to ` +
        `${(m.endedAt || '').slice(0, 16).replace('T', ' ')} · ${m.surface} · ` +
        `${m.humanTurns} from them, ${m.turns - m.humanTurns} in reply*`,
    );
    out.push('');
    for (const t of s.turns) {
      out.push(t.role === 'user' ? '**THEM:**' : '**AGENT:**');
      out.push('');
      out.push(t.text);
      out.push('');
    }
  });
  return out.join('\n');
}

function renderManifest(id, rows, extra) {
  const out = [
    `# Batch ${id}`,
    '',
    'What this batch is made of, and what was left out of it. Kept as the record',
    'of where the pages came from — the conversation itself is in',
    '`conversations.md`.',
    '',
    '## Included',
    '',
    '| project | surface | when | turns | chars |',
    '|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.project} | ${r.surface} | ${(r.startedAt || '').slice(0, 10)} | ` +
        `${r.humanTurns} + ${r.turns - r.humanTurns} | ${r.chars.toLocaleString('en-US')} |`,
    ),
    '',
    `**${extra.chars.toLocaleString('en-US')} characters of conversation**` +
      (extra.rawTotal > 0
        ? `, read out of ${(extra.rawTotal / 1048576).toFixed(1)} MB of transcript.`
        : '.'),
    '',
  ];
  const web = extra.web || { exports: 0, failed: [], duplicates: 0 };
  if (web.exports > 0) {
    out.push('## From claude.ai', '');
    out.push(
      `${web.exports} export${web.exports === 1 ? '' : 's'} read. Web conversations carry no ` +
        'working directory, so they are identified by their title. Attachments were ' +
        'not opened: a pasted document is a file, and what was said about it is the ' +
        'part that carries motive.',
      '',
    );
    if (web.duplicates) {
      out.push(
        `${web.duplicates} conversation${web.duplicates === 1 ? '' : 's'} appeared in more than ` +
          'one export and were taken once, from the newest.',
        '',
      );
    }
  }
  if (web.emptyBodies) {
    out.push('## Your export is missing text', '');
    out.push(
      `${web.emptyBodies.count} conversation${web.emptyBodies.count === 1 ? '' : 's'} in the ` +
        'export arrived with messages but no words in them — no title, no summary, ' +
        'nothing said' +
        (web.emptyBodies.from
          ? `, covering ${web.emptyBodies.from.slice(0, 10)} to ${web.emptyBodies.to.slice(0, 10)}.`
          : '.'),
      '',
      'This is almost always a **split export**. Anthropic breaks a large account ' +
        'into numbered zips — `batch-0000`, `batch-0001` and so on — and the email ' +
        'carries a link for each. If only the first was downloaded, the rest of the ' +
        'history is listed in it but lives in the others.',
      '',
      '**Worth telling them, because they can fix it:** check the export email for ' +
        'more download links, or request a fresh export. Drop any further zips in ' +
        'Downloads and run sync again — nothing needs redoing, and nothing already ' +
        'filed is lost.',
      '',
      'These conversations were NOT marked as read. They will be picked up the ' +
        'moment an export arrives with their text in it.',
      '',
    );
  }
  if (web.failed?.length) {
    out.push('## Exports that would not open', '');
    for (const f of web.failed) out.push(`- \`${basename(f.path)}\` — ${f.error}`);
    out.push('', 'Nothing was taken from these. The rest of the batch is unaffected.', '');
  }
  if (extra.excluded.length) {
    out.push('## Excluded by your list', '');
    out.push('Only the head of each was read, far enough to find which folder it', '');
    out.push('belonged to. None of what was said in them was loaded.', '');
    for (const e of extra.excluded) out.push(`- \`${basename(e.path)}\` — ${e.why}`);
    out.push('');
  }
  if (extra.empty.length) {
    out.push('## Nothing said in them', '');
    out.push(`${extra.empty.length} transcript${extra.empty.length === 1 ? '' : 's'} changed but held no conversation — tool work only.`, '');
  }
  if (Object.keys(extra.redactions).length) {
    out.push('## Redacted', '');
    for (const [k, n] of Object.entries(extra.redactions)) out.push(`- ${n} × \`${k}\``);
    out.push('', 'Secrets are removed on the way in, so they never reach a page.', '');
  }
  if (extra.remaining > 0) {
    out.push('## Still waiting', '');
    out.push(`${extra.remaining} session${extra.remaining === 1 ? '' : 's'} have not been read yet. They are next, newest first.`, '');
  }
  return out.join('\n');
}
