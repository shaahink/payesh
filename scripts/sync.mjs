#!/usr/bin/env node
/* The record, kept fresh: harvest → committed corpus → push → CI → deploy.
   ---------------------------------------------------------------------------
   The harvest already guarantees the hard properties — the store is opened
   read-only, anonymisation fails closed, budget-shaped figures come only from
   the engine's own verbs. What it never had was a trigger: the corpus was
   recomputed when somebody remembered, and the published record drifted a
   week behind the store (owner's ask, 2026-08-13: keep it fresh, and keep it
   triggerable by hand — or by an agent — as well as by the clock).

   This script is that trigger, and it is deliberately nothing more:

     npm run sync            # harvest; if the record moved, commit it and push

   A scheduled task runs the same command daily (see the header of the task in
   `schtasks /query /tn payesh-record-sync /v`). Everything after the push is
   the machinery that already exists: CI re-proves the evidence and anonymity
   gates on the pushed corpus, and Vercel redeploys the site from main.

   Three refusals, each because the unattended path is the dangerous one:

   1. **Not on main, no push.** A scheduled task that commits onto whatever
      branch was left checked out publishes a record into somebody's half-made
      redesign. The record's branch is main; anywhere else, say so and stop.
   2. **Only the corpus is committed.** The commit is pathspec-limited to
      src/data/corpus.json, so a working tree mid-thought keeps its thoughts.
      Nothing here ever does `git add` without a path.
   3. **The cited keys are re-proven against the NEW corpus before anything
      is committed.** A harvest that dropped a key a page cites would push a
      corpus that fails the site's own build — the gate would catch it, but
      red CI at 8am with nobody at the keyboard is a worse morning than a
      sync that refused with the reason printed. */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const corpus = "src/data/corpus.json";

const run = (command, args, opts = {}) =>
  execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...opts
  });

const git = (...args) => run("git", args).trim();

const say = (line) => console.log(`sync: ${line}`);

/* Refusal 1 — the branch. */
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") {
  say(`on '${branch}', not main — the record publishes from main only. nothing done.`);
  process.exit(0);
}

/* The harvest. Its own output says what it measured; a failure here is the
   store's to explain and this script's to surface, not to swallow. */
say("harvesting from the run store (read-only)…");
run("node", ["scripts/harvest.mjs"], { stdio: "inherit" });

/* Anything to publish? */
if (git("status", "--porcelain", "--", corpus) === "") {
  say("the record is unchanged — nothing to publish.");
  process.exit(0);
}

/* Refusal 3 — the cited keys, against the corpus as it now is. */
say("re-proving every cited key against the fresh corpus…");
run("node", ["scripts/harvest.mjs", "--cited"], { stdio: "inherit" });

/* The commit message carries the two figures a reader of `git log` wants,
   read from the file being committed rather than recomputed. */
const record = JSON.parse(readFileSync(join(repoRoot, corpus), "utf8"));
const runs = record.corpus?.totalRuns?.display ?? "?";
const sessions = record.corpus?.totalSessions?.display ?? "?";

git("add", "--", corpus);
run("git", [
  "commit",
  "--only",
  "--",
  corpus,
  "-m",
  `chore(record): harvest — ${runs} runs, ${sessions} sessions`
]);
say(`committed: ${runs} runs, ${sessions} sessions.`);

/* Land on the remote's main rather than fighting it: rebase this one commit
   over whatever arrived while nobody was looking, autostashing the owner's
   uncommitted work around it. */
run("git", ["pull", "--rebase", "--autostash", "origin", "main"], { stdio: "inherit" });
run("git", ["push", "origin", "main"], { stdio: "inherit" });
say("pushed — CI re-proves the gates, and the site redeploys from main.");
