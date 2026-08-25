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
//   npx @sekhon/exposurie uninstall
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
import { detect, tilde } from '../context.js';
import { block, wrap } from '../output.js';
import { vaultState } from '../vault.js';

export function uninstall({ at } = {}) {
  const d = detect({ at });
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
  } else {
    body.push('  No brain found on this machine — there was nothing to keep.');
  }

  body.push(
    '',
    'THE PACKAGE',
    ...wrap(
      `Run with npx, nothing was ever installed and there is nothing left. If ` +
        `you installed it globally, this is the last line:`,
      74,
      '  ',
    ),
    '      npm uninstall -g @sekhon/exposurie',
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
