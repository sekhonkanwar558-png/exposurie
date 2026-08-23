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

import { detect } from '../context.js';
import { block, planBlock, wrap } from '../output.js';
import { OK, ERROR } from '../exit-codes.js';
import { readTranscript, describe } from '../extract/transcript.js';
import { redact } from '../extract/redact.js';
import { conversationExcluded } from '../extract/exclude.js';
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
      candidates.push({ path: f, client: c.id, size, from, mtime: statSync(f).mtimeMs });
    }
  }
  // Newest first: recent context is what makes older material legible, and a
  // sync that stops early then leaves a useful brain rather than an ancient one.
  candidates.sort((a, b) => b.mtime - a.mtime);

  // The gate runs over everything first, not inside the batching loop. It is a
  // policy about what may be opened at all, so it cannot depend on where a
  // batch happens to stop — and "still waiting" would otherwise count sessions
  // that are never going to be read.
  const included = [];
  const excluded = [];
  const eligible = [];
  for (const cand of candidates) {
    const hit = conversationExcluded({ cwd: peekCwd(cand.path) }, seam);
    if (hit) excluded.push({ path: cand.path, why: hit });
    else eligible.push(cand);
  }

  const empty = [];
  let chars = 0;
  let redactions = {};

  for (const cand of eligible) {
    const s = readTranscript(cand.path, cand.from);
    if (!s || s.turns.length === 0) {
      // Nothing said in it. Real: 16 of 127 sessions on a measured corpus.
      empty.push({ path: cand.path, readTo: cand.size });
      continue;
    }

    // Whole sessions only — half a conversation is worse than none, because the
    // half that explains why is usually the half that gets cut. So the budget
    // stops us BEFORE a session that would blow past it, and the first session
    // always goes in, or a brain with one enormous session never progresses.
    if (included.length > 0 && chars + s.chars > budget) break;

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
    // Sessions with nothing in them are still finished with, or they are
    // re-examined forever.
    if (empty.length) {
      const next = { ...state, files: { ...seen } };
      for (const e of empty) next.files[e.path] = { bytes: e.readTo, at: iso() };
      next.lastSyncUtc = iso();
      next.unfiled = 0;
      writeState(vault, next);
    }
    return {
      code: OK,
      state: { ...vaultState(vault, 'sync'), unfiled: 0 },
      body: [...block('NOTHING NEW', [['result', 'nothing to stage']]), '', ...wrap(why, 74, '  ')],
      json: { staged: 0, candidates: candidates.length, excluded: excluded.length, empty: empty.length },
    };
  }

  const id = stamp();
  const dir = join(stagedDir(vault), id);
  mkdirSync(dir, { recursive: true });

  const rows = included.map(describe);
  const rawTotal = included.reduce((n, s) => n + s.rawBytes, 0);
  const remaining = eligible.length - included.length - empty.length;

  writeFileSync(join(dir, 'conversations.md'), renderConversations(id, included), 'utf8');
  writeFileSync(
    join(dir, 'MANIFEST.md'),
    renderManifest(id, rows, { excluded, empty, remaining, chars, rawTotal, redactions }),
    'utf8',
  );

  // Recorded, not applied: these offsets become the cutoff only once the pages
  // exist. An abandoned sync must re-stage the same material, not skip it.
  const pending = { id, stagedAt: iso(), files: {}, sessions: included.length };
  for (const s of included) pending.files[s.path] = { bytes: s.readTo, at: iso() };
  for (const e of empty) pending.files[e.path] = { bytes: e.readTo, at: iso() };
  writeState(vault, {
    ...state,
    files: seen,
    pendingBatch: { ...pending, pagesAt: newestPageWrite(vault, seam) },
    unfiled: remaining,
  });

  const summary = [
    ['batch', id],
    ['sessions', `${included.length} staged${remaining > 0 ? `, ${remaining} still waiting` : ''}`],
    [
      'conversation',
      `${chars.toLocaleString('en-US')} chars, out of ${(rawTotal / 1048576).toFixed(1)} MB of transcript` +
        (rawTotal > 0 ? `  (${Math.round(rawTotal / Math.max(chars, 1))}x smaller)` : ''),
    ],
  ];
  if (excluded.length) summary.push(['excluded', `${excluded.length} by your exclude list`]);
  if (empty.length) summary.push(['no conversation', `${empty.length} skipped`]);
  if (Object.keys(redactions).length) {
    summary.push(['redacted', Object.entries(redactions).map(([k, n]) => `${n} ${k}`).join(', ')]);
  }

  return {
    code: OK,
    state: { ...vaultState(vault, 'sync'), unfiled: remaining },
    body: [
      ...block('STAGED', summary),
      '',
      ...planBlock([
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
      remaining,
      chars,
      rawBytes: rawTotal,
      excluded: excluded.length,
      empty: empty.length,
      redactions,
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

  return {
    code: OK,
    state: { ...vaultState(vault, 'sync'), unfiled: next.unfiled },
    body: [
      ...block('FILED', [
        ['batch', batch.id],
        ['sessions', `${batch.sessions} now marked as read`],
        ['still waiting', String(next.unfiled ?? 0)],
      ]),
      ...(next.unfiled > 0
        ? ['', ...wrap(`${next.unfiled} session${next.unfiled === 1 ? '' : 's'} have not been read yet. Run sync again for the next batch.`, 74, '  ')]
        : []),
    ],
    json: { advanced: true, batch: batch.id, remaining: next.unfiled ?? 0 },
  };
}

export function sync({ done: isDone } = {}) {
  const d = detect();
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
    `**${extra.chars.toLocaleString('en-US')} characters of conversation**, read out of ` +
      `${(extra.rawTotal / 1048576).toFixed(1)} MB of transcript.`,
    '',
  ];
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
