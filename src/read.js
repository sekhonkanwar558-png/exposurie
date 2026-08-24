// The librarian: finding a page, and reaching every point inside it.
//
// This is the half of the product an agent touches most. Writing a brain happens
// on a sync; READING it happens on every question the user ever asks, so the
// cost and the failure modes here are paid continuously.
//
// The guarantee this file exists to provide, and it is the whole design:
//
//   EVERY SECTION OF EVERY PAGE IS REACHABLE IN ONE COMMAND, AND THE TOOL
//   PRINTS THAT COMMAND RATHER THAN EXPECTING THE AGENT TO CONSTRUCT IT.
//
// Both halves are load-bearing, and the second half was learned the hard way
// from the reference implementation this is descended from. That tool guards
// large pages by printing an outline instead of the body — correct, because a
// 51 KB page on a context that re-pays every turn is a real cost. But its
// outline prints headings and character counts and NOT the invocation that
// fetches each one. The agent has to assemble `-Section "..."` itself from a
// heading it has only seen rendered.
//
// That is rule 3 of the output contract ("print the command, never the
// concept") broken at exactly the moment the agent most needs the command: it
// has just been told the thing it asked for was withheld. A guard that
// withholds content and then makes the reader guess the way back to it is not
// a guard, it is a maze.
//
// So: the guard stays, and every line of the outline carries its literal argv.
//
// The unit changed too, and that correction came from the owner of the brain
// this was designed against: "theres not a hard rule like 300 lines, it can be
// even 500, but what matters more is whether we are able to access each and
// every point of brain." Lines were always a proxy. What actually decides
// whether a page opens is how many CHARACTERS a retrieval will spend, and what
// actually matters is not that pages stay small but that nothing becomes
// unreachable. Those are different goals and only the second one is real.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { categoryDirs } from './vault.js';

/**
 * How much a single read may spend before the body is replaced by an outline.
 *
 * Not a limit on how long a page may BE. A page may be any length its subject
 * deserves; this only decides whether one command returns the whole thing or
 * returns a map plus the commands to fetch each part.
 */
export const DEFAULT_READ_BUDGET = 16000;

/** Shell-safe quoting for a printed command. Titles contain spaces and parens. */
export function q(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`;
}

/** The exact argv that returns one section. The tool prints this; agents never build it. */
export function sectionCmd(title, heading, nth) {
  const base = `exposurie read ${q(title)} --section ${q(heading)}`;
  return nth ? `${base} --nth ${nth}` : base;
}

/**
 * Every markdown file in the brain, as { title, path }.
 *
 * Reads the seam's category paths rather than hardcoding folder names, because
 * a user who renames `entities` to `people` must not silently lose half their
 * brain to a search that still looks in the old place.
 */
export function allPages(vault, seam) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) out.push({ title: basename(e.name, '.md'), path: p });
    }
  };
  for (const d of categoryDirs(vault, seam)) walk(d);
  return out;
}

/**
 * Headings, in document order, with the line they start on.
 *
 * Fenced code blocks are skipped. A `# comment` inside a shell example is not a
 * section, and treating it as one produces an outline advertising a section
 * that does not exist — the precise failure this file exists to prevent, just
 * arriving from the other direction.
 */
export function headings(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = l.match(/^(#{1,6})\s+(.*\S)\s*$/);
    if (m) out.push({ level: m[1].length, text: m[2], line: i });
  }
  return out;
}

/**
 * Resolve a section name to exactly one heading.
 *
 * Exact match beats substring, always. Without that rule a page holding both
 * "Related" and "...three unrelated columns" cannot return the first one,
 * because the query is a substring of both — measured on a real 67-page brain,
 * where two pages hit exactly this.
 *
 * Identical repeated headings are the case exactness cannot settle, so they get
 * `--nth`. Returning the first silently would make every later one unreachable
 * while looking like it worked, and looking like it worked is the property that
 * makes a retrieval bug expensive.
 */
export function findSection(heads, query, nth) {
  const want = String(query).trim().toLowerCase();
  const exact = heads.filter((h) => h.text.trim().toLowerCase() === want);
  const pool = exact.length ? exact : heads.filter((h) => h.text.toLowerCase().includes(want));
  if (pool.length === 0) return { hit: null, candidates: [] };
  if (pool.length === 1) return { hit: pool[0], candidates: pool };
  if (nth && pool[nth - 1]) return { hit: pool[nth - 1], candidates: pool };
  return { hit: null, candidates: pool };
}

/** The body of one section: its heading through the next heading of equal or higher rank. */
export function sliceSection(text, heads, hit) {
  const lines = String(text).split(/\r?\n/);
  const idx = heads.indexOf(hit);
  let end = lines.length;
  for (let i = idx + 1; i < heads.length; i++) {
    if (heads[i].level <= hit.level) {
      end = heads[i].line;
      break;
    }
  }
  return lines.slice(hit.line, end).join('\n').replace(/\s+$/, '');
}

/**
 * The outline: what an agent gets instead of a body it may not spend.
 *
 * Every line carries the command that fetches it. This is the file's reason for
 * existing, so it is not conditional, not abbreviated for wide pages, and not
 * dropped when the list is long — a long list is exactly when guessing gets
 * expensive.
 *
 * Sizes are printed because the next decision an agent makes is which sections
 * to spend on, and it cannot make that decision without them.
 */
export function outlineBlock(title, text, heads) {
  const out = [];
  // The H1 is the page's own title, not a section inside it. Listing it offers
  // a --section that spans the entire page -- an "open this part" command that
  // returns the whole thing, which is the guard defeating itself.
  //
  // It is dropped from what gets LISTED, never from what gets measured: section
  // bounds are computed against the full heading list, because a section that
  // ends at an H1 must still end there and not run to the foot of the file.
  const listed = heads.filter((h) => h.level > 1);
  const counts = new Map();
  for (const h of listed) {
    const key = h.text.trim().toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const seen = new Map();

  for (const h of listed) {
    const key = h.text.trim().toLowerCase();
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    const dup = counts.get(key) > 1;
    const size = sliceSection(text, heads, h).length;
    const indent = '  '.repeat(Math.max(0, h.level - 1));
    out.push(`${indent}${h.text}   [${size} chars]`);
    out.push(`${indent}  ${sectionCmd(title, h.text, dup ? n : null)}`);
  }
  return out;
}

/**
 * Search. Returns the page, the section the hit lives in, and the command.
 *
 * Returning only the page would be the same mistake as an outline without
 * commands: the agent's next act is always to open the part that matched, so
 * anything short of the section and its invocation leaves work on the floor.
 */
export function search(vault, seam, query, max = 20) {
  const want = String(query).toLowerCase();
  const results = [];
  for (const page of allPages(vault, seam)) {
    let text;
    try {
      text = readFileSync(page.path, 'utf8');
    } catch {
      continue;
    }
    if (!text.toLowerCase().includes(want)) continue;

    const heads = headings(text);
    const lines = text.split(/\r?\n/);
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(want)) continue;
      let owner = null;
      for (const h of heads) {
        if (h.line <= i) owner = h;
        else break;
      }
      hits.push({ line: i + 1, text: lines[i].trim(), owner });
    }
    results.push({ page, hits, count: hits.length });
  }
  results.sort((a, b) => b.count - a.count);
  return { total: results.length, shown: results.slice(0, max) };
}
