// `exposurie read` — the librarian, rendered.
//
// Four shapes, one command, because an agent choosing between `page`, `section`
// and `search` subcommands is an agent that can choose wrong. What it wants is
// always "show me this"; the flags say how much.
//
//   exposurie read "<page>"                     the page, or its map if large
//   exposurie read "<page>" --section "<name>"  one section
//   exposurie read "<page>" --outline           the map, whatever the size
//   exposurie read --search "<query>"           find it first
//
// Nothing here is ever a dead end. Every response that does not contain what
// was asked for contains the exact command that does — a missing page prints
// the search that finds it, an oversized page prints a command per section, an
// ambiguous section prints one command per candidate. That is rule 3 of the
// output contract applied where it is most easily skipped: the failure paths.

import { existsSync, readFileSync } from 'node:fs';
import { readSeam, vaultState, expandPath, DEFAULT_VAULT } from '../vault.js';
import { readConfig, configState, brokenConfig } from '../context.js';
import { OK, ERROR } from '../exit-codes.js';
import {
  allPages,
  headings,
  findSection,
  sliceSection,
  outlineBlock,
  search as runSearch,
  sectionCmd,
  q,
  DEFAULT_READ_BUDGET,
} from '../read.js';

function resolveVault(at) {
  const explicit = expandPath(at);
  if (explicit) return explicit;
  const cfg = readConfig();
  if (cfg?.vault && existsSync(cfg.vault)) return cfg.vault;
  return existsSync(DEFAULT_VAULT) ? DEFAULT_VAULT : null;
}

/**
 * Match a page by title. Exact beats prefix beats substring, for the same
 * reason section lookup works that way: a brain holding both "Ledger" and
 * "Ledger Migration Notes" must still be able to return the first one.
 */
function findPage(pages, want) {
  const w = String(want).trim().toLowerCase();
  const exact = pages.filter((p) => p.title.toLowerCase() === w);
  if (exact.length) return { hit: exact[0], candidates: exact };
  const pre = pages.filter((p) => p.title.toLowerCase().startsWith(w));
  if (pre.length === 1) return { hit: pre[0], candidates: pre };
  const sub = pages.filter((p) => p.title.toLowerCase().includes(w));
  const pool = pre.length ? pre : sub;
  if (pool.length === 1) return { hit: pool[0], candidates: pool };
  return { hit: null, candidates: pool };
}

