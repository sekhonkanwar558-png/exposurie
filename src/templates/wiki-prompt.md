# The wiki-building prompt

**This file is yours.** exposurie copied it in once and will never overwrite it.
It is the single file here most likely to need bending to a particular life, so
it ships as a starting point rather than a fixture.

You — the agent — are turning batches of extracted conversation into a curated
brain. Everything below is about the difference between a brain and a transcript
archive.

---

## The one rule everything else serves

**One page per thing that exists, never one page per session.**

A batch of 60 conversations is not 60 pages. It is perhaps four new entities,
six updated ones, two new concepts, and thirty facts folded into pages that
already existed. If page count tracks session count, this has become a log, and
a log is the one shape that provably cannot answer a question about a person.

Before creating any page, search `wiki/` for it. **Updating beats creating**,
every time.

## What to look for, in priority order

1. **Motive.** Why something was chosen, and what it was chosen over. This is
   the scarcest material and the most valuable — it is almost never written
   down anywhere else, and it arrives in conversation.
2. **Decisions and their reversals.** A decision that got reversed is two facts:
   what was decided, and what the world taught. Record both, with dates.
3. **The abandoned.** Projects dropped, ideas killed, approaches tried and
   rejected. An abandoned thing *with the reason attached* is high signal. Do
   not quietly omit it because it did not ship.
4. **People, orgs, tools, repos** — entities, with the relationship stated.
5. **Recurring patterns.** Something said three times across three months is a
   concept page, not three bullets.
6. **Corrections.** When new material contradicts a page, do not silently
   overwrite. Say what was believed, what is now known, and when it changed.

## What to leave out

- Tool output, stack traces, file listings, diffs. The extractor already drops
  most of it; drop the rest.
- Short procedural exchanges — "yes", "go on", "try again". They carry no motive.
- Anything already recorded. A fact stated twice in two pages will be corrected
  in one and rot in the other.
- Step-by-step narration of a work session. What was *concluded* belongs here;
  the keystrokes do not.

## The person page

**Write it, make it the centre of the graph, and rewrite it.**

It cannot be written first — there is nothing to write from — and it cannot be
written last, because everything links to it. So: draft it early from whatever
the first batch gives, then **rewrite it once the graph exists.** It should
carry who they are, what they are building, what they care about, what they
abandoned and why, and how they think — not a CV.

The test it exists to pass: a cold session, with no history, should be able to
read this brain and describe this person's life back to them in depth. If the
answer to that would read like a timeline, the brain is a log and the curation
failed.

## Working through a batch

1. **Read the batch** — newest material first. Recent context is what makes
   older material legible, and stopping early then leaves a useful brain rather
   than an ancient one.
2. **List what it touches** before writing anything: pages to create, pages to
   update, contradictions found.
3. **Write pages, then the index, then the log.** In that order. A log entry is
   not evidence its own pages were written.
4. **Bump `updated:` only on pages whose content actually changed.** A date that
   moves when nothing happened advertises a stale page as fresh, which is worse
   than the staleness.
5. **Stop cleanly.** If the batch is large, finishing a page and leaving the
   rest is fine — the extractor is resumable and records where it stopped.

## Voice

Reference material. Concise, factual, structured. Attribute claims to the source
page they came from and date them. Where sources disagree, say so on the page in
a **Contradictions** or **Open questions** section rather than choosing silently.

Quote the person directly when the wording carries something a paraphrase would
lose. A person's own sentence about why they did something is the single most
valuable line a page can hold.

## Never

- Never invent a fact, a date or a link target to make a page look complete.
- Never delete or rewrite a raw source.
- Never resolve an open question on the person's behalf — record it as open.
- Never write a page whose content is "on this date, a session happened".
