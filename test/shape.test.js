// Tests for the shape pass — the one check that asks whether this is a brain.
//
// Every other curator check asks whether the graph is CONSISTENT, and all of
// them pass on a pile of session logs that happens to be well linked. This one
// asks the question the product actually exists to answer, and it is the only
// check here that cannot be verified by looking at a single line.
//
// It is also the check most likely to become an annoyance, because it comments
// on how somebody writes. So the calibration target is explicit and it is not a
// threshold: ON A WELL-BUILT BRAIN THIS MUST REPORT ALMOST NOTHING. Measured
// against a real 67-page brain during the build, the first version reported 12
// pages and every one was a false positive. That number is a test below.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isDateHeading, logShaped, shapeOf } from '../src/shape.js';

const page = (title, text, rel = `wiki/entities/${title}.md`) => ({ title, rel, text, clean: text });

/** n plausible non-diary pages, so whole-brain checks have something to run on. */
function realBrain(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(
      page(
        `Thing ${i}`,
        `# Thing ${i}\n\n## What it is\n\nA component.\n\n## Why it is here\n\nChosen over the alternative because the abstraction stopped too high.\n`,
      ),
    );
  }
  return out;
}

const inboundOf = (pages, counts = {}) =>
  new Map(pages.map((p) => [p.title, new Set(Array.from({ length: counts[p.title] || 0 }, (_, i) => `x${i}`))]));

// ------------------------------------------------------- the distinction
test('a heading that mentions when it happened is not a diary heading', () => {
  // The whole check turns on this, and getting it backwards inverts the result:
  // the schema tells the agent to convert relative dates to absolute ones, so a
  // rule that counts any heading CONTAINING a date punishes the exact behaviour
  // the product asks for — and punishes the best-written brains hardest.
  assert.equal(isDateHeading('## The install model: the tool talks to the agent (2026-08-21)'), false);
  assert.equal(isDateHeading('## The night the name landed — and it rewrote its own soul (2026-08-09)'), false);
  assert.equal(isDateHeading('## Renamed one day later (2026-08-09)'), false);
  assert.equal(isDateHeading('## What it is'), false);

  // And these are diary headings.
  assert.equal(isDateHeading('## 2026-03-04'), true);
  assert.equal(isDateHeading('## 2026-03-04 — session'), true);
  assert.equal(isDateHeading('## March 4, 2026'), true);
});

test('the real page that produced the false positives is not flagged', () => {
  // Taken from a page that was flagged by the first version and is one of the
  // most decision-dense pages in the brain it came from. If this regresses, the
  // check is punishing structure again.
  const text = [
    '# Architecture',
    '',
    '## The install model: the tool talks to the agent, not the user (2026-08-21)',
    'Prose about the decision and what it was chosen over.',
    '',
    '## Ours and theirs: what the package owns (2026-08-21)',
    'More prose about a decision.',
    '',
    '## How it is delivered (2026-08-21)',
    'Reasoning.',
    '',
    '## Retrieval has two halves, and only one ports (2026-08-22)',
    'Reasoning.',
  ].join('\n');
  assert.equal(logShaped(text), null);
});

test('a page that is actually a diary is flagged', () => {
  const text = [
    '# The API client',
    '',
    '## 2026-03-04',
    'Worked on it. Tried a library.',
    '',
    '## 2026-03-06',
    'Switched approach.',
    '',
    '## 2026-03-11',
    'Fixed the retry logic.',
  ].join('\n');
  const hit = logShaped(text);
  assert.ok(hit, 'a page of date headings was not flagged');
  assert.match(hit.why, /3 of 3 headings are dates/);
});

test('a History section does not make a page a log', () => {
  // The shipped page template contains a dated History list. If the presence of
  // dated bullets were enough, every page written to our own template would be
  // reported, which is the permanent-floor failure arriving on day one.
  const text = [
    '# The job queue',
    '',
    '## What it is',
    'Prose that explains the thing, at some length, so the body is mostly words.',
    'More explanation of why it exists and what it replaced when it was chosen.',
    'A third line of reasoning about the trade that was made and what it cost.',
    '',
    '## History',
    '- **2026-03-04** — chosen over the alternative.',
    '- **2026-04-01** — retry policy added.',
  ].join('\n');
  assert.equal(logShaped(text), null);
});

