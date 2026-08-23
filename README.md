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

> **Status: early.** The output contract, the machine detector and `scaffold`
> work — you can create a brain and it is genuinely yours. The extractor, the
> librarian and the curator are not built yet, so nothing reads your sessions
> into pages. Nothing is published to npm. This repo is public so the design
> can be read and argued with while it is still cheap to change.

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
| the MCP server | **the wiki-building prompt** |
| the checker | page templates, exclude list |
| the config reader | every page you have |

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

Four of these enforce rules rather than check behaviour, and each was verified
by breaking the thing it guards and watching it fail:

- nothing in the shipped source can read stdin
- no personal data, private path or private tooling in any file in the repo
- `scaffold` cannot overwrite a file you have edited
- no output can name a command the tool does not have

## License

MIT — see [LICENSE](LICENSE).

*exposurie by sekhon*
