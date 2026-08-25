// Is this a brain, or an archive with wikilinks?
//
// Every other check in the curator asks whether the graph is CONSISTENT: dead
// links, index drift, dates that lie. All of them can pass on a brain that is
// worthless, because a pile of session logs can be perfectly well linked.
//
// Nothing here judges whether a page is GOOD. That is not computable, on this
// machine or any other, and pretending otherwise is how a checker starts crying
// wolf. What IS computable is whether the brain has the SHAPE of the failure we
// already know about — the one the whole product is built to avoid, where each
// session becomes a page, each page becomes a list of dates, and the result
// reports `0 orphan` while answering nothing.
//
// So these are shape checks, not quality checks. They cannot tell you the brain
// is good. They can tell you it has become a log, which is the one failure that
// otherwise arrives completely silent — clean graph, rising page count, nobody
// ever opening it.
//
// THEY REPORT TO THE PERSON, THROUGH THEIR AGENT, AND FIX NOTHING THEMSELVES.
// That is the whole observability design: we never see a stranger's brain and
// never want to, so the only party who can judge it is the one standing next to
// it. A signal that reaches them beats a metric that reaches us.

/** Below this, a brain is simply new, and every signal here would be noise. */
const MIN_PAGES = 8;

const DATE = /\b\d{4}-\d{2}-\d{2}\b/;

/**
 * A heading that IS a date, as opposed to one that MENTIONS when it happened.
 *
 * This distinction is the whole check, and getting it wrong inverts the result.
 * `## 2026-03-04` is a diary. `## The night the name landed (2026-08-09)` is a
 * titled section that says when — which is not merely allowed but ASKED FOR,
 * since the schema tells the agent to convert relative dates into absolute ones.
 * A rule counting any heading that CONTAINS a date penalises the exact behaviour
 * the product requires, and penalises it worst on the most carefully written
 * brains.
 *
 * Measured before this was fixed: 12 of 67 pages on a well-built brain, every
 * one a false positive, every one a page working exactly as designed. So the
 * test is what SURVIVES the date — it is a date heading only when removing the
 * date leaves almost nothing behind.
 */
export function isDateHeading(line) {
  const text = line.replace(/^#{2,6}\s+/, '');
  const words = (t) => t.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  const stripped = text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?(\s+\d{4})?/gi, ' ')
    .replace(/\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/g, ' ');

  const rest = words(stripped);
  if (rest === words(text)) return false; // there was no date in it at all

  return rest ? rest.split(/\s+/).filter(Boolean).length <= 2 : true;
}

/**
 * A page written as a diary rather than about a thing.
 *
 * Two shapes, because the failure arrives in two: headings that are dates, and
 * a body that is nothing but dated bullets. Both are legitimate in SMALL doses
 * — a History section is good practice and the shipped page templates include
 * one — so neither fires on presence. They fire on DOMINANCE.
 */
export function logShaped(text) {
  const lines = text.split('\n');

  const headings = lines.filter((l) => /^#{2,3}\s/.test(l));
  const datedHeadings = headings.filter(isDateHeading);
  if (headings.length >= 3 && datedHeadings.length / headings.length >= 0.5) {
    return { why: `${datedHeadings.length} of ${headings.length} headings are dates` };
  }

  // Body lines that carry meaning, so a page of frontmatter and links does not
  // divide by almost nothing and trip the ratio.
  const body = lines.filter((l) => l.trim() && !/^#{1,6}\s/.test(l) && !/^---/.test(l));
  const datedBullets = body.filter((l) => /^\s*[-*]\s/.test(l) && DATE.test(l));
  if (datedBullets.length >= 5 && datedBullets.length / body.length >= 0.6) {
    return { why: `${datedBullets.length} of ${body.length} body lines are dated entries` };
  }

  return null;
}

/**
 * The shape of the brain as a whole.
 *
 * `filed` is how many sources have been read — sessions, chats, documents. The
 * ratio against page count is the single most direct measurement of the one
 * rule the wiki prompt leads with: one page per THING, never one per session.
 */
export function shapeOf({ pages, inbound, filed, allow = new Set() }) {
  const signals = [];
  if (pages.length < MIN_PAGES) return { signals, judged: false };

  // Retirable per page, and it has to be. A brain is allowed ONE page that is
  // deliberately a chronology — measured on a real 67-page brain, that is
  // exactly what the single surviving hit was. Without a way to retire it the
  // check reports the same correct page forever, which is a permanent floor
  // under a report that must be able to reach zero. That is how a checker gets
  // muted, and a muted checker is worth nothing.
  const logs = [];
  for (const p of pages) {
    if (allow.has(`${p.rel}|LOGSHAPE`)) continue;
    const hit = logShaped(p.clean ?? p.text);
    if (hit) logs.push({ title: p.title, why: hit.why, rel: p.rel });
  }
  if (logs.length) {
    // A ratio as well as a count: two diary pages in a large brain is a couple
    // of pages to rewrite, and half the brain is a method that has gone wrong.
    const share = logs.length / pages.length;
    signals.push({
      kind: 'LOGSHAPE',
      what:
        `${logs.length} page${logs.length === 1 ? '' : 's'} written as a diary rather than about a thing` +
        ` — ${logs[0].title} (${logs[0].why})`,
      tell:
        share >= 0.3
          ? 'This is most of the brain, so it is the method rather than a few pages. ' +
            'Rewrite them around what was DECIDED and why, and say so to your user — ' +
            'a brain of dated entries answers nothing, however well it is linked.'
          : 'Rewrite each around what was concluded rather than when it happened. ' +
            'A History section is fine; a page that is only history is a log entry.',
      pages: logs.map((l) => l.title),
      retire: `${logs[0].rel}|LOGSHAPE`,
    });
  }

  if (filed >= 10) {
    const ratio = pages.length / filed;
    if (ratio > 0.8) {
      signals.push({
        kind: 'PAGEPERSESSION',
        what: `${pages.length} pages from ${filed} sources read — page count is tracking session count`,
        tell:
          'A batch of conversations is a few new things and many updates to things ' +
          'that already have pages. When the two numbers move together, sessions are ' +
          'being transcribed instead of folded in. Search before creating; updating ' +
          'beats creating.',
      });
    }
  }

  // No centre. A brain about a person has a page everything reaches toward, and
  // its absence is not a missing page — it is a brain that never composed one.
  if (pages.length >= 12) {
    let top = 0;
    for (const set of inbound.values()) {
      if (set.size > top) top = set.size;
    }
    if (top <= 2) {
      signals.push({
        kind: 'NOCENTRE',
        what: `no page is the centre of the graph — the most-linked page has ${top} inbound link${top === 1 ? '' : 's'}`,
        tell:
          'A brain about a person has a person page everything reaches toward. Draft ' +
          'it from what the brain already holds, then link the pages that explain ' +
          'them to it. Without a centre this is a set of notes that share a folder.',
      });
    }
  }

  return { signals, judged: true };
}
