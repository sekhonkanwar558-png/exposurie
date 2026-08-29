// Human steps: the few things an agent genuinely cannot do for its user.
//
// The design constraint that shapes this whole file: the first run reads
// silently and auto mode blows past the terminal, so a step that is merely
// PRINTED is a step that gets buried and never returns. Four requirements come
// out of that, and each maps to something here:
//
//   1. exact words, not the topic   -> `verbatim`, relayed without paraphrase
//   2. write it to disk as well     -> record()
//   3. repeat until done            -> unresolved(), called by every command
//   4. never block                  -> nothing here is awaited, ever
//
// "Done" is DETECTED, never marked. Nobody has to remember to tick a box, and
// a step cannot be falsely closed by an agent that assumed it worked.
//
// There is exactly one exception, and it is the third state below: DECLINED.
// A person can say no, and no amount of looking at the disk will ever detect
// that. Without it requirement 3 eats itself — "repeat until done" becomes
// "repeat forever" for anything the user has decided against, which is the
// cries-wolf failure this catalog was built to avoid, arriving through the one
// door the design was most careful about. Declining is NOT done, never makes
// `resolved` true, and is written in the user's own words to a file in their
// own brain that they can delete to bring the step back.

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { KEEP_YEARS_DAYS } from './context.js';
import { cmd } from './install.js';

/**
 * The catalog. Every human step in the product is declared here and nowhere
 * else, so the exact wording is reviewable in one place.
 *
 * resolved(ctx) -> boolean   : detected from disk, never from a claim
 * applies(ctx)  -> boolean   : whether this step is relevant to this person
 *
 * A third thing closes a step and is not a field here, because it is not a
 * property of the step: DECLINED, recorded per-brain on disk by decline().
 * The three are different questions — "has it happened", "is it relevant",
 * "was it refused" — and collapsing any two of them loses a real case.
 *
 * `applies` is separate from `resolved` and the distinction is load-bearing. A
 * step that does not apply is not a step waiting to be done — it is a step this
 * person will never do, and the two look identical to a detector. Asking a
 * Codex user on a Mac with no Claude account for their claude.ai export
 * produces a request that CANNOT resolve: it reprints at the top of every
 * command forever, for a file that will never exist. That is the "cries wolf"
 * failure the curator was designed around, arriving through the one part of the
 * product that talks directly to a person.
 */
/**
 * Is this client actually where the person works, or did they just try it once?
 *
 * THE FAILURE THIS EXISTS FOR, measured on a real machine. `init` correctly
 * detected 6 Claude Code sessions, 165 Codex and 11 Cursor — and then asked for
 * a claude.ai export, offered to change Claude Code's retention, and NEVER
 * asked for the ChatGPT export holding 1,164 conversations. Nothing was
 * mis-detected. The counts were right there and every gate below read them as a
 * boolean: `present`. Six stale transcripts, 3% of the corpus, outvoted 165.
 *
 * That is not a detection bug, it is a RANKING bug, and it is the one this
 * product keeps rediscovering — the wrong answer wearing the shape of a right
 * one. So presence stops being the question and share becomes it.
 *
 * The two export gates used to be a mutually exclusive pair hinged on Claude
 * Code being present, which made "asked for the wrong one" and "never asked for
 * the right one" the SAME bug: a machine with both clients could only ever be
 * asked for claude.ai. They are independent now, because a person who genuinely
 * uses both genuinely has both histories, and both asks can be satisfied.
 *
 * Fallbacks, in order, each for a case share cannot answer:
 *   nothing installed  -> everything applies. The web is all they have and we
 *                         have no way to guess which vendor; guessing wrong
 *                         silently loses their entire history, which is far
 *                         worse than one ask they can decline in one command.
 *   installed, no runs -> presence is the only signal there is, so use it.
 */
const usable = (ctx) => (ctx.clients || []).filter((c) => c.present && c.readable);

/**
 * One fifth. A client holding 20% of somebody's AI conversation is somewhere
 * they work; 3% is somewhere they looked once. Picked so the machine that
 * exposed this — 6 against 176 — lands clearly on the right side rather than
 * near the line, and so an even split asks for both.
 *
 * This is ours to decide and never the user's: a threshold in a config file is
 * a question we declined to answer and billed to a stranger.
 */
export const MATERIAL_SHARE = 0.2;

