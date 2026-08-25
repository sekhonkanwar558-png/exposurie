// The curator: keeping the brain at its peak, deterministically.
//
// This is the half of curation a machine can do. Dead links, index drift, stale
// dates, orphans, unlinked mentions, unreachable sections — all of it is graph
// arithmetic, and it runs in well under a second. The other half —
// contradictions between pages, claims a newer session superseded, a concept
// named on five pages that has no page of its own — needs a reader, and lives
// as a procedure file in the brain where the user can change it.
//
// It is a STAGE, not a command. There is exactly one command a user ever types
// after setup, and everything that makes the brain better lives inside it.
//
// THE FAILURE MODE THIS COMPONENT HAS IS NOISE, NOT MISSES. A checker that
// cries wolf gets switched off in week one, and then it is worth nothing on the
// day something is actually wrong. The reference implementation this descends
// from reported 29 findings on its first run and roughly 20 were false. Every
// guard below is one of those classes, kept as code rather than as a lesson:
//
//   1. PROSE ABOUT SYNTAX. A page describing the `[[wikilink]]` convention
//      inside backticks is not linking to a page called "wikilink". Code spans
//      are blanked before the graph is read.
//   2. EMBEDS ARE NOT LINKS. `![[photo.jpg]]` resolves against the brain's
//      FILES, not its pages.
//   3. "GIT TOUCHED IT" IS NOT "THE WORK HAPPENED". A rename commit that fixed
//      one link in a page is not a reason to advertise that page as fresh —
//      which is the exact harm the staleness check exists to prevent.
//   4. THE LINK NAMESPACE IS BIGGER THAN THE PAGE NAMESPACE. A brain holds
//      notes that are not wiki pages, and a link to one of them resolves fine.
//   5. A PAGE WITH A SIBLING RENDERED ARTIFACT is the source of something
//      outside the brain. Cosmetic auto-edits stay off it — a resume rendered
//      to PDF turns `[[ ]]` into literal brackets on a document that goes to
//      strangers.
//
// And one that is not about false findings at all: A REPORT HAS TO BE ABLE TO
// REACH ZERO. Some findings are TRUE and still correct to leave alone — a page
// title that is also an ordinary English word, a finding the fixer deliberately
// refuses to act on. Reported forever, they put a permanent floor under the
// count, and a list that always has three entries on it is a list nobody reads.
// That is this component's stated failure mode arriving through true findings
// instead of false ones, so `.exposurie/curate-allow.txt` retires them — and
// the suppression count is printed on every run, because a silent allowlist is
// the same bug wearing the opposite mask.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, basename, extname, relative } from 'node:path';

import { allPages, headings, findSection, sectionCmd, nthFor } from './read.js';
import { categoryDirs, seamDefaults, readState } from './vault.js';
import { shapeOf } from './shape.js';
import { block, wrap } from './output.js';

export const ALLOW_FILE = 'curate-allow.txt';

const SEP = String.fromCharCode(92);

/** Report paths the way a person types them: forward slashes, brain-relative. */
const rel = (vault, p) => relative(vault, p).split(SEP).join('/');

// ------------------------------------------------------------------- masking

/**
 * Blank fenced and inline code, preserving length and line breaks.
 *
 * Length preservation is not tidiness — reported line numbers are computed
 * against this text, and a mask that shortens the document reports the wrong
 * line, which is worse than not reporting at all.
 */
