// `exposurie uninstall` — take back everything this tool put on the machine.
//
// remove() in reach.js says it plainly: a pointer we cannot remove is a pointer
// we have imposed. It was written, it was correct, and for the whole life of
// the product nothing called it — so the honest version of "we own the failure
// path" had no command behind it.
//
// THE ONE COMMAND, AND IT IS THE USER'S. Every other command here talks to an
// agent, which is right when the agent is doing work on their behalf. Leaving
// is different: a person who wants this gone should not have to open a coding
// agent and ask it nicely. So this one is typed by a human, in a terminal, and
// speaks to that human — no "TELL YOUR USER", no relay, no plan for something
// else to execute. It works the same when an agent runs it, because plain
// second-person prose is the one register both can read.
//
//   exposurie uninstall
//
// It is the counterpart to `scaffold`, not a new recurring command: setup is
// typed once and teardown is typed once. What a person types over and over is
// still `sync`.
//
// THE RULE IT EXISTS TO KEEP: it removes what WE wrote, and never what the user
// did. Their brain is pages they and their agent authored, and it is the entire
// point of the tool — deleting it here would make uninstalling the most
// destructive thing exposurie can do, which is the opposite of why being able
// to leave builds any trust at all. The brain is reported, not touched, and the
// tool says where it is on the way out.

import { OK } from '../exit-codes.js';
import { unreachAll } from '../reach.js';
import { installState, UNINSTALL } from '../install.js';
import { detect, tilde } from '../context.js';
import { block, wrap } from '../output.js';
import { vaultState } from '../vault.js';

export function uninstall({ at } = {}) {
  const d = detect({ at });

  // Same dropped flag as `decline`: `{ at }` was passed to a parameterless
  // `detect()`, so this command was printing "YOUR BRAIN IS UNTOUCHED" over a
  // path the user had not named. The flag is honoured now.
  //
  // But it does NOT refuse the way `sync`, `read` and `decline` do, and the
  // suite is what said so: leaving must always finish. Here `--at` only decides
  // which folder gets NAMED — nothing is read from it and nothing is written to
  // it — so refusing over a wrong path would strand the pointer blocks in
  // somebody's client files at the exact moment they asked to be rid of them.
  // Refusing to let someone leave, over a cosmetic argument, is the worst thing
  // this command could do. It says the path was empty and gets on with it.
  const missingAsked = d.askedVault && !d.vault ? d.askedVault : null;
  const results = unreachAll();

  const removed = results.filter((r) => r.action === 'removed');
  const absent = results.filter((r) => r.action === 'absent');

  const rows = [];
  for (const r of removed) rows.push([r.name, `removed   ${tilde(r.file)}`]);
  // A client that was present with nothing of ours in it still gets a line.
  // Silence there reads as "it missed one", and the entire value of this
  // command is that you can see for yourself that it finished.
  for (const r of absent) rows.push([r.name, `nothing of ours was there`]);

  const body = [
    'UNINSTALLED',
    ...(rows.length
      ? block('', rows).filter((l) => l.trim() !== '')
      : ['  No supported client found — there was nothing to remove.']),
    '',
    ...wrap(
      `That is every byte exposurie wrote outside your brain. Those files are ` +
        `yours and they are back exactly as you had them — the block came out, ` +
        `nothing around it moved.`,
      74,
      '  ',
    ),
    '',
    'YOUR BRAIN IS UNTOUCHED',
  ];

  if (d.vault) {
    body.push(
      `  ${tilde(d.vault)}`,
      '',
      ...wrap(
        `Plain Markdown, and a git repo with its own history. It opens in ` +
          `Obsidian, in any editor, in anything that reads text — with this tool ` +
          `gone and forever after. Nothing in there needs exposurie to be read.`,
        74,
        '  ',
      ),
      '',
      ...wrap(
        `If you want it gone, delete that folder yourself. This command will ` +
          `not, and no flag makes it: a tool that can erase the thing it spent ` +
          `months building for you is not one you should have trusted with it.`,
        74,
        '  ',
      ),
    );
  } else if (missingAsked) {
    body.push(
      ...wrap(
        `You named ${tilde(missingAsked)} with --at and there is no brain there, ` +
          `so there is nothing to name here. Everything above still happened: ` +
          `what exposurie wrote outside a brain is gone either way.`,
        74,
        '  ',
      ),
    );
  } else {
    body.push('  No brain found on this machine — there was nothing to keep.');
  }

  // Say which of the two is actually true on this machine rather than
  // describing both and leaving the person to work out which one they are. The
  // old text led with npx as though it were the normal case; it is not, and
  // guessing wrong here means someone believes they have uninstalled a package
  // that is still on their PATH.
  const install = installState();
  body.push(
    '',
    'THE PACKAGE',
    ...(install.permanent
      ? [
          ...wrap(
            `It is installed on this machine, at ${tilde(install.binary)}. Your ` +
              `brain does not need it and neither does anything above — this is ` +
              `the last line, and it is yours to run when you want:`,
            74,
            '  ',
          ),
          `      ${UNINSTALL}`,
        ]
      : wrap(
          `Nothing to remove — this was run from a temporary npx cache, so no ` +
            `exposurie command was ever installed here.`,
          74,
          '  ',
        )),
    '',
    ...wrap(
      `Changed your mind later? Run scaffold again and it picks up exactly ` +
        `where this left off — what has been synced is recorded inside the ` +
        `brain, not in the tool.`,
      74,
      '  ',
    ),
  );

  return {
    code: OK,
    state: d.vault ? vaultState(d.vault, 'uninstall') : { vault: null, self: 'uninstall' },
    body,
  };
}
