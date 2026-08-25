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
 * Install it for them, then walk them into their own brain.
 *
 * Installing Obsidian is not the step — SEEING the brain is. A person left at a
 * freshly installed app with no vault open has been handed an empty window and
 * a file picker, which is where most people stop. So the path to their brain is
 * printed literally, because the agent knows it and they should not have to.
 */
function openTheBrain(ctx = {}) {
  const where = ctx.vault || 'the brain folder';
  const open =
    process.platform === 'darwin'
      ? `  open "${where}"`
      : process.platform === 'win32'
        ? `  explorer "${where}"`
        : `  xdg-open "${where}"`;

  return [
    'Install it for them first:',
    installObsidian(),
    '',
    'Then walk them through opening their brain. These four steps, in order:',
    '  1. Open Obsidian.',
    '  2. Click "Open folder as vault".',
    '  3. Choose this exact folder:',
    `       ${where}`,
    '  4. Trust the vault when it asks. Nothing here runs code.',
    '',
    'Then tell them to press Ctrl+G (Cmd+G on a Mac) for the graph view. That',
    'is the picture of their own head, and it is the moment this stops feeling',
    'like a folder of notes.',
    '',
    'If Obsidian will not install, they can still read everything — it is plain',
    'Markdown. Open the folder for them:',
    open,
    'Only send them to https://obsidian.md as a last resort, and walk them',
    'through it in conversation. Do NOT make them run a terminal command.',
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
      `    exposurie decline claude-code-retention --because "<their words>"`,
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
     * Only where the deletion is real. Codex and Cursor keep their history on
     * their own terms, and a person with no Claude Code on the machine is being
     * warned about a cleanup that will never run — which is the request that
     * cannot resolve, reprinting forever.
     */
    applies: (ctx) => (ctx.clients || []).some((c) => c.id === 'claude-code' && c.present),
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
      '   and leave it there. Do not unzip it.',
      '7. IF THE EMAIL HAS MORE THAN ONE LINK, download every one of them.',
      '   A large account is split across numbered zips (batch-0000,',
      '   batch-0001...). Taking only the first looks complete and is not:',
      '   the older conversations are LISTED in it with their text missing.',
    ],
    doneWhen: 'a data-*.zip appears in the Downloads folder',
    resolved: (ctx) => (ctx.exports?.length ?? 0) > 0,

    /**
     * Ask when there is any reason to think they use Claude, and only then.
     *
     * Present-and-Claude, or no readable client at all — because somebody with
     * nothing on their machine is very likely a person who only ever used a
     * browser, and the web is the whole of their history. What is deliberately
     * excluded is the case in between: a machine with Codex on it and no sign
     * of Claude anywhere. Those users get a request they can never satisfy.
     *
     * The cost of being wrong here is real and is the smaller one: a Codex user
     * who also uses claude.ai in a browser will not be asked. That is a missed
     * import. The other way round is a permanent nag, and a permanent nag
     * teaches the person that this tool does not notice them.
     */
    applies: (ctx) => {
      if ((ctx.exports?.length ?? 0) > 0) return true;
      const clients = ctx.clients || [];
      const usable = clients.filter((c) => c.present && c.readable);
      if (usable.length === 0) return true; // no local history at all: the web is all they have
      return usable.some((c) => c.id === 'claude-code');
    },
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
      '7. Put the .zip in your Downloads folder and leave it there. Do not',
      '   unzip it. The filename does not matter — exposurie identifies it by',
      '   what is inside.',
      '',
      'Two things worth telling them before they click:',
      '  - Requesting a new export CANCELS any earlier one still pending. Ask',
      '    once and wait.',
      '  - Export is not available on ChatGPT Team or Business workspaces, only',
      '    Free, Plus and Pro. If they cannot find the button, that is why —',
      '    it is not something they are doing wrong.',
    ],
    doneWhen: 'a ChatGPT export zip appears in the Downloads folder',
    resolved: (ctx) => (ctx.chatgptExports?.length ?? 0) > 0,

    /**
     * The mirror image of the claude.ai rule, and it exists for the same
     * person: somebody setting up a brain from Codex has an OpenAI account, so
     * asking them for a claude.ai export is asking for something they may not
     * have — and asking them for nothing at all leaves their entire web history
     * out of the brain.
     *
     * Deliberately NOT symmetric in one respect: a machine with no local
     * history at all does not get this ask. That person is asked for their
     * claude.ai export instead, because we cannot read a ChatGPT export with
     * anything like the same confidence yet — see the warning at the top of
     * extract/chatgpt.js. Asking for the file we parse better is the honest
     * default while that is true, and this comment is the thing to delete when
     * it stops being true.
     */
    applies: (ctx) => {
      if ((ctx.chatgptExports?.length ?? 0) > 0) return true;
      const usable = (ctx.clients || []).filter((c) => c.present && c.readable);
      if (usable.length === 0) return false;
      return !usable.some((c) => c.id === 'claude-code');
    },
  },

  obsidian: {
    id: 'obsidian',
    title: 'Obsidian (to read the brain by hand)',
    why:
      'Nothing in the system needs Obsidian — the brain is plain Markdown and ' +
      'your agent reads the files directly. It is here so the user can browse ' +
      'and see the graph, which is the moment most people start trusting it.',
    ask:
      'Want to see your brain as an actual linked graph? Obsidian is free and ' +
      'opens the folder as-is — nothing gets converted or locked in.',
    // One line, for the machine this is actually running on.
    //
    // This used to print all three package managers and tell the agent to pick.
    // That is the generalising this product is against: `winget` on a Mac is
    // noise the user has to filter, and an agent handed three options in a
    // pending step is being asked to guess at something `process.platform`
    // already knows. The tool knows the setup, so the tool says the line.
    verbatim: (ctx) => openTheBrain(ctx),
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
