# What a good page looks like

**This file is yours.** exposurie copied it in once and will never overwrite it.

Everything else here is rules. Rules produce median pages. This file shows the
thing itself, because the difference between a brain and an archive is a matter
of taste, and taste transfers by example far better than by instruction.

Read it once before writing your first pages. Come back to it when a page feels
thin and you cannot say why.

The person below is invented. Copy the *shape*, never the content.

---

## A worked entity page

Three sessions across a week produced this. Note what survived and what did not.

```markdown
---
type: entity
created: 2026-03-11
updated: 2026-04-02
tags: [tooling, decisions]
---

# The API client

The hand-rolled `fetch` wrapper every service call goes through. Replaced Axios
in March 2026 after six days, and the reason it was replaced is the useful part.

## Why it is not Axios

Axios was the default and went in without much thought. It came out because
retries had to be idempotent per-route, and expressing that meant wrapping
Axios anyway — so the wrapper was going to exist either way, and a dependency
that is entirely wrapped is a dependency that is only costing you.

**The stated reason at the time was bundle size. That was wrong and worth
recording**: the real cost was that the abstraction stopped one layer above
where the decisions had to be made. The same mistake is visible in the job
queue, chosen the same month and kept.

## What it does

Per-route retry policy, a timeout that covers the whole attempt rather than the
socket, and one place where auth refresh happens. Roughly 200 lines.

## What it cost

A week, and one production incident on 2026-03-19 — the refresh path had no
lock, so a token expiring under load produced a thundering herd against the
auth service. Fixed by a single-flight promise, which is now the only
interesting part of the file.

## Open questions

- Whether per-route policy earns its complexity, or whether two tiers would do.
  Raised 2026-04-02, undecided.

## Related

[[The Job Queue]] · [[Auth Refresh Incident]] · [[Dependencies Are Interfaces]]
```

### Why this one works

- **It leads with the relationship**, not the definition. "The wrapper every
  service call goes through" tells you why the page exists. "A wrapper around
  fetch" would not.
- **The motive is the longest section**, and it records a *reversal*: the
  reason believed at the time, and the reason that turned out to be true. That
  second sentence is the single highest-signal line on the page and it exists
  nowhere else — not in the code, not in the commits, not in a changelog.
- **It names what the decision cost**, including an incident. A brain that only
  records what worked is a brochure.
- **The open question is left open**, with a date. It is not resolved to make
  the page look finished.
- **It links to a concept page** — `Dependencies Are Interfaces` — which is
  where the pattern lives once it shows up a third time.

---

## A person page, the first two paragraphs

The person page is the centre of the graph and the hardest page to write. Most
attempts fail the same way: they become a CV.

```markdown
# Mara

Builds inventory software for small distributors, alone, mostly in the evenings
after contract work. Four years into a product that has never had more than
eleven customers and has never been abandoned — which is the fact that explains
most of the others.

Optimises for being able to hold the whole system in her head. This is stated
outright ("if I can't explain it on a whiteboard I don't want it") and it
predicts nearly every technical decision recorded here: the dropped ORM, the
refusal to split the monolith in 2025, the hand-rolled [[The API client]], the
one dependency she kept and the reason she kept it. Where a decision here looks
conservative, this is usually why, and where it looks reckless — the rewrite in
February — it is the same instinct running past its usefulness.
```

### Why this one works

- **It answers "who is this" in a way a CV cannot.** Eleven customers in four
  years is a fact about the person, not the business.
- **The second paragraph is a lens, not a list.** It gives a *rule* that makes
  the rest of the brain legible, then names pages it explains. Someone reading
  cold can now predict what they will find.
- **It includes the instinct failing**, in the same sentence as the instinct
  working. A person page with no cost recorded is a page nobody trusts.
- **It quotes her.** One sentence in her own words carries more than a
  paragraph describing her.

---

## Three ways a page goes wrong

**Log-shaped.** The most common failure and the one that ends the brain. Same
material as above, written as it arrived:

```markdown
## 2026-03-04
Worked on the API client. Tried Axios, hit an issue with retries.

## 2026-03-06
Switched to a fetch wrapper. Discussed timeouts.

## 2026-03-11
Fixed the retry logic, added tests.
```

Every fact is true and the page is worthless. **There is no decision in it** —
a reader cannot tell that a choice was made, what it was made against, or what
it cost. It cannot answer a question; it can only be re-read. And it grows
without limit, because every session adds a heading.

If your page has dates as headings and a paragraph under each, stop and ask
what was *concluded*. That is the page.

**CV-shaped.** True, flattering, and hollow: "Experienced in distributed
systems, passionate about clean architecture." No motive, no reversals, nothing
abandoned. A brain that only holds current work cannot describe a person,
because people are mostly explained by what they stopped doing.

**Duplicate-shaped.** The same fact on four pages. It gets corrected on one and
rots on three, and the brain now contradicts itself with nothing reporting it.
One fact lives on one page; everything else links to it.