export function maskCode(text) {
  const blank = (m) => m.replace(/[^\r\n]/g, ' ');
  let t = String(text).replace(/```[\s\S]*?```/g, blank);
  t = t.replace(/`[^`\r\n]*`/g, blank);
  return t;
}

/**
 * One line, masked for SAFE INSERTION: inline code, existing links and markdown
 * link targets blanked, length preserved so an index into the mask is an index
 * into the original.
 *
 * maskCode answers "should the detector see this?". This answers "may the fixer
 * write here?" — and in the reference implementation only the first existed, so
 * the fixer skipped any line containing a backtick or a link. In a densely
 * linked brain that is nearly every prose line, so it silently never fired:
 * every finding it reported was unfixable by the tool reporting it.
 */
export function maskInline(line) {
  const blank = (m) => ' '.repeat(m.length);
  let t = String(line).replace(/`[^`]*`/g, blank);
  t = t.replace(/\[\[[^\]]*\]\]/g, blank);
  t = t.replace(/\[[^\]]*\]\([^)]*\)/g, blank);
  return t;
}

/** Link targets, normalised: [[Page|alias]] and [[Page#section]] both -> Page. */
export function linkTargets(text) {
  const out = [];
  for (const m of String(text).matchAll(/\[\[([^\]]+)\]\]/g)) {
    out.push(m[1].split('|')[0].split('#')[0].trim());
  }
  return out;
}

const stripFrontmatter = (t) => String(t).replace(/^---[\s\S]*?\r?\n---/, '');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A title matched as a whole word, the way both the detector and the fixer need it. */
const mentionRe = (title) => new RegExp(`(?<![A-Za-z0-9])${escapeRe(title)}(?![A-Za-z0-9])`);

function lineOf(lines, needle) {
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(needle)) return i + 1;
  return 1;
}

// --------------------------------------------------------------- the corpus

/** Every wiki page, read once. Everything below works off this. */
function loadPages(vault, seam) {
  const out = [];
  for (const p of allPages(vault, seam)) {
    let text;
    try {
      text = readFileSync(p.path, 'utf8');
    } catch {
      continue;
    }
    out.push({
      title: p.title,
      path: p.path,
      rel: rel(vault, p.path),
      text,
      clean: maskCode(text),
      chars: text.length,
    });
  }
  return out;
}

/**
 * What else lives in the brain: files that can be embedded, and markdown that
 * can be linked without being a page.
 *
 * The second half is the one that matters. A brain holds loose notes, raw
 * sources, and whatever the person dropped in — all of them legitimate link
 * targets, none of them pages. Missing this is what turns a working link into a
 * dead-link finding, and it is the same boundary as a code repository sitting
 * inside the brain folder: present, referenced, correctly not a page.
 */
function surroundings(vault, seam) {
  const assets = new Set();
  const linkable = new Set();
  const pageDirs = new Set(categoryDirs(vault, seam).map((d) => d.toLowerCase()));
  const skip = new Set(['.exposurie', '.git', 'node_modules']);

  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!skip.has(e.name)) walk(p);
      } else if (e.name.endsWith('.md')) {
        // Pages are loaded separately. Markdown anywhere else is a link target
        // that is not a page.
        if (!pageDirs.has(dirname(p).toLowerCase())) linkable.add(basename(e.name, '.md'));
      } else {
        assets.add(e.name);
      }
    }
  };
  walk(vault);
  return { assets, linkable };
}

/**
 * When git says each page last really changed.
 *
 * "Really" is the whole check. A commit only counts as work on a page when it
 * moved more than a handful of lines, so renames, link fixes and encoding
 * repairs fall under the bar by construction. Without that, a page-rename
 * commit that fixed one wikilink makes the tool bump `updated:` and advertise
 * the page as fresh — the precise harm the check exists to prevent.
 *
 * Absent git, an empty history, or a brain that is not a repository all yield an
 * empty map and no findings, which is correct: nothing knows when those pages
 * changed, so nothing can call a date stale.
 *
 * The log is SCOPED to the page folders, and that is a measurement rather than
 * a tidiness: unscoped, on a brain whose repository also holds other things,
 * this call was 4.7 seconds and every millisecond of the curator's cost was in
 * it. Scoped, 0.2. The pathspecs are the seam's own relative paths because git
 * resolves them against the working directory, which `-C` has just set to the
 * brain — an absolute-looking `wiki/...` from somewhere else silently matches
 * nothing and hands back an empty history that looks exactly like a brain with
 * no commits.
 */
