# The sync procedure

**This file is yours.** exposurie copied it in once and will never overwrite it.

Sync is **manual on purpose.** A background job that fails silently is worse
than no job at all — nothing tells you it stopped, and the brain rots while the
tooling reports success. So this runs when a person asks for it, and the state
line on every command is what stops anyone forgetting.

## Running it

```
exposurie sync
```

That command does the deterministic half: find what is new since the last run,
apply the exclusion policy in `.exposurie/config.json`, read the conversation
out of it, and stage a batch. **It does not write pages.** Writing pages is an
LLM job, and it is this file plus `.exposurie/wiki-prompt.md`.

It stages **whole sessions, newest first, up to a size budget**, so a first run
over years of history is a series of ordinary batches rather than one enormous
job. Nothing is dropped — what did not fit is reported and comes next.

## The procedure

1. **RUN `exposurie sync`.** It reports what is new and where it staged it. If
   nothing is new, say so and stop.
2. **Read the staged material** and fold it into the wiki, following
   `.exposurie/wiki-prompt.md`. Update existing pages before creating new ones.
3. **Update `index.md`** for every page created, renamed or deleted.
4. **Append one entry to `log.md`** describing what was folded in and which
   pages moved.
5. **RUN `exposurie sync --done`.** This advances the cutoff, and only then.

## Two things that are easy to get backwards

**The cutoff is advanced last, not first.** It is the only record of what has
been read. Moving it before the writing happens converts a crash into permanent
data loss.

`--done` will refuse if nothing in the brain has changed since the batch was
staged, because that means the pages were not written. It is checked rather than
claimed: nobody ticks a box, and an agent cannot close a batch by assuming it
worked. A refused `--done` costs nothing — the batch is still there, and running
it again after writing the pages works.

**Exclusion is a gate, not a cleanup.** Anything excluded is excluded *before*
the read — once material has been read, the cost has been paid and the privacy
is already gone. Exclusion policy lives in `.exposurie/config.json` and has two
independent axes:

- `excludeConversations` — folders whose conversations are not ingested at all.
  For work that is not part of this brain: coursework, a client under NDA.
- `excludeFiles` — paths whose *files* are never read as content, while
  conversations about them are kept. For a code repository living inside the
  brain folder: the code is not content, but the design discussion about it is
  some of the best material here.

They are independent, and one list cannot do both jobs. A single denylist gets
one of the two backwards.

## Backup

exposurie never creates a remote for you, and this is deliberate: getting a
visibility flag wrong once would make every conversation you have ever had with
an AI public, permanently. That decision stays yours.

Your brain is on one disk. `git init` ran at scaffold, so you have local history
and undo — which covers the common failure, an agent mangling a page. It does
not cover the disk dying. If you want a remote, configure one yourself and
exposurie will push to it.
