// The output contract, rendered.
//
// Everything this tool prints goes through here. The audience is a MODEL, with
// a person somewhere behind it — so the format optimises for a reader that will
// act on it, not one that will admire it.
//
// Four rules, each bought with a failure recorded in the brain that inspired it:
//
//  1. NOTHING EVER PROMPTS. When an agent runs a command there is nobody at the
//     keyboard. A tool that waits for stdin does not get stdin — it hangs, and
//     the agent looks frozen. Human input is REQUESTED via pending steps and the
//     process exits; it is never awaited.
//  2. EVERY ACTIONABLE LINE OPENS WITH A VERB IN CAPS. `RUN:`, `ASK YOUR USER:`,
//     `READ:`. An instruction buried in prose is an instruction skipped.
//  3. PRINT THE COMMAND, NEVER THE CONCEPT. Not "look at the page" — the exact
//     argv that opens it. A wikilink is a human convention; a command executes.
//  4. THE DIRECTIVE RIDES THE OUTPUT. Anything we need the agent to keep doing
//     is attached to output it already reads, not to documentation we hope it
//     read once.

import { SYNC, exists } from './commands/names.js';

const INDENT = '  ';

function pad(s, w) {
  return s + ' '.repeat(Math.max(0, w - s.length));
}

/** Wrap long prose so a terminal never hard-wraps mid-word. */
export function wrap(text, width = 76, indent = '') {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > width) {
      lines.push(indent + line);
      line = w;
    } else {
      line = line ? line + ' ' + w : w;
    }
  }
  if (line) lines.push(indent + line);
  return lines;
}

/**
 * The state line. Printed FIRST by every command, always, even on error.
 *
 * This is the retention mechanism. v1 sync is manual, so the trigger is an
 * agent choosing to nudge — and an agent that has to remember will not. Riding
 * the number on output the agent is already reading costs nothing until the
 * tool is used, and is the one mechanism with proof behind it.
 */
export function stateLine(s = {}) {
  const out = [];
  // A third state, between "has a brain" and "has none": we cannot tell. Saying
  // "no brain yet" here would be a guess, and the arrow under it would send the
  // user to build a second one. No command repairs this, so no arrow is shown.
  if (s.brokenPointer) {
    out.push('exposurie  brain location unknown — the pointer is unreadable');
    return out;
  }
  if (!s.vault) {
    out.push('exposurie  no brain yet');
    // Never advertise the command we are already inside. A nudge that fires
    // during its own target teaches an agent the arrow is decoration.
    if (s.self !== 'init') out.push('           -> RUN: exposurie init');
    return out;
  }
  const bits = [];
  bits.push(`${s.pages ?? 0} page${s.pages === 1 ? '' : 's'}`);
  if (s.unfiled) bits.push(`${s.unfiled} session${s.unfiled === 1 ? '' : 's'} unfiled`);
  bits.push(
    s.lastSyncDays == null
      ? 'never synced'
      : s.lastSyncDays === 0
        ? 'synced today'
        : `last sync ${s.lastSyncDays}d ago`,
  );
  if (s.lastBackup === null) bits.push('backup never');
  out.push(`exposurie  ${bits.join(' · ')}`);

  // Nudge only when it is earned, so the arrow keeps meaning something — and
  // only while the command it names exists. The numbers are the mechanism; the
  // arrow is the call to action, and an arrow pointing at a command that is not
  // built teaches an agent that the arrow is decoration. It switches itself on
  // in the same change that adds the command.
  const earned = s.unfiled > 0 || (s.lastSyncDays ?? 0) >= 7;
  if (earned && s.self !== SYNC && exists(SYNC)) {
    out.push(`           -> RUN: exposurie ${SYNC}`);
  }
  return out;
}

/** An aligned key/value block. Used for STATE and anything else scannable. */
export function block(title, rows) {
  if (!rows || rows.length === 0) return [];
  const w = Math.max(...rows.map(([k]) => k.length));
  return [title, ...rows.map(([k, v]) => `${INDENT}${pad(k, w)}  ${v}`)];
}

/**
 * The ordered task list. Steps an agent executes top to bottom.
 *
 * A step is either { run } — argv to execute — or a pending human step, which
 * is rendered as "ask, then keep going" and NEVER as a stopping point.
 */