export function material(ctx, id) {
  const clients = usable(ctx);
  if (clients.length === 0) return true;
  const me = clients.find((c) => c.id === id);
  if (!me) return false;
  const total = clients.reduce((n, c) => n + (c.count || 0), 0);
  if (total === 0) return true;
  return (me.count || 0) / total >= MATERIAL_SHARE;
}

/**
 * How this person installs an app, on the machine they are actually on.
 *
 * `process.platform` is a fact we already have. Printing the other two
 * platforms' commands next to it makes the user do the filtering, and makes the
 * agent guess at something that was never in question.
 */
function installObsidian() {
  if (process.platform === 'darwin') return '  brew install --cask obsidian';
  if (process.platform === 'win32') return '  winget install Obsidian.Obsidian';
  return '  flatpak install flathub md.obsidian.Obsidian';
}

/**
 * Show them the brain, and treat installing an app as the optional part.
 *
 * Installing Obsidian was never the step — SEEING the brain is. That was
 * already written here, and the ORDER contradicted it: the first line was
 * `brew install`, and opening the folder was the consolation prize at the
 * bottom under "if Obsidian will not install".
 *
 * What that produced on a real machine: Homebrew hung on a GitHub metadata
 * request, the agent killed it, tried an in-app browser, hit a download
 * security block, and only then opened the folder — while the person waited.
 * The install was eventually done by hand by somebody else. Every second of
 * that was spent before the user had seen a single page of their own brain,
 * and none of it was necessary, because the folder was openable the whole time.
 *
 * So the guaranteed win goes first and the fallible step goes second, bounded.
 * An agent told to install software will keep trying routes until one works —
 * that is the behaviour we want almost everywhere and it is wrong here, where
 * the thing being retried is optional and the person is watching.
 */
function openTheBrain(ctx = {}) {
  const where = ctx.vault;
  const open =
    process.platform === 'darwin'
      ? `  open "${where}"`
      : process.platform === 'win32'
        ? `  explorer "${where}"`
        : `  xdg-open "${where}"`;

  // No brain yet — this step can be shown by `init`, which runs before one
  // exists. The old fallback substituted the words "the brain folder" into the
  // path and printed `explorer "the brain folder"`: a quoted placeholder in the
  // shape of a runnable command, which is the exact failure this whole pass is
  // about. Say the true thing instead; the scaffold step above supplies the
  // path, and by the time anyone answers this question it will be real.
  const first = where
    ? ['FIRST, and this always works — open their brain for them:', open, '',
       `That is it on screen: plain Markdown, ${where}. Everything below is`,
       'optional, and nothing is blocked if it fails.']
    : ['FIRST, open their brain for them — it always works. The brain does not',
       'exist yet; the scaffold step creates it, and that folder is the path.',
       'Opening it is the whole payoff and it cannot fail. Everything below is',
       'optional.'];

  return [
    ...first,
    '',
    'THEN offer the graph view. Obsidian is free and opens the folder as-is:',
    installObsidian(),
    '',
    'ONE attempt. If it stalls, asks for a password, or the download is',
    'blocked, STOP and say so plainly — their brain is already open and',
    'Obsidian can wait. Do NOT try a second package manager, do NOT route',
    'around a blocked download, and do NOT leave an installer running while',
    'they watch. A person three minutes into a progress bar has learned that',
    'this tool is work.',
    '',
    'If it did install, walk them in. These four, in order:',
    '  1. Open Obsidian.',
    '  2. Click "Open folder as vault".',
    '  3. Choose this exact folder:',
    `       ${where || '(the folder the scaffold step creates)'}`,
    '  4. Trust the vault when it asks. Nothing here runs code.',
    '',
    'Then tell them to press Ctrl+G (Cmd+G on a Mac) for the graph view. That',
    'is the picture of their own head, and it is the moment this stops feeling',
    'like a folder of notes.',
    '',
    'If they are happy reading Markdown without it, that is a real answer and',
    'not a failure. Record it with the decline line below so it stops asking.',
  ];
}