// ------------------------------------------------------- the calibration
test('a well-built brain reports nothing', () => {
  // The number that matters. A check commenting on how someone writes has one
  // job before any other: be silent when they are writing well.
  const pages = realBrain(20);
  const { signals } = shapeOf({ pages, inbound: inboundOf(pages, { 'Thing 0': 9 }), filed: 40 });
  assert.deepEqual(signals, [], `a clean brain produced ${signals.length} signal(s)`);
});

test('a brain too young to judge is not judged', () => {
  const pages = realBrain(4);
  const r = shapeOf({ pages, inbound: inboundOf(pages), filed: 40 });
  assert.equal(r.judged, false);
  assert.deepEqual(r.signals, []);
});

// ------------------------------------------------------- the three signals
test('page count tracking session count is reported', () => {
  // The direct measurement of the one rule the wiki prompt leads with.
  const pages = realBrain(30);
  const { signals } = shapeOf({ pages, inbound: inboundOf(pages, { 'Thing 0': 9 }), filed: 32 });
  const s = signals.find((x) => x.kind === 'PAGEPERSESSION');
  assert.ok(s, 'one page per session was not reported');
  assert.match(s.what, /30 pages from 32 sources/);
});

test('a brain with no centre is reported', () => {
  const pages = realBrain(20);
  const { signals } = shapeOf({ pages, inbound: inboundOf(pages, { 'Thing 0': 2 }), filed: 60 });
  assert.ok(signals.find((x) => x.kind === 'NOCENTRE'), 'a centreless graph was not reported');
});

test('a diary page can be retired, because one chronology is legitimate', () => {
  // A real brain is allowed a page that is deliberately a timeline. Reported
  // forever, that is a floor under a report which must be able to reach zero —
  // the failure that retired the old size rule, repeating in a new check.
  const diary = page(
    'Timeline',
    '# Timeline\n\n## 2026-03-04\nA day.\n\n## 2026-03-05\nAnother.\n\n## 2026-03-06\nAnother.\n',
    'wiki/syntheses/Timeline.md',
  );
  const pages = [...realBrain(15), diary];
  const inbound = inboundOf(pages, { 'Thing 0': 9 });

  const before = shapeOf({ pages, inbound, filed: 60 });
  assert.ok(before.signals.find((x) => x.kind === 'LOGSHAPE'), 'the diary page was not flagged');

  const after = shapeOf({
    pages,
    inbound,
    filed: 60,
    allow: new Set(['wiki/syntheses/Timeline.md|LOGSHAPE']),
  });
  assert.equal(after.signals.find((x) => x.kind === 'LOGSHAPE'), undefined, 'retiring it did not work');
});

test('the signal carries the key needed to retire it', () => {
  // A finding that cannot be retired from its own output is one nobody retires.
  const diary = page(
    'Timeline',
    '# Timeline\n\n## 2026-03-04\nA day.\n\n## 2026-03-05\nAnother.\n\n## 2026-03-06\nAnother.\n',
    'wiki/syntheses/Timeline.md',
  );
  const pages = [...realBrain(15), diary];
  const { signals } = shapeOf({ pages, inbound: inboundOf(pages, { 'Thing 0': 9 }), filed: 60 });
  const s = signals.find((x) => x.kind === 'LOGSHAPE');
  assert.equal(s.retire, 'wiki/syntheses/Timeline.md|LOGSHAPE');
});

// ------------------------------------------------------------ the contract
test('the shape pass never fixes anything', () => {
  // The observability design in one assertion. We never see a stranger's brain,
  // so the only party who can judge this is the person next to it — and a check
  // that quietly rewrote their pages would be making the judgement it just said
  // it could not make.
  const diary = page(
    'Timeline',
    '# Timeline\n\n## 2026-03-04\nA day.\n\n## 2026-03-05\nAnother.\n\n## 2026-03-06\nAnother.\n',
    'wiki/syntheses/Timeline.md',
  );
  const before = diary.text;
  const pages = [...realBrain(15), diary];
  shapeOf({ pages, inbound: inboundOf(pages, { 'Thing 0': 9 }), filed: 60 });
  assert.equal(diary.text, before, 'the shape pass mutated a page');

  for (const s of shapeOf({ pages, inbound: inboundOf(pages, { 'Thing 0': 9 }), filed: 60 }).signals) {
    assert.ok(s.tell, `[${s.kind}] has nothing to tell the user`);
  }
});
