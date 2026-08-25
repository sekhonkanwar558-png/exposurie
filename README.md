# exposurie

**An external brain your coding agent builds, curates and reads for you.**

You already have a good coding agent. You are probably using a fraction of it —
thinking in a web chat, having the chat write you a prompt, pasting that into an
agent that knows nothing about you. Or dragging one session out over hundreds of
messages so it doesn't forget, until compaction eats the middle of it.

The fix is not a bigger context window. It is putting the memory **outside** the
session, so you can open a fresh one every time and lose nothing.

`exposurie` sets that up and gets out of the way:

- **A brain made of plain Markdown** — a linked wiki of who you are, what you are
  building, what you decided and why. Yours, on your disk, readable without us.
- **Built by your own agent.** No servers, no API keys, no per-user cost, nothing
  metered. The LLM work runs on the subscription you already pay for.
- **Read back on demand.** Your agent retrieves pages when it needs them instead
  of carrying everything in every session.

> **Status: early.** The chain works end to end — `init`, `scaffold`, `sync` and
> `read`. You can create a brain, fill it from Claude Code, Codex, Cursor and
> your claude.ai chat export in resumable batches, and open any page or any
> section of one in a single command. Curation runs inside every sync. Files are still not
> ingested: only conversation is read, so notes, documents and PDFs are stored
> and linked rather than folded in. The ChatGPT export has a reader that has not
> yet met a real export — see below. Nothing is published to npm. This repo is
> public so the design can be read and argued with while it is still cheap to
> change.

## Install

Not yet published. When it is:

```bash
npx @sekhon/exposurie init
```

Requirements: **a coding agent.** That is the whole list — Node arrives with
Claude Code. Obsidian and your chat export are steps the tool walks your agent
through, not things you need to arrive with.

## The unusual part: this CLI talks to your agent, not to you

Nearly every command-line tool assumes a human is watching the screen. This one
assumes **a model is reading the output and a person is somewhere behind it.**

You type one line into a session you already have open. Everything after that is
your agent working, and your agent is what talks to you. So the output is a task
list written for a model to execute:

```
exposurie  no brain yet

STATE
  brain        not created  (will go at ~/brain)
  claude-code  125 sessions   (~/.claude)
  codex        3 sessions   (~/.codex)
  cursor       2 found, NO READER YET — will be skipped   (~/.cursor)
  web chats    not found

DO THESE IN ORDER
  1. RUN:  exposurie scaffold --at ~/brain
      Creates the brain and copies in the schema, the page templates and the
      prompt that writes pages — those become the user's, and are never
      overwritten. Writes nothing else and reads no transcripts.
  2. ASK YOUR USER, in your own words:
      "Your brain is being built from the sessions on this machine right
      now. Your claude.ai web chats are not on here — want to grab those
      too? It takes about a minute of clicking, then a wait."
      Do NOT wait for an answer. Continue to the next step.

EXIT 10 — there is a step for your user. Nothing has failed.
```

Four consequences fall out of that, and they are the design:

**Nothing ever prompts.** When an agent runs a command there is nobody at the
keyboard. A tool that waits for input does not get input — it hangs, and the
agent looks frozen. There are no `[Y/n]` prompts anywhere in this codebase, and
a test enforces it.

**"Waiting on a person" is not a failure.** It has its own exit code, `10`, so an
agent can tell it apart from a crash instead of panicking or ignoring both.

**Human steps repeat until done, and are detected rather than marked.** The one
or two things your agent genuinely cannot do for you — mainly requesting your
claude.ai export, which needs your browser and your inbox — get re-reported at
the top of every command until the file actually appears on disk. They never
block anything.

**It never names a command it does not have.** Where the build stops, the output
says so in words. An agent that follows a plan into "no such command" has
learned the plan is not worth following, and it does not un-learn that when the
command ships — so a test greps every plan the tool can print and checks each
command against the real command table.

The full spec is in [`docs/output-contract.md`](docs/output-contract.md).

## What is yours and what is ours

An npm package sits frozen in `node_modules` and nobody edits it. That is right
for machinery and wrong for the prose describing a person's life. So setup writes
to two places with two owners:

| **ours** — in the package, we update it | **yours** — copied into your brain, yours forever |
|---|---|
| the librarian (search, page, section) | the schema |
| the extractor | the sync procedure |
| the curator's checks, and its two safe fixes | **the wiki-building prompt** |
| the pointer that tells your agent this exists | the curation procedure, and the findings you have retired |
| the config reader | page templates, exclude list, every page you have |

The wiki-building prompt is the closest thing here to secret sauce, and it is
deliberately yours — a researcher's brain and a founder's brain want different
page types, and locking the one file that most needs to change is the wrong
trade. It ships as a starting point, not a fixture.