function gitDates(vault, seam, substantive = 6) {
  const dates = new Map();
  const run = (args) =>
    execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', ...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  let root = null;
  try {
    root = run(['rev-parse', '--show-toplevel']).trim();
  } catch {
    return { dates, root: null };
  }
  let log = '';
  try {
    const scope = Object.values(seam?.categories || {});
    log = run(['log', '--pretty=format:@%cs', '--numstat', '--', ...scope]);
  } catch {
    return { dates, root };
  }
  let cur = null;
  for (const line of log.split('\n')) {
    if (line.startsWith('@')) {
      cur = line.slice(1).trim();
      continue;
    }
    if (!line || !cur) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parseInt(parts[0], 10) || 0;
    const deleted = parseInt(parts[1], 10) || 0;
    if (added + deleted <= substantive) continue;
    // git reports paths relative to the repository root, which is not
    // necessarily the brain: a brain can live inside a larger repo.
    if (!dates.has(parts[2])) dates.set(parts[2], cur);
  }
  return { dates, root };
}

// ------------------------------------------------------------------ allowlist

/** One retirement per line: `<path>|<KIND>|<detail>`. Comments and blanks ignored. */
export function readAllow(vault) {
  try {
    return readFileSync(join(vault, '.exposurie', ALLOW_FILE), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

/** The exact line that retires a finding. Printed, never described. */
export const allowKey = (f) => `${f.file}|${f.kind}|${f.detail || ''}`;

// --------------------------------------------------------------------- checks

/**
 * Look at the brain and report. Never writes.
 *
 * Split out from `curate` so that a run which FIXED something can look again.
 * Our own edits change the answers: linking a page that nothing pointed at
 * stops it being an orphan, and reporting it anyway describes a brain that
 * stopped existing halfway through this command. That is a false finding
 * produced by the tool itself, which is the noise failure mode arriving from
 * the one direction no guard above covers.
 */
function analyse(vault, s) {
  const pages = loadPages(vault, s);
  const byTitle = new Map(pages.map((p) => [p.title, p]));
  const { assets, linkable } = surroundings(vault, s);

  const broken = [];
  const notice = [];
  let totalLinks = 0;

  // Inbound counts deliberately EXCLUDE the index, which links every page by
  // design — counting it would make every page look connected and the orphan
  // check would never fire once.
  const inbound = new Map(pages.map((p) => [p.title, new Set()]));
  const pageLinks = new Map(pages.map((p) => [p.title, new Set()]));

  // --------------------------------------------------- dead links and embeds
  for (const p of pages) {
    const lines = p.text.split('\n');
    const seen = new Set();

    for (const m of p.clean.matchAll(/!\[\[([^\]]+)\]\]/g)) {
      const name = m[1].split('|')[0].split('#')[0].trim();
      if (assets.has(name) || byTitle.has(name)) continue;
      if (seen.has('@' + name)) continue;
      seen.add('@' + name);
      broken.push({
        kind: 'MISSINGASSET',
        file: p.rel,
        line: lineOf(lines, '![[' + name),
        detail: name,
        what: `embeds ${name}, which is not in the brain`,
        note: 'The file was moved, or never arrived. Fix the name or drop the embed.',
      });
    }

    // Blank the embeds so the page-link pass below never sees them.
    const body = p.clean.replace(/!\[\[[^\]]+\]\]/g, (m) => m.replace(/[^\r\n]/g, ' '));
    const targets = linkTargets(body);
    totalLinks += targets.length;

    for (const target of targets) {
      if (byTitle.has(target)) {
        pageLinks.get(p.title).add(target);
        if (target !== p.title) inbound.get(target).add(p.title);
        continue;
      }
      if (linkable.has(target)) continue;
      if (seen.has('!' + target)) continue;
      seen.add('!' + target);
      broken.push({
        kind: 'DEADLINK',
        file: p.rel,
        line: lineOf(lines, '[[' + target),
        detail: target,
        what: `[[${target}]] has no page`,
        note: 'Create the page, fix the spelling, or drop the brackets.',
      });
    }
  }

  // ------------------------------------------------------------- index drift
  const indexRel = s.index || 'index.md';
  let indexText = '';
  try {
    indexText = readFileSync(join(vault, ...indexRel.split('/')), 'utf8');
  } catch {}
  const indexed = new Set(linkTargets(maskCode(indexText)));

  if (indexText) {
    for (const p of pages) {
      if (indexed.has(p.title)) continue;
      broken.push({
        kind: 'UNINDEXED',
        file: p.rel,
        line: 1,
        what: `not listed in ${indexRel}`,
        note: 'The index is a retrieval mechanism — a page missing from it is a page nothing finds.',
      });
    }
    for (const t of indexed) {
      if (byTitle.has(t) || linkable.has(t)) continue;
      broken.push({
        kind: 'DEADINDEX',
        file: indexRel,
        line: lineOf(indexText.split('\n'), '[[' + t),
        detail: t,
        what: `the index lists [[${t}]], which has no page`,
        note: 'Renamed or deleted without fixing the index.',
      });
    }
  }

  // -------------------------------------------------------------- stale dates
  const { dates, root } = gitDates(vault, s);
  for (const p of pages) {
    const key = root ? relative(root, p.path).split(SEP).join('/') : null;
    const when = key ? dates.get(key) : null;
    const m = p.text.match(/^updated:\s*(\d{4}-\d{2}-\d{2})/m);
    if (!m) {
      // Only worth saying about a page git has actually seen. A page written
      // five minutes ago and never committed has no evidence either way, and a
      // finding nobody can act on is noise.
      if (when) {
        broken.push({
          kind: 'NOFRONTMATTER',
          file: p.rel,
          line: 1,
          what: 'no `updated:` date in its frontmatter',
          note: 'Every page carries type/created/updated — see the schema.',
        });
      }
      continue;
    }
    if (when && m[1] < when) {
      const lines = p.text.split('\n');
      let ln = 1;
      for (let i = 0; i < lines.length; i++) {
        if (/^updated:/.test(lines[i])) {
          ln = i + 1;
          break;
        }
      }
      broken.push({
        kind: 'STALE',
        file: p.rel,
        line: ln,
        page: p.title,
        newDate: when,
        what: `says updated ${m[1]}, but it really changed ${when}`,
        note: 'Bump it, or the freshness of every page becomes unreadable.',
      });
    }
  }

  // -------------------------------------------- unreachable sections (BROKEN)
  //
  // The librarian's guarantee is that every section of every page is reachable
  // in one command. This checks it on the REAL brain rather than on fixtures —
  // the same exhaustive pass, run against the pages a person actually has,
  // because a retrieval bug does not look like a failure. It returns the wrong
  // section, confidently, and the person is told something false about their
  // own life.
  //
  // This is also what replaced page size as the thing actually checked. Size was
  // always a proxy: what matters is not how long a page is, it is how many of
  // its points cannot be reached — and that number should be zero.
  for (const p of pages) {
    const heads = headings(p.text);
    // Asking the librarian for the command it would print, rather than
    // rebuilding the rule here. A checker with its own copy of the rule checks
    // its own opinion.
    const nthOf = nthFor(heads);
    for (const h of heads) {
      if (h.level <= 1) continue;
      const nth = nthOf.get(h);
      const { hit } = findSection(heads, h.text, nth);
      if (hit === h) continue;
      broken.push({
        kind: 'UNREACHABLE',
        file: p.rel,
        line: h.line + 1,
        detail: h.text,
        what: `"${h.text}" cannot be opened — ${sectionCmd(p.title, h.text, nth)} returns something else`,
        note: 'Rename the heading so it is distinguishable. A section nothing can open is not in the brain.',
      });
    }
  }

  // ------------------------------------------------------- advisory: orphans
  for (const p of pages) {
    if (inbound.get(p.title).size > 0) continue;
    notice.push({
      kind: 'ORPHAN',
      file: p.rel,
      line: 1,
      what: 'no inbound links from any other page',
      note: 'Reachable only through the index. Link it from the pages it belongs to.',
    });
  }

  // ---------------------------------------------------- read cost: A NUMBER,
  //                                                       DELIBERATELY NOT A
  //                                                       FINDING
  //
  // This was a finding for exactly one measurement. On a real 67-page brain it
  // produced FOURTEEN of the run's seventeen entries — 82% of the report, for
  // pages that are working exactly as designed: past the budget a plain read
  // returns a map with the command for every section, which is the librarian
  // doing its job, not drift.
  //
  // And there is no edit that clears them. Splitting a page to hit a number is
  // the one thing the owner of that brain explicitly ruled out — "i never told
  // to set any limit to any page, we just want the brain to work at its peak" —
  // so as findings these are unfixable by construction. A permanent floor of
  // fourteen under a report that must be able to reach zero is this component's
  // stated failure mode arriving through TRUE findings, which is the harder
  // version of it and the one an allowlist should not have to absorb.
  //
  // So size stays a prompt to look and stops being a verdict: a count in the
  // header, naming the largest page, and nothing in the list. What is actually
  // checked is UNREACHABLE above — whether every point can still be opened —
  // which is the thing that was always meant by "curating for retrieval".
  const budget = s.guards?.maxReadChars || 16000;
  const heavy = pages
    .filter((p) => p.chars > budget)
    .sort((a, b) => b.chars - a.chars)
    .map((p) => ({ file: p.rel, title: p.title, chars: p.chars, reads: p.chars / budget }));

  // -------------------------------------------- advisory: unlinked mentions
  //
  // A page names another page in prose and never links it. The convention is to
  // link once, not on every mention, so a single existing link anywhere on the
  // page settles it and the plain mentions after it are correct, not findings.
  const titles = pages.map((p) => p.title).filter((t) => t.length >= 6);
  for (const p of pages) {
    const stripped = stripFrontmatter(p.clean).replace(/\[\[[^\]]+\]\]/g, '');
    const hits = [];
    for (const t of titles) {
      if (t === p.title) continue;
      if (pageLinks.get(p.title).has(t)) continue;
      // A shorter title contained in this page's own title, e.g. "Rate
      // Limiting" inside "Rate Limiting — What Broke". The page is not failing
      // to link to itself.
      if (p.title.includes(t)) continue;
      if (!stripped.includes(t)) continue; // cheap gate before the regex
      if (mentionRe(t).test(stripped)) hits.push(t);
    }
    if (!hits.length) continue;
    notice.push({
      kind: 'UNLINKED',
      file: p.rel,
      line: 1,
      page: p.title,
      titles: hits,
      what: unlinkedText(hits),
      note: 'The graph is how a brain is navigated — an unlinked mention is a missing edge.',
    });
  }

  // ------------------------------------------------------- advisory: garbage
  //
  // Deletion candidates, REPORTED AND NEVER ACTED ON, and only three things
  // qualify — all three facts rather than opinions: no body at all, byte
  // identical to another page, an empty file.
  //
  // The tempting proxy is length, and length is exactly backwards. The shortest
  // page in the brain this was designed against is three lines long and holds an
  // abandoned idea WITH THE REASON ATTACHED, which the schema calls the highest
  // signal material a brain can hold. A length rule eats the best pages first.
  //
  // The asymmetry settles it: missed garbage costs a few KB. One wrong deletion
  // costs something that existed nowhere else. If a delete path is ever built,
  // the rule is never remove a file git has no copy of — an uncommitted file is
  // the only truly unrecoverable case, and it is the one a new page is in.
  const byBody = new Map();
  for (const p of pages) {
    const body = stripFrontmatter(p.text).trim();
    if (!body.length) {
      notice.push({
        kind: 'GARBAGE',
        file: p.rel,
        line: 1,
        what: 'frontmatter only — no body at all',
        note: 'Reported, never deleted: confirm it is not a page caught mid-write.',
      });
      continue;
    }
    if (!byBody.has(body)) byBody.set(body, []);
    byBody.get(body).push(p.rel);
  }
  for (const [, group] of byBody) {
    if (group.length < 2) continue;
    notice.push({
      kind: 'GARBAGE',
      file: group[0],
      line: 1,
      detail: group.slice(1).join(','),
      what: `byte-identical to: ${group.slice(1).join(', ')}`,
      note: 'One of these is redundant. WHICH one is a judgement — decide it, do not let a script.',
    });
  }

  // ------------------------------------------- advisory: always-loaded cost
  //
  // The schema is injected into every session started in the brain folder. It
  // has no hard limit, which makes it a running cost rather than a cliff — and
  // costs with no cliff are the ones nothing ever reports. The fix when this
  // fires is COMPRESSION, never a bigger ceiling: the system this came from
  // raised such a ceiling once and bought five days.
  const schemaBudget = s.guards?.maxSchemaChars || 40000;
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    let chars;
    try {
      chars = readFileSync(join(vault, name), 'utf8').length;
    } catch {
      continue;
    }
    if (chars < schemaBudget * 0.75) continue;
    notice.push({
      kind: 'SURFACE',
      file: name,
      line: 1,
      what:
        `${chars.toLocaleString('en-US')} chars, ${Math.round((chars / schemaBudget) * 100)}% of a ` +
        `${schemaBudget.toLocaleString('en-US')}-char soft budget — injected into every session in this folder`,
      note: 'A soft budget, not a client limit. The fix is compression, never a bigger ceiling.',
    });
  }

  // --------------------------------------------------------------- allowlist
  const allow = new Set(readAllow(vault));
  let suppressed = 0;
  const keep = (list) =>
    list.filter((f) => {
      if (f.kind === 'UNLINKED') {
        const left = f.titles.filter((t) => !allow.has(`${f.file}|UNLINKED|${t}`));
        suppressed += f.titles.length - left.length;
        if (!left.length) return false;
        if (left.length !== f.titles.length) {
          f.titles = left;
          f.what = unlinkedText(left);
        }
        return true;
      }
      if (!allow.has(allowKey(f))) return true;
      suppressed += 1;
      return false;
    });

  // The shape pass. Separate from every finding above on purpose: those ask
  // whether the graph is consistent, and a perfectly consistent graph can be a
  // pile of session logs. This asks whether the brain became the thing the
  // whole product exists to prevent, and it reports to the person rather than
  // fixing anything.
  const filed = Object.keys((readState(vault) || {}).files || {}).length;
  const form = shapeOf({ pages, inbound, filed, allow: new Set(readAllow(vault)) });

  return {
    pages: pages.length,
    links: totalLinks,
    broken: keep(broken),
    notice: keep(notice),
    heavy,
    suppressed,
    byTitle,
    shape: form,
  };
}