export const STEPS = {
  /**
   * The step that is not about getting more material — it is about not losing
   * the material they already have.
   *
   * Claude Code deletes its own transcripts after `cleanupPeriodDays`, default
   * 30. This was found by trying to read three project folders that turned out
   * to hold no transcripts at all, on a machine where the oldest surviving file
   * was 29 days old and sessions filed six weeks earlier had simply gone.
   *
   * So "exposurie reads everything you have" was never true for the local half,
   * and the honest version is a better pitch: without this, a third of a year
   * of someone's thinking is deleted on a rolling basis by a cleanup they have
   * never heard of.
   *
   * WHY THE AGENT DOES IT AND WE DO NOT: `settings.json` is machine-parsed and
   * belongs to another vendor. Corrupt it and their tool breaks silently with
   * us the last to touch it — the same reasoning that kept us out of MCP client
   * config. Their own agent editing one key of their own settings, after they
   * say yes, is a different act with a different owner.
   *
   * AND WHY IT ASKS AT ALL, given that we normally decide: this changes how
   * software we do not own behaves on their disk. Deciding for the user is
   * right when the decision is about OUR tool. It is never right here.
   */
  'claude-code-retention': {
    id: 'claude-code-retention',
    title: 'Claude Code is deleting your history every 30 days',
    why:
      'Claude Code removes its own transcripts after 30 days by default. That ' +
      'happens whether or not exposurie is installed, and everything older is ' +
      'already gone. One line in their settings keeps them instead — after ' +
      'that, this brain stops depending on another tool\'s cleanup schedule.',
    ask:
      'Quick thing worth knowing: Claude Code deletes your session transcripts ' +
      'after 30 days, so anything older than that is already gone. I can change ' +
      'one setting to keep them for ten years instead — want me to?',
    onYes: (ctx) => [
      'ONLY IF THEY SAID YES. Ask first, in the conversation, and wait for a',
      'real answer — this edits a file belonging to software we do not own, on',
      'their machine, and silence is not consent. If they said no, or did not',
      'answer, record it instead:',
      `    ${cmd('decline claude-code-retention')} --because "<their words>"`,
      '',
      `Edit ${ctx.settings || '~/.claude/settings.json'} and set:`,
      `    "cleanupPeriodDays": ${KEEP_YEARS_DAYS}`,
      '',
      'Keep every other key exactly as it is, and keep the file valid JSON —',
      'if it will not parse, Claude Code stops reading its own settings. Create',
      'the file with just that one key if it does not exist yet.',
      '',
      'This changes nothing about how Claude Code runs. It only stops the',
      'delete. Tell them it is done, and that old transcripts are not coming',
      'back — this protects what they have from here on.',
    ],
    doneWhen: 'cleanupPeriodDays is set to a year or more in that file',
    resolved: (ctx) => (ctx.retention?.days ?? 0) >= 365,

    /**
     * Only where the deletion is real, AND only where it would cost something.
     *
     * Presence alone was the old gate, and it offered a stranger an edit to
     * another vendor's settings file to protect 6 sessions out of 182. This
     * step's value is proportional to what is being deleted: on a machine where
     * Claude Code is 3% of the corpus there is nearly nothing to lose, and we
     * are asking to touch a file we do not own to save it.
     *
     * Nothing is lost by waiting. `unresolved` runs on EVERY command, so a
     * person who later moves onto Claude Code crosses the threshold and gets
     * asked then — which is also the moment the answer actually matters.
     */
    applies: (ctx) =>
      usable(ctx).some((c) => c.id === 'claude-code') && material(ctx, 'claude-code'),
  },

  'claude-web-export': {
    id: 'claude-web-export',
    title: 'claude.ai chat export',
    why:
      'Your claude.ai web conversations live on Anthropic servers, not on this ' +
      'disk. There is no API for your own chat history, so only you can request ' +
      'them — it needs your logged-in browser and your inbox.',
    ask:
      'Your brain is being built from the sessions on this machine right now. ' +
      'Your claude.ai web chats are not on here — want to grab those too? It ' +
      'takes about a minute of clicking, then a wait.',
    verbatim: [
      '1. Open claude.ai in your browser and sign in.',
      '2. Click your initials at the bottom-left, then Settings.',
      '3. Open the Privacy tab.',
      '4. Click "Export data".',
      '5. Anthropic emails you a download link. This can take a few HOURS.',
      '   Nothing appears on screen. It has not failed — close the tab.',
      '6. When the email arrives, download the .zip into your Downloads folder',
      '   and leave it there. It does not need unzipping, and unzipping it is',
      '   fine — exposurie reads the folder as readily as the zip.',
      '7. IF THE EMAIL HAS MORE THAN ONE LINK, download every one of them.',
      '   A large account is split across numbered zips (batch-0000,',
      '   batch-0001...). Taking only the first looks complete and is not:',
      '   the older conversations are LISTED in it with their text missing.',
    ],
    doneWhen: 'a data-* export appears in Downloads — the zip, or the folder if they unpacked it',
    resolved: (ctx) => (ctx.exports?.length ?? 0) > 0,

    /**
     * Ask when Claude is materially where they work — see material() above.
     *
     * The old gate was `some client is claude-code`, paired with its exact
     * negation on the ChatGPT step. That pairing is what made one machine
     * produce both halves of the bug at once: Claude Code present at 3% won the
     * claude.ai ask AND suppressed the ChatGPT one. The comment here used to
     * name the cost as "a Codex user who also uses claude.ai will not be asked
     * — a missed import." The shipped failure was the mirror of that, and it
     * was the larger one. Both are gone: the two steps are independent now.
     *
     * There is deliberately no "…or an export already exists" clause here, and
     * that omission is load-bearing rather than an oversight: `resolved` above
     * already returns true the moment one is on disk, so such a clause could
     * never change an outcome. An inert condition that reads like a safeguard
     * is worse than no condition — it is the next thing somebody trusts.
     *
     * Finding the export is not this step's job either way. `sync` reads every
     * export it finds regardless of the client mix, so a Codex user who happens
     * to have a claude.ai zip gets it folded in without ever being asked.
     */
    applies: (ctx) => material(ctx, 'claude-code'),
  },

  'chatgpt-web-export': {
    id: 'chatgpt-web-export',
    title: 'ChatGPT chat export',
    why:
      'Your chatgpt.com conversations live on OpenAI servers, not on this disk. ' +
      'There is no API for your own chat history, so only you can request them — ' +
      'it needs your logged-in browser and your inbox.',
    ask:
      'Your brain is being built from the sessions on this machine right now. ' +
      'Your ChatGPT conversations are not on here — want to grab those too? It ' +
      'takes about a minute of clicking, then a wait.',
    verbatim: [
      '1. Open chatgpt.com in your browser and sign in.',
      '2. Click your profile picture at the top-right, then Settings.',
      '3. Open "Data controls".',
      '4. Next to "Export data", click Export, then confirm.',
      '5. OpenAI emails you a download link. It is usually hours, but it can',
      '   take up to 7 DAYS. Nothing appears on screen. It has not failed.',
      '6. THE LINK EXPIRES 24 HOURS AFTER IT ARRIVES. Download it the day the',
      '   email lands, or it has to be requested again.',
      '7. Put it in your Downloads folder and leave it there. It does not need',
      '   unzipping, and unzipping it is fine. The filename does not matter',
      '   either — exposurie identifies an export by what is inside it.',
      '',
      'Two things worth telling them before they click:',
      '  - Requesting a new export CANCELS any earlier one still pending. Ask',
      '    once and wait.',
      '  - Export is not available on ChatGPT Team or Business workspaces, only',
      '    Free, Plus and Pro. If they cannot find the button, that is why —',
      '    it is not something they are doing wrong.',
    ],
    doneWhen: 'a ChatGPT export appears in Downloads — the zip, or the folder if OpenAI sent one',
    resolved: (ctx) => (ctx.chatgptExports?.length ?? 0) > 0,

    /**
     * Now genuinely symmetric with the claude.ai rule, and the asymmetry that
     * used to be here is deleted rather than softened.
     *
     * It said: a machine with no local history does not get this ask, because
     * "we cannot read a ChatGPT export with anything like the same confidence
     * yet", and it named itself as the thing to delete when that stopped being
     * true. It has stopped being true. The reader has since been run against a
     * real 1,164-conversation export and returned 1,157 readable conversations
     * and 7 empty ones, with no parse error — so the tree walk is evidence now,
     * not documentation. What is still unproven is export DISCOVERY, not the
     * parse: that export had to be repackaged by hand before this tool could
     * find it, which is a separate defect and does not belong in this gate.
     *
     * So a person with no local history is asked for both. We have no way to
     * know which vendor is theirs, and guessing costs them everything they have
     * while asking costs one command to decline.
     *
     * No "…or an export exists" clause, for the reason given on the claude.ai
     * step: `resolved` covers it, and a condition that cannot change an outcome
     * is a safeguard nobody can rely on.
     */
    applies: (ctx) => material(ctx, 'codex'),
  },

  obsidian: {
    id: 'obsidian',
    title: 'Seeing the brain — the folder now, Obsidian for the graph',
    why:
      'Nothing in the system needs Obsidian — the brain is plain Markdown and ' +
      'your agent reads the files directly. Both halves of this are here so the ' +
      'user actually LOOKS at it, which is the moment most people start ' +
      'trusting it. Opening the folder does that on its own and cannot fail; ' +
      'the graph is the better version of the same moment.',
    ask:
      'Want to look at your brain? I can open the folder right now — it is ' +
      'plain Markdown, nothing to install. And if you want to see it as a ' +
      'linked graph, Obsidian is free and opens the folder as-is.',
    // One line, for the machine this is actually running on.
    //
    // This used to print all three package managers and tell the agent to pick.
    // That is the generalising this product is against: `winget` on a Mac is
    // noise the user has to filter, and an agent handed three options in a
    // pending step is being asked to guess at something `process.platform`
    // already knows. The tool knows the setup, so the tool says the line.
    //
    // `onYes`, not `verbatim`, and the old channel was a category error. Every
    // line of this is addressed to the AGENT — "install it for them", "walk
    // them through" — yet it was rendered under "RELAY THESE EXACTLY, do not
    // paraphrase", which reads as words to say out loud to a person. The
    // catalog allows exactly one channel per step precisely so this cannot be
    // fudged; the fix was to pick the right one.
    onYes: (ctx) => openTheBrain(ctx),
    doneWhen: 'the user says it is installed, or an Obsidian vault config appears',
    resolved: (ctx) => ctx.obsidianInstalled === true,
  },
};