**"Yours" is enforced, not promised.** `scaffold` never overwrites a file that
exists. Run it again and it tops up what is missing and prints what it left
alone, so a schema you have tuned cannot be silently replaced by a command that
looks idempotent. A test pins that.

**The two halves meet at one config file**, at `<brain>/.exposurie/config.json`.
The code hardcodes nothing about your folder layout — it reads the category
names from there. So if `wiki/people` suits you better, rename the folder, say
so in that file, and search follows you. Without that seam the failure is
silent: renaming a folder would make half the brain invisible with nothing
reporting it.

## It works out your setup and talks to that

Two people run the same command and get different instructions, because they
have different lives on their disks.

|  | it finds | it asks them for | it never mentions |
|---|---|---|---|
| **Claude Code user** | `~/.claude` transcripts | their claude.ai export | ChatGPT |
| **Codex user** | `~/.codex` rollouts | their ChatGPT export | claude.ai |
| **Cursor user** | its SQLite chat store | their ChatGPT export | claude.ai |
| **Neither** | nothing local | their claude.ai export | — |

The rule underneath: **a step that a person can never complete is worse than no
step at all.** Asking a Codex user on a Mac for a claude.ai export produces a
request that cannot resolve, so it reprints at the top of every command forever
— and teaches them the tool does not notice what they do. So every human step
declares not only how it is *detected as done* but whether it *applies to this
person at all*.

The same rule runs down to the small things. Install instructions print the one
package manager for the OS you are on, not three with a note to pick. The step
that gets you into Obsidian names the exact folder your brain is in, because the
tool knows it and you should not have to go looking.

Exports are identified by **what is inside the zip**, never by its name —
Anthropic's is reliably `data-*.zip` and OpenAI's is reliably nothing, so a
filename rule would miss every ChatGPT export. The trade is that a corrupt
archive matches nothing and would vanish; so a zip that *looks* like an export
and will not open is reported as broken rather than silently skipped.

## Reading a claude.ai export, and what is actually in one

A chat export is not a side channel. Measured on one real account: **264 KB of
that person's own typed words on the web, against 166 KB across every Claude
Code session on their machine.** For anyone who has not spent a year in a
terminal, it is not 1.6x — it is all of it.

Four things come out of one zip, and only the first is chat:

- `conversations.json` — the chats.
- `memories.json` — what claude.ai has already worked out about you. Prose,
  already distilled, the highest signal per byte in the archive.
- `projects/*.json` — the instructions you wrote for your own projects.
- `design_chats/*.json` — the same shape as a conversation, under another name.

The last three are **standing context**: small, about you rather than about a
moment, and read *before* the batch rather than queued behind a year of history.
Reading only `conversations.json` would leave the two most concentrated files in
the archive on the floor.

Zip reading is ours, in about 200 lines against `node:zlib`, because one
container is not worth spending the zero-dependency property on. It opens a
single entry rather than the archive, so a 16 MB `conversations.json` is the
only thing ever decompressed.

**The finding that came out of pointing it at a real export:** 66 of 93
conversations arrived with messages and not one word of text in them — no title,
no summary, nothing. The file was named `batch-0000`. Anthropic splits a large
account across numbered zips and only the first had been downloaded. Nothing
about that is an error, which is the danger: the conversations are present, the
count looks right, and a reader treating them as "nothing said" would mark four
months of someone's life as read and never look again. They are reported and
left unread instead, so a fuller export picks them up.

**ChatGPT is different, and the README should say so.** Every other reader here
was written against a real file. That one was not — there was no ChatGPT export
on the machine it was built on. So its safety is not confidence in the parse: an
archive that holds conversations and yields no words from any of them is
reported as **a bug in exposurie**, by name, rather than as an empty account. If
the shape is wrong, the first person to run it finds out, instead of getting a
brain that quietly contains nobody.

## Cursor keeps its chats in SQLite, so we read SQLite

Cursor does not write transcript files. `~/.cursor/projects/*/agent-transcripts/`
looks exactly like it should hold them and is **empty** — the previous release
counted those directories and reported "2 found, NO READER YET", which was an
honest statement about a reader it lacked and a wrong one about what was there.

The conversations are in `state.vscdb`, in a key/value table: `composerData:<id>`
for the conversation and its message *order*, `bubbleId:<composer>:<id>` for each
message. Everything else in a message is tool work — measured on a real
database, 443 messages held 103 with any text and 31 from the person.

So there is a SQLite reader here, in about 300 lines against no dependencies. It
is read-only and understands exactly enough to walk one table: the header, the
`sqlite_master` b-tree, table pages, the record format, **overflow chains** —
a conversation blob does not fit in one page, and ignoring the chain returns
truncated JSON that fails to parse and looks like a corrupt database rather than
like our bug — and the **write-ahead log**, because Cursor is usually running
and its newest conversations have not reached the main file yet.