/**
 * The curator. Reports, and with `fix` applies the two edits that cannot lose
 * anything — then looks again, so what it prints is the brain as it now stands
 * rather than as it was when the run began.
 */
export function curate(vault, seam, { fix = false } = {}) {
  const s = seam || seamDefaults('0');
  const first = analyse(vault, s);
  if (!fix) return { ...first, fixed: [] };

  const fixed = applyFixes(first.byTitle, first.broken, first.notice);
  if (!fixed.length) return { ...first, fixed: [] };
  return { ...analyse(vault, s), fixed };
}

const unlinkedText = (hits) =>
  `names ${hits.length} page${hits.length === 1 ? '' : 's'} in prose without linking: ` +
  hits.slice(0, 6).join(', ') +
  (hits.length > 6 ? ', ...' : '');

// -------------------------------------------------------------------- fixing
//
// ADDITIVE ONLY, and that is the whole reason these two run unattended. Both
// constraints came from the person this was built for, in the same breath, and
// they pull against each other productively: "beware i dont loose any of my
// knowledge in brain, it is just curating it beautifully for better fetch, not
// deleting anything" and "no it dont needa ask me everytime."
//
// The resolution is to split findings by whether the fix is PROVABLY additive.
// Bumping a date is metadata. Wrapping a mention in brackets is four characters
// and one graph edge. Everything else — whether a dead link wants a new page or
// a corrected spelling, what an index line should say, where a page should be
// cut — needs a judgement, and stays a report. Nothing is ever removed by
// either path.

