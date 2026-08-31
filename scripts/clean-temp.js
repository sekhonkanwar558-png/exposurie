// Removes the temp brains the suite leaves behind. Wired as `pretest`, so it
// runs before every `npm test` and the litter can never outlive one run.
//
// It lives in `scripts/` rather than `test/` because `node --test` collects
// EVERY .js file under a directory named `test` as a test file. Sitting there,
// it ran twice — once as the pretest, and again in the middle of the suite,
// sweeping while other tests were using the directory it was sweeping. Only
// the age guard below kept that from deleting live fixtures.
//
// WHY THIS EXISTS. 26 test files call `mkdtempSync(join(tmpdir(), 'exposurie-…'))`
// and not one of them cleans up, because each test wants its directory to
// survive for inspection when it fails. Individually reasonable; in aggregate
// it had put 22,835 directories and roughly 3.1 GB into %TEMP% over eight days
// of development. Every full run adds around ninety more.
//
// WHY IT RUNS BEFORE RATHER THAN AFTER. `posttest` only fires when the suite
// PASSES, so the run that leaves the most behind — a failing one you are about
// to debug — would be the one never cleaned. Running first also means the
// directories from the last run are still on disk while you are reading the
// failure, and only go when you next choose to run the suite.
//
// THE AGE GUARD IS WHAT MAKES IT SAFE. It deletes nothing younger than an
// hour, so a second test run started while one is already going cannot pull
// the ground out from under it. Anything older than that belongs to a run that
// has long since exited.
//
// Deliberately not a monkey-patch of `mkdtempSync`: patching a builtin from a
// preload so that ESM named imports see it is not reliable, and a cleanup that
// silently stops working is worse than none.

import { readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PREFIX = 'exposurie';
const MIN_AGE_MS = 60 * 60 * 1000;

// A hard ceiling on how long tidying may delay the thing you actually ran.
//
// Each of these directories is a scaffolded brain with a git repo inside it,
// and removing one on Windows is hundreds of small deletes. Clearing the
// 22,835 that had accumulated took over ten minutes — fine as a one-off, but
// this runs before EVERY `npm test`, and a pretest that can outlast the suite
// is a pretest people delete. It stops when the budget is gone and takes the
// rest next time; the backlog only has to shrink faster than it grows, and
// after one sweep the steady state is about ninety.
const BUDGET_MS = 20 * 1000;

const root = tmpdir();
const cutoff = Date.now() - MIN_AGE_MS;

const started = Date.now();
let removed = 0;
let bytes = 0;
let kept = 0;
let failed = 0;
let ranOut = false;

let entries = [];
try {
  entries = readdirSync(root, { withFileTypes: true });
} catch {
  process.exit(0); // No temp dir to sweep is not a problem worth failing over.
}

for (const e of entries) {
  if (!e.isDirectory() || !e.name.startsWith(PREFIX)) continue;
  if (Date.now() - started > BUDGET_MS) {
    ranOut = true;
    break;
  }
  const p = join(root, e.name);
  let st;
  try {
    st = statSync(p);
  } catch {
    continue; // Vanished between the listing and the stat. Someone else's job.
  }
  if (st.mtimeMs > cutoff) {
    kept++;
    continue;
  }
  try {
    rmSync(p, { recursive: true, force: true });
    removed++;
    bytes += st.size;
  } catch {
    // Locked by a running process, or a permission we do not have. Never fail
    // the test run over tidying: the suite is what matters here, not the sweep.
    failed++;
  }
}

if (removed || failed || ranOut) {
  const parts = [`swept ${removed} temp brain${removed === 1 ? '' : 's'}`];
  if (kept) parts.push(`${kept} left alone (younger than an hour)`);
  if (failed) parts.push(`${failed} could not be removed`);
  // Said out loud, because a sweep that quietly gives up looks exactly like one
  // that finished, and the backlog would then grow with nothing reporting it.
  if (ranOut) parts.push('out of time — the rest goes next run');
  process.stdout.write(`clean-temp: ${parts.join(', ')}\n`);
}