Shelling out to a `sqlite3` binary would have been shorter and would have failed
on every machine without one, silently reporting that the person has no Cursor
history.

## What sync actually reads

A transcript is mostly not conversation. Measured across a real 128 MB corpus of
127 Claude Code sessions: tool results, tool calls, attachments, file snapshots
and thinking are about 99% of the bytes. What a person and their agent actually **said** to
each other is around 1%. Dropping the rest is an **84× reduction that costs
nothing**, because none of it carries motive — and motive is the whole reason a
brain is worth having.

**The same doctrine, twice over.** Codex writes a completely different format
and had been listed as readable with no reader of its own: the Claude Code
parser was handed its rollouts, returned zero turns from every one, and the sync
marked them read. The session count was right the whole time. The reader now
lives *in* the client table, so "readable" and "there is a function that reads
it" are one statement — and a test holds them together.

The filter that matters most is not the obvious one. Text arrives wearing a
`user` role that no person typed — injected context, environment blocks, hook
output, slash-command echoes, tool results, subagent chatter — and on that same
corpus it outweighed the human's own words **nine to one**. A reader that trusts
`role: "user"` builds someone a brain mostly out of directory listings, and it
looks like it is working the entire time.

Three more things sync does because a first run happens before anyone has a
reason to trust it:

- **Whole sessions, newest first, up to a size budget.** History is never
  truncated — it is *ordered*, and what did not fit is reported and comes next.
  A year of history is a series of ordinary batches, not one enormous job
  against your own plan quota at minute one.
- **Exclusion is a gate, not a cleanup.** Anything on your exclude list is never
  opened past the few KB needed to see which folder it belongs to. Filtering
  after the read is an apology, not a control.
- **The cutoff moves last, and on evidence.** `sync --done` refuses to advance
  if nothing in the brain changed, because that means the pages were not
  written. An interrupted sync re-stages its material rather than losing it.

Anything shaped like an API key is removed on the way in, and the count is
reported — a silent redaction is indistinguishable from a bug that ate a
paragraph.

## One command, and curation rides inside it

After setup there is **one command you ever type**. Everything that makes the
brain better is a stage of it rather than a sibling to it, and curation runs
from the very first batch — a brain that only gets curated once the mess exists
is a brain where the mess got there first.

The tool does the half a machine can decide: dead links, index drift, dates that
lie about freshness, pages nothing links to, sections the librarian cannot open.
It applies exactly two fixes without asking, both provably additive — bumping an
`updated:` date git proves is wrong, and wrapping a first plain mention in
`[[ ]]`. **It never deletes anything and never proposes deleting anything.**
Curation here means sorting signal from noise so the brain is *fetched* better,
never holding less.

Everything else is reported, because everything else needs a judgement: whether
a dead link wants a new page or a corrected spelling, what an index line should
say, where a long page should be cut. Two pages that disagree, a claim a newer
session superseded, a concept named on five pages that has none of its own — that
half is a procedure file in your brain, so you can change it.

Two things it deliberately does not do:

- **It has no page-size limit.** Length was always a proxy. What is actually
  checked is whether every point of the brain can still be *reached* — and the
  outline of a long page carries the exact command that opens each section, so a
  long page is fine. Size is reported as a number, never as a finding.
- **It lets a finding be retired.** Some findings are true and still correct to
  leave alone: a page title that is also an ordinary English word gets written
  in prose constantly, and linking it would draw an edge between unrelated
  things. Reported forever, those put a floor under the count — and a report
  that can never reach zero is a report nobody reads. The tool prints the exact
  line that retires one, and always prints how many are retired.

## Privacy

Your brain is **local files on your disk.** Nothing is uploaded, there is no
account, and there is no server to send anything to.

`exposurie` never creates a backup remote for you. It runs `git init` on your
brain so you get local history and undo, warns you that it lives on one disk, and
will push to a remote **you** configured. Creating that remote is a decision with
one irreversible failure mode — a visibility flag wrong once and every
conversation you have ever had with an AI is public — so it stays yours to make.

## Development

```bash
npm test
```

Zero runtime dependencies. Node 20+.

Some of these enforce rules rather than check behaviour, and each was verified
by breaking the thing it guards and watching it fail:

- every client that claims to be readable has a reader behind it
- nothing in the shipped source can read stdin
- no personal data, private path or private tooling in any file in the repo
- `scaffold` cannot overwrite a file you have edited
- no output can name a command the tool does not have
- text that only looks like something you typed never reaches your brain
- an excluded conversation is never opened, not merely dropped afterwards
- the sync cutoff moves on evidence that pages exist, never on a claim

## License

MIT — see [LICENSE](LICENSE).

*exposurie by sekhon*