function applyFixes(byTitle, broken, notice) {
  const fixed = [];

  for (const f of broken) {
    if (f.kind !== 'STALE') continue;
    const p = byTitle.get(f.page);
    if (!p) continue;
    const next = p.text.replace(/^updated:\s*\d{4}-\d{2}-\d{2}/m, `updated: ${f.newDate}`);
    if (next === p.text) continue;
    writeFileSync(p.path, next, 'utf8');
    p.text = next;
    f.fixed = true;
    fixed.push(`${p.rel}  updated: -> ${f.newDate}`);
  }

  for (const f of notice) {
    if (f.kind !== 'UNLINKED') continue;
    const p = byTitle.get(f.page);
    if (!p) continue;
    if (hasRenderedSibling(p.path, p.title)) continue;

    // Split on \n only, so any \r stays attached to its line and the file's
    // existing line endings survive the rejoin untouched.
    const lines = p.text.split('\n');
    let linked = 0;

    for (const t of f.titles) {
      const re = mentionRe(t);
      let inFence = false;
      let inFront = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trim = line.trim();
        if (i === 0 && trim === '---') {
          inFront = true;
          continue;
        }
        if (inFront) {
          if (trim === '---') inFront = false;
          continue;
        }
        if (trim.startsWith('```')) {
          inFence = !inFence;
          continue;
        }
        if (inFence) continue;
        if (trim.startsWith('#')) continue; // headings stay plain
        // Match against the MASK and splice back into the original by index, so
        // a line that already holds a link or a code span is still fixable.
        const m = re.exec(maskInline(line));
        if (!m) continue;
        lines[i] = line.slice(0, m.index) + `[[${t}]]` + line.slice(m.index + m[0].length);
        linked += 1;
        fixed.push(`${p.rel}:${i + 1}  linked [[${t}]]`);
        break;
      }
    }

    if (!linked) continue;
    p.text = lines.join('\n');
    writeFileSync(p.path, p.text, 'utf8');
    // Only a fully resolved finding drops out of the report. A page where one
    // title was linked and another had nowhere safe to go is still a finding,
    // and saying otherwise would hide it.
    if (linked === f.titles.length) f.fixed = true;
  }

  return fixed;
}