export function read(values = {}, positionals = []) {
  // --at names a brain outright, so a broken pointer cannot mislead us and the
  // flag doubles as the way to keep working while the file is repaired.
  const cfg = configState();
  if (cfg.status === 'unreadable' && !expandPath(values.at)) {
    return {
      code: ERROR,
      state: { vault: null, self: 'read', brokenPointer: true },
      error: brokenConfig(cfg),
    };
  }
  const vault = resolveVault(values.at);
  const state = vaultState(vault, 'read');

  if (!vault) {
    return {
      code: ERROR,
      state,
      error: {
        message: 'No brain on this machine yet, so there is nothing to read.',
        fix: 'RUN: exposurie init',
      },
    };
  }

  const seam = readSeam(vault);
  const pages = allPages(vault, seam);
  const budget = seam?.guards?.maxReadChars ?? DEFAULT_READ_BUDGET;

  // ---- search ----------------------------------------------------------
  if (values.search) {
    const { total, shown } = runSearch(vault, seam, values.search);
    const body = [];
    if (total === 0) {
      body.push(
        `TOTAL: 0 pages match ${q(values.search)} — searched ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}.`,
      );
      body.push('');
      body.push('Nothing in the brain matches. Say so plainly; do not answer from memory.');
      return { code: OK, state, body };
    }
    body.push(
      `TOTAL: ${total} ${total === 1 ? 'page matches' : 'pages match'} ${q(values.search)} ` +
        `(searched ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}).`,
    );
    if (shown.length < total) {
      body.push(`Showing ${shown.length}. Do NOT describe this list as complete.`);
    }
    for (const r of shown) {
      body.push('');
      body.push(`${r.page.title}   [${r.count} hit${r.count === 1 ? '' : 's'}]`);
      body.push(`  RUN:  exposurie read ${q(r.page.title)}`);
      // The section a hit lives in, with the command for it. The agent's next
      // act is to open the matching part, so handing it the page alone leaves
      // the actual work undone.
      const seen = new Set();
      for (const h of r.hits.slice(0, 3)) {
        const name = h.owner?.text;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        body.push(`  L${h.line} in "${name}"`);
        body.push(`  RUN:  ${sectionCmd(r.page.title, name)}`);
      }
    }
    return { code: OK, state, body };
  }

  // ---- a page is required from here on ---------------------------------
  const want = positionals[0];
  if (!want) {
    return {
      code: ERROR,
      state,
      error: {
        message: 'read needs a page title, or --search to find one.',
        fix: `RUN: exposurie read --search ${q('what you are looking for')}`,
      },
    };
  }

  const { hit: page, candidates } = findPage(pages, want);
  if (!page) {
    const body = [];
    if (candidates.length > 1) {
      body.push(`${candidates.length} pages match ${q(want)}. Pick one:`);
      for (const c of candidates.slice(0, 12)) body.push(`  RUN:  exposurie read ${q(c.title)}`);
    } else {
      body.push(`No page titled ${q(want)}.`);
      body.push(`  RUN:  exposurie read --search ${q(want)}`);
    }
    return { code: OK, state, body };
  }

  let text;
  try {
    text = readFileSync(page.path, 'utf8');
  } catch (e) {
    return { code: ERROR, state, error: { message: `Cannot read ${page.path}: ${e.message}` } };
  }
  const heads = headings(text);

  // ---- one section -----------------------------------------------------
  if (values.section) {
    const nth = values.nth ? Number(values.nth) : null;
    const { hit, candidates: cands } = findSection(heads, values.section, nth);
    if (!hit) {
      const body = [];
      if (cands.length === 0) {
        body.push(`${page.title} has no section matching ${q(values.section)}.`);
        body.push(`  RUN:  exposurie read ${q(page.title)} --outline`);
      } else {
        // Identical headings. Exactness cannot separate them, so hand over one
        // working command per candidate rather than a rule to apply.
        body.push(`${cands.length} sections match ${q(values.section)} on ${page.title}. Pick one:`);
        cands.forEach((c, i) => {
          body.push(`  ${i + 1}. ${c.text}   [line ${c.line + 1}]`);
          body.push(`     RUN:  ${sectionCmd(page.title, values.section, i + 1)}`);
        });
      }
      return { code: OK, state, body };
    }
    const slice = sliceSection(text, heads, hit);
    return {
      code: OK,
      state,
      body: [
        `${page.title} -> ${hit.text}`,
        `path: ${page.path}   (section only, ${slice.split('\n').length} lines of ${text.split('\n').length})`,
        '',
        slice,
      ],
    };
  }

  // ---- outline, asked for or imposed -----------------------------------
  const oversize = text.length > budget;
  if (values.outline || (oversize && !values.full)) {
    const body = [];
    body.push(`${page.title}   [${text.length} chars]`);
    body.push(`path: ${page.path}`);
    body.push('');
    if (oversize && !values.outline) {
      // Say plainly that this is not the page. An agent that mistakes an
      // outline for content answers from headings, which reads to the user
      // exactly like never having opened the page at all.
      body.push(
        `THIS IS NOT THE PAGE. ${text.length} chars is over the ${budget} read budget, so the body was NOT printed — what follows is a map.`,
      );
      body.push('Open every section the question touches. Reading more is cheap; a shallow answer is not.');
      body.push('');
    }
    body.push(...outlineBlock(page.title, text, heads));
    body.push('');
    body.push(`Whole page anyway:  exposurie read ${q(page.title)} --full`);
    return { code: OK, state, body };
  }

  // ---- the page --------------------------------------------------------
  return {
    code: OK,
    state,
    body: [`${page.title}`, `path: ${page.path}   [${text.length} chars]`, '', text.replace(/\s+$/, '')],
  };
}