export function planBlock(steps) {
  if (!steps || steps.length === 0) return [];
  const out = ['DO THESE IN ORDER'];
  steps.forEach((step, i) => {
    const n = `${INDENT}${i + 1}.`;
    if (step.run) {
      out.push(`${n} RUN:  ${step.run}`);
      if (step.note) out.push(...wrap(step.note, 70, `${INDENT}    `));
    } else if (step.ask) {
      out.push(`${n} ASK YOUR USER, in your own words:`);
      // Wrapped for the same reason the pending block wraps: an unwrapped
      // sentence gets hard-wrapped by the terminal mid-word, and the words an
      // agent relays to a person are the last place to allow that.
      out.push(...wrap(`"${step.ask}"`, 68, `${INDENT}    `));
      out.push(`${INDENT}    Do NOT wait for an answer. Continue to the next step.`);
    } else if (step.read) {
      out.push(`${n} READ: ${step.read}`);
      // A READ step used to drop its note on the floor. That was invisible
      // until a step needed to say what to DO with what it points at — the
      // file list is a list of paths, and "open every one of these" is the
      // instruction, not the path.
      if (step.note) out.push(...wrap(step.note, 70, `${INDENT}    `));
    } else if (step.write) {
      // The one step in the product that is the agent's own work rather than a
      // command. It still opens with a verb, because a line without one reads
      // as commentary and gets skipped.
      out.push(`${n} WRITE THE PAGES.`);
      out.push(...wrap(step.write, 70, `${INDENT}    `));
    }
  });
  return out;
}

/**
 * Pending human steps, re-reported by EVERY command until the thing exists.
 *
 * Two fields where one looks sufficient, and the split is the point:
 *   `ask`      — the agent puts this in its own voice. Tone should match the
 *                conversation the user is already having.
 *   `verbatim` — relayed EXACTLY. Click paths get paraphrased into something a
 *                non-technical person cannot follow, so they do not get to be
 *                paraphrased.
 */
export function pendingBlock(pending) {
  if (!pending || pending.length === 0) return [];
  const out = [`FOR YOUR USER — ${pending.length} pending`];
  for (const p of pending) {
    out.push('');
    out.push(`${INDENT}[${p.id}]  ${p.title}`);
    if (p.why) out.push(...wrap(`WHY: ${p.why}`, 70, `${INDENT}  `));
    if (p.ask) {
      out.push(`${INDENT}  ASK YOUR USER, in your own words:`);
      out.push(...wrap(`"${p.ask}"`, 68, `${INDENT}      `));
    }
    const said = typeof p.verbatim === 'function' ? p.verbatim(p.ctx || {}) : p.verbatim;
    if (said?.length) {
      out.push(`${INDENT}  RELAY THESE EXACTLY — do not paraphrase, do not summarise:`);
      for (const line of said) out.push(`${INDENT}      ${line}`);
    }
    if (p.doneWhen) out.push(`${INDENT}  DONE WHEN: ${p.doneWhen}`);
    out.push(`${INDENT}  This does NOT block anything. Keep working.`);
  }
  return out;
}

export function errorBlock(err) {
  if (!err) return [];
  const out = ['ERROR'];
  out.push(...wrap(err.message || String(err), 74, INDENT));
  if (err.fix) {
    out.push('');
    out.push(`${INDENT}FIX:  ${err.fix}`);
  }
  return out;
}

/**
 * Compose one complete response. The skeleton never varies, so an agent can
 * rely on position: state first, what a human owes second, the answer third.
 */
export function render({ state, pending, body = [], error, code = 0 } = {}) {
  const parts = [];
  const push = (lines) => {
    if (lines.length) {
      if (parts.length) parts.push('');
      parts.push(...lines);
    }
  };
  push(stateLine(state));
  push(pendingBlock(pending));
  push(errorBlock(error));
  push(Array.isArray(body) ? body : [body]);
  // The exit line is a block of the skeleton like any other, and blocks are
  // separated by a blank line. The caller appends it, so the separator belongs
  // here — otherwise the footer reads as the last line of the body.
  return parts.join('\n') + '\n\n';
}