// ----------------------------------------------------------------- reporting
//
// Two rules from the output contract do all the work here. Every actionable
// line opens with a verb in caps, and the exact text to type is PRINTED rather
// than described — including the line that retires a finding, because a
// mechanism an agent has to infer is a mechanism that never gets used.

/** The curator's report, as body lines. Empty when there is genuinely nothing. */
export function report(result, vault) {
  const { pages, links, broken, notice, heavy = [], fixed, suppressed, shape } = result;
  const total = broken.length + notice.length;

  const head = [['brain', `${pages} page${pages === 1 ? '' : 's'} · ${links} links`]];
  if (fixed.length) {
    head.push(['fixed', `${fixed.length} lossless edit${fixed.length === 1 ? '' : 's'} — nothing was removed`]);
  }
  head.push([
    'findings',
    total === 0
      ? 'none — links, index and dates all agree'
      : `${total} to look at (${broken.length} broken, ${notice.length} advisory)`,
  ]);
  if (heavy.length) {
    // A number, not a verdict. It says look, and the reader decides — there is
    // no length limit here and a page that opens section by section is fine.
    head.push([
      'read cost',
      `${heavy.length} page${heavy.length === 1 ? '' : 's'} open as a map rather than a body` +
        ` — largest "${heavy[0].title}" at ${heavy[0].reads.toFixed(1)} reads`,
    ]);
  }
  if (suppressed) {
    // Never silent. An allowlist nobody can see is the same bug as a checker
    // that cries wolf, wearing the opposite mask.
    head.push(['retired', `${suppressed} reviewed earlier and correct as-is`]);
  }

  const out = [...block('CURATED', head)];

  if (fixed.length) {
    out.push('');
    for (const line of fixed) out.push(`  ${line}`);
  }

  const section = (title, list) => {
    if (!list.length) return;
    out.push('', title);
    for (const f of list) {
      out.push(`  ${f.file}:${f.line}  [${f.kind}]  ${f.what}`);
      out.push(...wrap(`-> ${f.note}`, 68, '      '));
    }
  };
  section('BROKEN — the graph or the index is wrong', broken);
  section('NOTICE — nothing is broken; the brain is drifting off its peak', notice);

  // Deliberately its own block, below the findings and phrased at the agent.
  // A finding says a line is wrong. This says the brain is turning into the
  // thing it was built not to be — different problem, different reader, and the
  // only party who can act on it is the one whose brain it is.
  const signals = shape?.signals ?? [];
  if (signals.length) {
    out.push('', 'SHAPE — not about a line; about what the brain is becoming');
    for (const sg of signals) {
      out.push(`  [${sg.kind}]  ${sg.what}`);
      out.push(...wrap(sg.tell, 68, '      '));
      // A brain is allowed a page that is deliberately a chronology. Say how to
      // retire it here, or this reports a correct page forever and gets muted.
      if (sg.retire) {
        out.push(`      IF THAT PAGE IS MEANT TO BE A CHRONOLOGY, retire it:`);
        out.push(`      APPEND TO ${join(vault, '.exposurie', ALLOW_FILE)}`);
        out.push(`      ${sg.retire}`);
      }
    }
    out.push(
      ...wrap(
        'None of this is auto-fixable and none of it is a rule — a young brain trips ' +
          'these honestly. They are the shape of the one failure that otherwise arrives ' +
          'silent: a clean graph, a rising page count, and nothing worth opening. ' +
          'TELL YOUR USER what you found and what you changed.',
        74,
        '  ',
      ),
    );
  }

  if (total > 0) {
    const first = broken[0] || notice[0];
    const key = first.kind === 'UNLINKED' ? `${first.file}|UNLINKED|${first.titles[0]}` : allowKey(first);
    out.push('');
    out.push(...wrap(
      'A finding can be TRUE and still correct to leave alone — a page title ' +
        'that is also an ordinary word, an edge that would be wrong to draw. ' +
        'Retire one for good by appending its key, so this report can reach zero:',
      74,
      '  ',
    ));
    out.push(`      APPEND TO ${join(vault, '.exposurie', ALLOW_FILE)}`);
    out.push(`      ${key}`);
  }

  return out;
}

/**
 * A page with a sibling rendered artifact — `Resume.md` next to `Resume.html`,
 * which prints the PDF — is the SOURCE of something outside the brain, and the
 * two are hand-mirrored. Adding `[[ ]]` there is invisible in an editor and
 * turns into literal brackets on a document that goes to strangers. Cosmetic
 * auto-edits stay off these pages. They are still reported.
 */
export function hasRenderedSibling(path, title) {
  try {
    for (const e of readdirSync(dirname(path), { withFileTypes: true })) {
      if (!e.isFile()) continue;
      if (extname(e.name) === '.md') continue;
      if (basename(e.name, extname(e.name)) === title) return true;
    }
  } catch {}
  return false;
}
