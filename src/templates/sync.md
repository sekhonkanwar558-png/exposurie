# The sync procedure

**This file is yours.** exposurie copied it in once and will never overwrite it.

Sync is **manual on purpose.** A background job that fails silently is worse
than no job at all — nothing tells you it stopped, and the brain rots while the
tooling reports success. So this runs when a person asks for it, and the state
line on every command is what stops anyone forgetting.

> **Not in the installed version yet.** The `sync` command described below is
> not built, so do not try to run it — this file is the procedure it will
> follow, kept here because the procedure is yours to adjust and predates the
> command. Everything else in your brain works.

## Running it

The command does the deterministic half: find what is new since the last run,
apply the exclusion policy in `.exposurie/config.json`, stage it, and record how
far it got. **It does not write pages.** Writing pages is an LLM job, and it is
this file plus `.exposurie/wiki-prompt.md`.

## The procedure

1. **Stage what is new.** It reports what is new and where it staged it. If
   nothing is new, say so and stop.
2. **Read the staged material** and fold it into the wiki, following
   `.exposurie/wiki-prompt.md`. Update existing pages before creating new ones.
3. **Update `index.md`** for every page created, renamed or deleted.
4. **Append one entry to `log.md`** describing what was folded in and which
   pages moved.
5. **Advance the cutoff — only after the pages are actually written.** An
   abandoned sync must not advance it, or the material it staged is dropped
   forever with nothing reporting the loss.

## Two things that are easy to get backwards

**The cutoff is advanced last, not first.** It is the only record of what has
been read. Moving it before the writing happens converts a crash into permanent
data loss.

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