/**
 * The context every gate reads, built in ONE place.
 *
 * Both callers used to assemble this by hand from the same detect() result,
 * which is fine until a gate needs a field the hand-written copies do not have
 * — and then the mechanism works perfectly in isolation and does nothing in the
 * product. That is exactly how the decline filter shipped broken the first
 * time: `vault` was absent from both literals, so a refusal was recorded and
 * then ignored on every command. Build it here or the drift comes back.
 */
export function stepCtx(d = {}, vault = d.vault) {
  return {
    vault,
    exports: d.exports,
    chatgptExports: d.chatgptExports,
    obsidianInstalled: d.obsidianInstalled,
    clients: d.clients,
    retention: d.retention,
  };
}

/**
 * Steps still outstanding, given detected state. Order is catalog order.
 *
 * Three gates, and the order they are written in is the order of cost: a step
 * that does not apply was never this person's, a step already done needs no
 * asking, and a step they refused is theirs to have refused.
 *
 * Declines are read from `ctx.vault` when there is one. A caller that omits it
 * gets the old behaviour — the step reprints — which is the correct direction
 * to fail in: nagging about something settled is a nuisance, silently burying
 * a step nobody decided on is the bug.
 */
export function unresolved(ctx = {}, ids = Object.keys(STEPS)) {
  const no = ctx.vault ? declined(ctx.vault) : new Set();
  return ids
    .map((id) => STEPS[id])
    .filter((s) => s && (!s.applies || s.applies(ctx)) && !s.resolved(ctx) && !no.has(s.id));
}

