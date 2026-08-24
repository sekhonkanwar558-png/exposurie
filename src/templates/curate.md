# The curation procedure

**This file is yours.** exposurie copied it in once and will never overwrite it.

Curation is what keeps this a brain instead of an archive. It runs inside
`exposurie sync` — there is no separate command, and there is nothing to
remember — and it starts on the very first batch, because a brain that only
gets curated once the mess exists is a brain where the mess got there first.

It has two halves, split by what a machine can honestly decide.

## The half the tool does

`exposurie sync` runs it every time and prints the result. It reports dead
links, index drift, dates that lie about freshness, pages nothing links to,
sections the librarian cannot open, pages that cost more than one read, and
page names written in prose without a link.

It applies exactly two fixes without asking, and both are provably additive:

- **a stale `updated:`** — bumped to the date the page really changed. Metadata
  only; no prose is touched.
- **a first plain mention** — wrapped in `[[ ]]`. Four characters and one graph
  edge.

**It never deletes anything, and it never proposes deleting anything.** Curation
here means sorting signal from noise so the brain is *fetched* better, never
holding less. Even a page flagged as expensive means split it in two, not drop
half of it.

Everything else is reported and left alone, because everything else needs a
judgement: whether a dead link wants a new page or a corrected spelling, what an
index line should say, where a long page should be cut.

## The half you do — every sync, scoped to what changed

Do this over **the pages this batch touched**, not the whole brain. Scoped, it
costs almost nothing and runs forever. Unscoped, it becomes a rescue operation
nobody schedules.

1. **Contradictions.** Two pages that disagree about the same fact. Do not
   silently pick a side: say what was believed, what is now known, and when it
   changed. A contradiction recorded is worth more than a contradiction
   resolved, because the change of mind is the interesting part.
2. **Superseded claims.** A newer session overtook something an older page
   states as current. Mark it superseded on the page, with the date, and leave
   the old claim visible.
3. **A concept with no page.** Something named on three or more pages that has
   never been written down as a thing. That is a page waiting to exist, and it
   is usually the connective tissue the brain is missing.
4. **Near-duplicates.** Two pages circling the same subject. Merge toward the
   one with better inbound links; leave a link behind, never a hole.
5. **Act on the report.** Create the page a dead link wants, or fix the
   spelling. Add the index line. Link the orphan from the page it belongs to.

Then append one line to `log.md` saying what you curated, the same as any other
pass.

## When a finding is correct to leave alone

Some findings are **true and still correct as they are**. A page title that is
also an ordinary English word gets named in prose all the time, and linking it
would draw an edge between two unrelated things — worse than the missing edge it
claims to fix.

Reported forever, those put a permanent floor under the count, and a report that
can never reach zero is a report nobody reads. So retire them: append the key
the tool prints to `.exposurie/curate-allow.txt`, with a comment saying why.

**Retire a finding you have judged. Never retire one you have not read.** The
suppression count is printed on every run, so a growing allowlist is visible
rather than a quiet way of muting the thing.

## Two rules that are easy to get backwards

**Size is a prompt to look, not a verdict.** There is no line limit here and
there should not be one. What matters is whether every point of the brain can
still be reached — a long page whose every section opens in one command is fine,
and a short page nothing links to is not. Split a page when it has stopped being
*one thing*, never because it crossed a number.

**Never lose knowledge to a cleanup.** The shortest page in a brain is often an
abandoned idea with the reason attached, which is the highest-signal material
there is. A length rule eats the best pages first. If something genuinely has to
go, it goes by a person's decision, after it is committed to git.