const dir = (vault) => join(vault, '.exposurie', 'pending');
const declinedDir = (vault) => join(vault, '.exposurie', 'declined');

/** The ids this brain's owner has said no to. Unknown ids are ignored. */
export function declined(vault) {
  if (!vault || !existsSync(declinedDir(vault))) return new Set();
  const out = new Set();
  for (const f of readdirSync(declinedDir(vault))) {
    const id = f.replace(/\.md$/, '');
    // Only ids we still ship. A decline left over from a step that has since
    // been removed is inert rather than an error, and a stray file somebody
    // dropped in here cannot invent a step.
    if (STEPS[id]) out.add(id);
  }
  return out;
}

/**
 * Record that the user said no. Their words, not a paraphrase and not a flag.
 *
 * Everything else in this file refuses to take a claim as evidence, and this
 * is the one place that must — a decision leaves no trace on disk to detect.
 * So the guard is different in kind: it is written down, in the user's own
 * brain, in their own words, where they can read it back and undo it without
 * this tool. A decline an agent invented is visible as one, because the reason
 * line is either something the person said or it is empty.
 */
export function decline(vault, id, reason) {
  const step = STEPS[id];
  if (!vault || !step) return null;
  const d = declinedDir(vault);
  mkdirSync(d, { recursive: true });
  const path = join(d, `${id}.md`);
  const said = (reason || '').trim();
  writeFileSync(
    path,
    [
      `# ${step.title} — set aside`,
      '',
      `You decided against this on ${new Date().toISOString().slice(0, 10)}.`,
      'exposurie will stop asking. Nothing about your brain is worse for it —',
      'this step was never blocking anything.',
      '',
      '## What you said',
      '',
      said ? `> ${said}` : '_No reason recorded._',
      '',
      '## If you change your mind',
      '',
      'Delete this file. The step comes back on the next command, exactly as',
      'it was. That is the whole undo — there is no command to remember.',
      '',
      '## What the step was',
      '',
      step.why,
      '',
      `**It would have been done when:** ${step.doneWhen}`,
      '',
    ].join('\n'),
    'utf8',
  );
  // The reminder and the refusal cannot both stand. reap() would clear this on
  // the next command anyway; doing it here means the file is gone by the time
  // the agent reports back, rather than one command later.
  try {
    unlinkSync(join(dir(vault), `${id}.md`));
  } catch {}
  return path;
}

/**
 * A step's instructions, resolved against this machine.
 *
 * Static text cannot name the folder the brain is actually in, and "choose your
 * vault folder" is exactly the generalising this product is against when the
 * path is a fact we hold.
 */
export function lines(step, ctx = {}) {
  const resolve = (v) => (typeof v === 'function' ? v(ctx) : v);
  // Two channels, one bar. `verbatim` is read TO the person; `onYes` is done
  // FOR them once they agree. A step has one or the other and both are literal
  // — the rule was never "there must be a field called verbatim", it is that no
  // step is ever a topic somebody has to reconstruct.
  return resolve(step.verbatim) ?? resolve(step.onYes) ?? [];
}

/**
 * Mirror a step to disk. The terminal scrolls away; a file is still there
 * tomorrow, and the user can find it without us.
 */
export function record(vault, step) {
  if (!vault) return null;
  const d = dir(vault);
  mkdirSync(d, { recursive: true });
  const path = join(d, `${step.id}.md`);
  const body = [
    `# ${step.title}`,
    '',
    `_Waiting on you. Nothing is broken, and nothing is blocked by this._`,
    '',
    '## Why this one needs you',
    '',
    step.why,
    '',
    '## What to do',
    '',
    ...lines(step, { vault }),
    '',
    `**Done when:** ${step.doneWhen}`,
    '',
    `_exposurie checks for this on its own. Delete nothing — this file`,
    `disappears by itself once the step is detected as complete._`,
    '',
  ].join('\n');
  writeFileSync(path, body, 'utf8');
  return path;
}

/**
 * Make the disk match what is still owed: write the open reminders, remove the
 * ones that are not.
 *
 * The two halves are one call because they spent a whole release apart. record()
 * was wired into both commands and reap() was wired into neither — so a user who
 * actually did a step got the step correctly dropped from the output and a file
 * left in their brain saying "Waiting on you", under a line promising it would
 * delete itself. Correct component, no caller: the same class as the decline
 * filter that read a `vault` nobody passed it.
 *
 * Nothing here can half-happen now. A caller that mirrors gets both.
 */
export function mirror(vault, open = []) {
  if (!vault) return { written: [], gone: [] };
  const written = [];
  for (const p of open) if (record(vault, p)) written.push(p.id);
  return { written, gone: reap(vault, open) };
}

/**
 * Remove the disk record for anything no longer owed.
 *
 * It takes the open list rather than recomputing it, so the file on disk and
 * the step in the output cannot disagree about what "open" means — one
 * computation, one answer. That covers declines for free: a declined step is
 * not in `open`, so its reminder goes, and the brain stops contradicting a
 * decision the user already made.
 */
export function reap(vault, open = []) {
  if (!vault || !existsSync(dir(vault))) return [];
  const stillOpen = new Set(open.map((s) => s.id));
  const gone = [];
  for (const f of readdirSync(dir(vault))) {
    const id = f.replace(/\.md$/, '');
    if (STEPS[id] && !stillOpen.has(id)) {
      try {
        // Best-effort: a stale reminder is a nuisance, a crash is a bug.
        unlinkSync(join(dir(vault), f));
        gone.push(id);
      } catch {}
    }
  }
  return gone;
}
