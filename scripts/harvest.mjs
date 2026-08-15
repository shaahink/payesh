#!/usr/bin/env node
/* The harvest: Conductor's run store in, src/data/corpus.json out.
   ---------------------------------------------------------------------------
   This is the machine behind the site's first litmus test. No figure on this
   site is ever typed into content — content names a KEY, and the value comes
   from the file this script writes. A number that cannot be typed cannot drift,
   and a number that came from here can be recomputed by anyone with the store.

   Run it:

     npm run harvest            # recompute and write src/data/corpus.json
     npm run harvest -- --check # recompute and diff, exit 1 if the file is stale

   Three rules govern what follows, and all three are load-bearing rather than
   stylistic. They are SPEC Part VI.

   1. **Run-level truth comes from `conductor history --json --limit 0`, never
      from SQL.** The engine folds checkpoints out of its event log; a naive
      `select count(*) from events where type='CheckpointConfirmed'` answers 65
      against the engine's own 295 of 328. Measured during planning, re-measured
      here. SQL is for what the JSON does not expose — costs by category, gate
      pass rates, bugs, ledger entries, event counts, rollovers.

   2. **Every store is opened read-only.** This machine's store is shared with
      other repos and with a run that is paused rather than finished. `readOnly:
      true` is SQLITE_OPEN_READONLY: the connection cannot write, so a bug here
      cannot damage somebody else's record of their own work.

   3. **Anonymisation fails closed.** A run in the store with no entry in
      `anonymise.json` is excluded from the corpus. Not renamed, not published
      with its id showing — excluded. The default for an unknown run is silence,
      which is the only default that stays safe when somebody forgets.

   And one rule this script enforces on its successors: anything budget-shaped —
   floors, median closers, wrap-up, rollover *rates*, tokens per checkpoint,
   blended $/M, cap values — is never computed from SQL here. It is *asked of*
   `conductor money` and `conductor budget`, which read the ledger properly, and
   what they answer is recorded with the command itself as the figure's source.
   In August 2026 those verbs were run against a hand-derived analysis of exactly
   these numbers and contradicted four of it: a cap benefit published as 4.0x
   measured 1.6x, because one window's cost had been divided by another window's
   checkpoints. `refuseBudgetShaped()` at the bottom of this file makes that a
   build failure rather than a comment somebody skims — a budget-shaped key whose
   source is not one of those two commands does not ship. */

import { DatabaseSync } from "node:sqlite";
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..");
export const corpusPath = join(repoRoot, "src", "data", "corpus.json");
export const anonymisePath = join(repoRoot, "anonymise.json");

/** Where a figure came from, spelled the way a reader could repeat it. */
const HISTORY = "conductor history --json --limit 0";
const STORE = "run.db, opened read-only";
/* The third source, and the one the rule at the top of this file points at.
   Anything money-shaped — a run's blended dollars per million tokens, its
   tokens per checkpoint, the split across its stages — is asked of the verb
   that reads the ledger properly rather than recomputed from SQL here.

   The placeholder is not laziness. The real command carries the run's id, and a
   run id is precisely what this site does not publish: runs appear under the
   label `anonymise.json` gave them, and a test refuses any id that reaches
   corpus.json — which is how the first draft of this line was caught. A reader
   repeating this runs it against their own run anyway. */
const MONEY = "conductor money --run <run> --json";
/* The fourth source, and the only one that can see a ceiling at all.
   `runs.limits_json` is NULL for every imported run, so the cap a run was under
   is not in the store: `conductor budget` reconstructs it from where the
   sessions actually stopped, and says whether it measured one (`capMeasured`)
   or found none. Everything a cap is judged by — the floor, the median closing
   session, the wrap-up spend, the rollover rate — comes back from the same
   call, over the same window, which is the part a hand query got wrong in
   August 2026 by dividing one window's cost by another window's checkpoints. */
const BUDGET = "conductor budget <run> --json";

/* ---------------------------------------------------------------------------
   Collecting
   --------------------------------------------------------------------------- */

/** The engine's own answer about every run it has ever recorded.
    ---------------------------------------------------------------------------
    `--limit 0` means "all of them". The BOM strip is not superstition: the
    verb writes UTF-8 with a byte order mark on Windows and `JSON.parse` refuses
    it with a message that names the token rather than the cause. */
export function readHistory() {
  const raw = execSync(HISTORY, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(raw.replace(/^﻿/, "")).runs;
}

/** What one run.db knows about one run.
    ---------------------------------------------------------------------------
    Every query filters on `run_id`, and that is the trap this function exists
    to close. A run.db is keyed by repo and plan, and the legacy import
    consolidated several runs into one file — the web fleet's three rounds share
    a single database. An unfiltered `select count(*) from bugs` answers 50
    where that run filed 23, and nothing about the number looks wrong.

    Two columns are here to be ignored on purpose:

    - `sessions.soft_break` is 0 for every row in the entire store. The
      cooperative break is recorded as an event, not as a column, so soft breaks
      are counted from `events.type = 'SoftBreakRequested'` — 125 store-wide,
      123 once this site's own run is excluded, which is what the corpus was
      measured at during planning. A harvest that read the column would publish
      zero and look correct.
    - `runs.limits_json` is NULL for every imported run. The store does not know
      what a run's cap was, so no cap figure can ever be recomputed here. See
      `refuseBudgetShaped`. */
function readStore(db, runId) {
  const one = (sql) => db.prepare(sql).get(runId);
  const all = (sql) => db.prepare(sql).all(runId);

  const costs = all(
    `select category,
            sum(tokens_in) as tokensIn, sum(tokens_out) as tokensOut,
            sum(tokens_cache) as cacheRead, sum(cost_usd) as costUsd
       from costs where run_id = ? group by category`
  );
  const byCategory = {};
  for (const row of costs) {
    byCategory[row.category] = {
      tokensIn: row.tokensIn ?? 0,
      tokensOut: row.tokensOut ?? 0,
      cacheRead: row.cacheRead ?? 0,
      costUsd: row.costUsd ?? 0
    };
  }

  /* Four counts, not one, because "29 red" is worth very little on its own.
     A gate battery can be green because everything passed or because half of
     it was optional and the other half was skipped — so the skipped and
     optional counts are what turn a pass rate into a claim. Both are zero
     across this whole corpus, which is the only reason the pass rate means
     what a reader will assume it means.

     `crashed` separates a command that ran and said no from one that never
     ran: an exit status the command did not choose — negative, or above the
     128 that marks a signal — is a process that died on the way up. Four of
     the corpus's red gates are that, at tens of milliseconds each, and they
     are the ones an agent's own "tests pass" would have sailed straight past. */
  const gates = one(
    `select count(*) as total,
            coalesce(sum(passed), 0) as green,
            coalesce(sum(skipped), 0) as skipped,
            coalesce(sum(optional), 0) as optional,
            coalesce(sum(case when passed = 0 and (exit_code < 0 or exit_code > 128)
                              then 1 else 0 end), 0) as crashed
       from gates where run_id = ?`
  );

  const events = {};
  for (const row of all(`select type, count(*) as n from events where run_id = ? group by type`)) {
    events[row.type] = row.n;
  }

  /* What a session wrote down about itself, split by whether it rolled over.
     ---------------------------------------------------------------------------
     Five columns of the `sessions` row, and they are not five versions of the
     same thing. `commit_count`, `gate_summary`, `newly_done` and
     `result_summary` are the record of what a session *did*; `digest` is the
     note the *next* session reads to pick the work up. One faces backwards and
     one faces forwards, and separating the two by outcome is the whole of
     article 4 — a population where the forward-facing field is almost always
     present and every backward-facing one is empty is a population whose
     history was never written, not one that did nothing.

     Split on outcome rather than filtered to it, because a count with no
     comparison is unreadable. Zero commits among the rollovers means nothing
     until you know what the same column says for the sessions beside them.

     `commit_count > 0` rather than `is not null`: the column is written with a
     zero rather than left empty, so a null test would answer that every
     rollover recorded its commits and every one of them happened to make none.
     That is exactly the reading this article exists to correct. The four text
     columns get the empty-string test as well as the null test, because a
     column trimmed to nothing is a column that was never filled in. */
  const wrote = (column) =>
    `coalesce(sum(case when ${column} is not null and trim(${column}) != ''
                       then 1 else 0 end), 0)`;
  const blank = { sessions: 0, commits: 0, gateSummaries: 0, claims: 0, results: 0, digests: 0 };
  const records = { rolled: { ...blank }, other: { ...blank } };
  for (const row of all(
    `select case when outcome = 'RolledOver' then 1 else 0 end as rolled,
            count(*) as sessions,
            coalesce(sum(case when commit_count > 0 then 1 else 0 end), 0) as commits,
            ${wrote("gate_summary")} as gateSummaries,
            ${wrote("newly_done")} as claims,
            ${wrote("result_summary")} as results,
            ${wrote("digest")} as digests
       from sessions where run_id = ? group by rolled`
  )) {
    records[row.rolled === 1 ? "rolled" : "other"] = {
      sessions: row.sessions,
      commits: row.commits,
      gateSummaries: row.gateSummaries,
      claims: row.claims,
      results: row.results,
      digests: row.digests
    };
  }

  /* When the run happened, and the two different answers to "how long".
     ---------------------------------------------------------------------------
     `runs.ended_utc` is NULL for every run whose engine exited without closing
     the record — three of this corpus's eighteen — so the run row cannot be
     asked how long a run took. The sessions can: every session in the store has
     both a start and an end, all 340 of them, which is what makes both numbers
     below computable for every published run rather than for the finished ones
     only.

     They are two genuinely different claims and the site publishes both,
     because publishing either one alone is misleading in a way a reader cannot
     detect:

     - **engine time** is the sum of the session durations — how long the
       machine was actually working. It is the honest answer to "what did this
       cost in time", and it is the one that pairs with the money.
     - **elapsed** is first session start to last session end, gaps included.
       It is how long the run took on a calendar, and it is almost always the
       larger of the two because runs sit overnight waiting for a human.

     One run in this corpus spent 14.8 hours of engine time inside a 107.8-hour
     elapsed span. A site that published only the second would be describing a
     four-day project; only the first, a two-day one. Neither on its own is what
     happened.

     `max(ended_utc)` rather than the last row's end: sessions are ordered by
     start and a long session can finish after a short one that began later. */
  const timing = one(
    `select min(started_utc) as firstStart,
            max(ended_utc) as lastEnd,
            coalesce(sum(
              (julianday(ended_utc) - julianday(started_utc)) * 86400000
            ), 0) as engineMs
       from sessions
      where run_id = ? and started_utc is not null and ended_utc is not null`
  );

  return {
    byCategory,
    records,
    firstStart: timing.firstStart,
    lastEnd: timing.lastEnd,
    engineMs: Math.round(timing.engineMs ?? 0),
    tokensIn: sumOver(byCategory, "tokensIn"),
    tokensOut: sumOver(byCategory, "tokensOut"),
    cacheRead: sumOver(byCategory, "cacheRead"),
    gatesGreen: gates.green,
    gatesTotal: gates.total,
    gatesSkipped: gates.skipped,
    gatesOptional: gates.optional,
    gatesCrashed: gates.crashed,
    bugsFiled: one(`select count(*) as n from bugs where run_id = ?`).n,
    ledgerEntries: one(`select count(*) as n from ledger where run_id = ?`).n,
    rollovers: one(
      `select count(*) as n from sessions where run_id = ? and outcome = 'RolledOver'`
    ).n,
    /* Sessions that recorded agent tokens: 314 of the corpus's 340. Every rate
       on this site names which of the two it divided by, because both are
       defensible and a page that mixes them is wrong twice (SPEC Appendix A).

       The definition is the whole figure. Counting sessions with any agent cost
       row answers 326; counting those with cost above zero answers 325; this
       one, tokens above zero, answers 314. Appendix A's 315 is none of the
       three, which is why the note on the published figure says what it
       counted rather than repeating a number somebody else arrived at. */
    costedSessions: one(
      `select count(distinct session_number) as n from costs
        where run_id = ? and category = 'agent'
          and (tokens_in + tokens_out + tokens_cache) > 0`
    ).n,
    softBreaks: events.SoftBreakRequested ?? 0,
    ownerApprovals: events.OwnerApprovalGranted ?? 0,
    events
  };
}

const sumOver = (byCategory, field) =>
  Object.values(byCategory).reduce((total, row) => total + row[field], 0);

/** What `conductor money` says about one run, which SQL here may not answer.
    ---------------------------------------------------------------------------
    The rule at the top of this file says money-shaped figures come from the
    verb. This is that rule wired up rather than merely written down: one call
    per published run, scoped with `--run` because a run.db holds several runs
    and the bare positional argument prices the whole file — the web fleet's
    three rounds share one database, so an unscoped call answers for all three.

    Two fields of the verb's own output are deliberately dropped on the floor
    and never reach the returned object: `plan` and `repo`. They are a plan's
    real name and a path on somebody's machine, and this site publishes neither
    (SPEC Part VI). What comes back is numbers and a stage count.

    Stage labels are dropped for the same reason. A stage id is usually opaque —
    `S4`, `A1` — but "usually" is not a rule, and a plan is free to name a stage
    after the client it is for. The dearest stage is published as *a* stage of
    this run, which is all the argument needs. */
export function readMoney(runId) {
  const raw = execSync(`conductor money --run ${runId} --json`, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  const priced = JSON.parse(raw.replace(/^﻿/, "")).runs?.find((run) => run.runId === runId);
  if (!priced) {
    throw new Error(
      `conductor money --run ${short(runId)} priced no run with that id. The verb is the only ` +
        `source this site allows for money-shaped figures, so a silent zero here would be a ` +
        `published claim with nothing behind it.`
    );
  }

  const total = priced.total ?? {};
  const stages = priced.stages ?? [];
  /* Ties go to the first stage, which is arbitrary and harmless: two stages
     that cost the same amount make the same point about the same run. */
  const dearest = stages.reduce((worst, stage) => (worst && worst.costUsd >= stage.costUsd ? worst : stage), null);

  return {
    stages: stages.length,
    costUsd: total.costUsd ?? 0,
    tokensPerCheckpoint: total.tokensPerCheckpoint ?? 0,
    costPerMillionTokens: total.costPerMillionTokens ?? 0,
    cacheReadShare: total.cacheReadShare ?? 0,
    dearestStage: dearest
      ? {
          costUsd: dearest.costUsd ?? 0,
          sessions: dearest.sessions ?? 0,
          checkpoints: dearest.checkpoints ?? 0,
          /* A run that cost nothing has no dearest stage worth a share, and
             dividing by its zero would publish NaN. */
          share: total.costUsd > 0 ? (dearest.costUsd ?? 0) / total.costUsd : 0
        }
      : { costUsd: 0, sessions: 0, checkpoints: 0, share: 0 }
  };
}

/** What `conductor budget` says about one run's ceilings, window by window.
    ---------------------------------------------------------------------------
    A *window* is a stretch of consecutive sessions that ran under one ceiling.
    A run has more than one whenever somebody changed the cap mid-run, and those
    are the interesting runs: the same repo, the same plan, the same agents,
    with one number moved. That is as close to a controlled experiment as this
    corpus gets, and it is why windows are published as their own entities
    rather than folded into a run average — an average across a cap change is a
    number about nothing.

    `label` comes back from the verb as a human string (`8M / nudge 6.07M`, `no
    ceiling observed`) and is deliberately NOT what content cites: it carries a
    rounded figure, and the key a page names has to stay an identifier. The key
    is built in `windowEntries` below.

    Two fields of the verb's output are dropped here for the same reason
    `readMoney` drops them: `plan` is a plan's real name and `repo` is a path on
    somebody's machine. Neither is publishable (SPEC Part VI). */
export function readBudget(runId) {
  const raw = execSync(`conductor budget ${runId} --json`, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  const profiled = JSON.parse(raw.replace(/^﻿/, "")).runs?.find((run) => run.runId === runId);
  if (!profiled) {
    throw new Error(
      `conductor budget ${short(runId)} profiled no run with that id. Cap-shaped figures have ` +
        `exactly one allowed source, so a silent default here would publish a ceiling nobody ` +
        `measured.`
    );
  }
  return {
    /* Absent on a run that never changed its cap, because there is nothing to
       compare. Kept as null rather than 1, which would read as "no benefit
       measured" when the truth is "not measurable on this run". */
    capPayoff: profiled.capPayoff ?? null,
    windows: (profiled.windows ?? []).map((w) => ({
      capTokens: w.capTokens ?? null,
      capMeasured: Boolean(w.capMeasured),
      nudgeTokens: w.nudgeTokens ?? null,
      nudgeRatio: w.nudgeRatio ?? null,
      headroomTokens: w.headroomTokens ?? null,
      firstSession: w.firstSession ?? 0,
      lastSession: w.lastSession ?? 0,
      sessions: w.sessions ?? 0,
      costedSessions: w.costedSessions ?? 0,
      tokens: w.tokens ?? 0,
      checkpoints: w.checkpoints ?? 0,
      tokensPerCheckpoint: w.tokensPerCheckpoint ?? 0,
      rollovers: w.rollovers ?? 0,
      rolloverRate: w.rolloverRate ?? 0,
      nudged: w.nudged ?? 0,
      nudgedAndEndedClean: w.nudgedAndEndedClean ?? 0,
      closers: w.closers ?? 0,
      floorTokens: w.floorTokens ?? 0,
      medianCloserTokens: w.medianCloserTokens ?? 0,
      maxCloserTokens: w.maxCloserTokens ?? 0,
      wrapUpTokens: w.wrapUp?.median ?? null,
      wrapUpSamples: w.wrapUp?.samples ?? 0
    }))
  };
}

/** Every run the engine knows about, with its store read alongside it.
    ---------------------------------------------------------------------------
    Runs are grouped by database so each file is opened once, and only the runs
    that survived anonymisation are opened at all — which is also why the live
    run writing this very session is never touched. */
export function collect({ history = readHistory(), published } = {}) {
  const wanted = history.filter((run) => published(run));
  const byDb = new Map();
  for (const run of wanted) {
    if (!byDb.has(run.runDb)) byDb.set(run.runDb, []);
    byDb.get(run.runDb).push(run);
  }

  const collected = [];
  for (const [path, runs] of byDb) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      for (const run of runs) {
        collected.push({
          runId: run.runId,
          status: run.status,
          startedUtc: run.startedUtc,
          endedUtc: run.endedUtc,
          repo: run.repo,
          sessions: run.sessions,
          checkpointsDone: run.checkpointsDone ?? 0,
          checkpointsTotal: run.checkpointsTotal ?? 0,
          costUsd: run.costUsd ?? 0,
          store: readStore(db, run.runId),
          money: readMoney(run.runId),
          budget: readBudget(run.runId)
        });
      }
    } finally {
      db.close();
    }
  }
  /* By the first session rather than by `runs.started_utc`, for the reason
     `runEntry` spells out: resuming a run rewrites that column, so sorting on
     it files a run that began on 29 July between two that began on 2 August —
     directly under the date the row itself publishes. */
  return collected.sort((a, b) => a.store.firstStart.localeCompare(b.store.firstStart));
}

/* ---------------------------------------------------------------------------
   Shaping
   --------------------------------------------------------------------------- */

/** A figure: the number, the string a page prints, and where it came from.
    ---------------------------------------------------------------------------
    `source` is on every one of these because litmus test 1 is not "the number
    is right", it is "a reader can see where it came from". `note` carries the
    denominator wherever the figure is a rate, which is the other half of the
    same promise — `$9.37 a session` is two different claims depending on
    whether the divisor was 340 sessions or the 315 that recorded tokens. */
const figure = (value, display, label, source, note) => ({
  value,
  display,
  label,
  source,
  ...(note ? { note } : {})
});

const usd = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plain = (n) => n.toLocaleString("en-US");
const round2 = (n) => Math.round(n * 100) / 100;
/** A share of something, printed the way a reader reads one. */
const pct = (n) => `${round1(n * 100)}%`;

/** Token counts in the unit a reader can hold. 3,880,400,466 is unreadable;
    3.8B is the fact. The full number stays in `value` for recomputation. */
function big(n) {
  if (n >= 1e9) return `${round1(n / 1e9)}B`;
  if (n >= 1e6) return `${round1(n / 1e6)}M`;
  if (n >= 1e3) return `${round1(n / 1e3)}K`;
  return String(n);
}
const round1 = (n) => (Math.round(n * 10) / 10).toString();

/** A span of time, in the two units a reader actually holds it in.
    ---------------------------------------------------------------------------
    Two units and never three: "4d 12h" is a duration, "4d 12h 37m 12s" is a
    stopwatch reading, and nothing on this site is decided by the seconds. The
    unit pair steps down with the magnitude so the second one always carries
    information — days and hours, then hours and minutes, then minutes alone.

    A zero second unit is dropped rather than printed, because "6h 0m" reads as
    a measurement that came out suspiciously round when it is simply six hours.
    Under a minute prints as "<1m": the corpus has sessions that lasted seconds,
    and rounding those to "0m" would publish a run that took no time at all. */
function duration(ms) {
  if (ms < 60_000) return "<1m";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

/** A date the way a reader says one, from an ISO instant.
    ---------------------------------------------------------------------------
    `en-GB` in UTC, so "31 Jul 2026" rather than "7/31/2026" — the corpus is
    published to readers in more than one country and the ambiguous ordering is
    the one format that can be read as two different days. UTC because the store
    records UTC and rendering it in the harvest machine's zone would make the
    published date depend on who ran the harvest. */
const dayOf = (iso) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });

/** The span a pair of instants covers, gaps and all. */
const spanMs = (from, to) => Date.parse(to) - Date.parse(from);

/** Whether the run row's start lands on a different DAY from the first session.
    ---------------------------------------------------------------------------
    Resuming a run rewrites `runs.started_utc` and leaves the sessions alone, so
    the two disagree on nearly every run that ran for more than one sitting. The
    published date is what a reader sees, so the note is worth printing only
    when the disagreement would change it — comparing days rather than instants
    keeps it off the fourteen runs where the row is merely a few hours late and
    on the four where the row names a different date entirely. */
const resumeGap = (run, store) => dayOf(run.startedUtc) !== dayOf(store.firstStart);

/** One run, published under the name `anonymise.json` gave it. */
function runEntry(run, mapped) {
  const s = run.store;
  /* Required rather than defaulted. A missing money block means the verb was
     not asked, and the honest outcome of that is a failure here — a zeroed
     default would publish "$0.00 in the run's dearest stage" and look like a
     measurement. */
  if (!run.money) {
    throw new Error(
      `${mapped.label}: no money block. Money-shaped figures come from \`conductor money\`, so a ` +
        `run collected without it cannot be published.`
    );
  }
  const m = run.money;
  const money = MONEY;
  return {
    label: mapped.label,
    scenario: mapped.scenario,
    repoKey: mapped.repoKey,
    status: disposition(run, mapped),
    startedUtc: run.startedUtc,
    /* The store's own answer where it has one, and the sessions' where it does
       not. A run whose engine exited without closing the record has a NULL
       `ended_utc`, so `endedUtc` here is the last session's end — which is the
       true last moment the run did anything, and is what the abandoned runs are
       published with. `runClosed` says which of the two a reader is looking at,
       so the page can mark an ending that was inferred rather than recorded. */
    endedUtc: run.endedUtc ?? s.lastEnd,
    runClosed: Boolean(run.endedUtc),
    figures: {
      /* Both ends come from the sessions, not from the run row, and that is a
         departure from rule 1 at the top of this file with a measured reason.
         Rule 1 is about *checkpoints*, which the engine folds out of its event
         log and SQL undercounts. Timestamps are the opposite case: the run row
         is rewritten when a run is resumed, and the sessions are not.

         `the-engine-run` is the proof. `conductor history` gives its start as
         2 Aug 10:38; its first session ran on 29 Jul 00:28, twenty-six sessions
         before the four-day gap it was resumed across. Published from the run
         row it is a two-hour run, which is what this site said about it until
         the duration figures went in and the two numbers had to agree. The
         sessions are what actually happened, so the sessions are what ships —
         and where the run row disagrees, the note says so rather than leaving a
         reader to wonder why the date moved. */
      startedOn: figure(
        Date.parse(s.firstStart),
        dayOf(s.firstStart),
        "started",
        STORE,
        resumeGap(run, s)
          ? `the run record says ${dayOf(run.startedUtc)} — that is when it was resumed, not when it began`
          : undefined
      ),
      endedOn: figure(
        Date.parse(s.lastEnd),
        dayOf(s.lastEnd),
        run.endedUtc ? "ended" : "last active",
        STORE,
        run.endedUtc
          ? undefined
          : "the engine exited without closing the record, so this is the last session's end rather than a recorded finish"
      ),
      /* See `readStore`'s note: two different claims, both published, because
         either one alone describes a project that did not happen. */
      engineTime: figure(
        s.engineMs,
        duration(s.engineMs),
        "of engine time",
        STORE,
        "the session durations added up — how long the machine was actually working, gaps excluded"
      ),
      elapsed: figure(
        spanMs(s.firstStart, s.lastEnd),
        duration(spanMs(s.firstStart, s.lastEnd)),
        "start to finish",
        STORE,
        "first session to last on a calendar, including every hour the run sat waiting for a human"
      ),
      sessions: figure(run.sessions, plain(run.sessions), "sessions", HISTORY),
      checkpointsDone: figure(
        run.checkpointsDone,
        `${run.checkpointsDone}/${run.checkpointsTotal}`,
        "checkpoints closed",
        HISTORY
      ),
      checkpointsTotal: figure(
        run.checkpointsTotal,
        plain(run.checkpointsTotal),
        "checkpoints planned",
        HISTORY
      ),
      costUsd: figure(round2(run.costUsd), usd(round2(run.costUsd)), "spent", HISTORY),
      tokensIn: figure(s.tokensIn, big(s.tokensIn), "tokens in", STORE),
      tokensOut: figure(s.tokensOut, big(s.tokensOut), "tokens out", STORE),
      cacheRead: figure(s.cacheRead, big(s.cacheRead), "cache read", STORE),
      /* The three above, added. It exists because the corpus table needs one
         token column and picking any one of the three would be a choice the
         heading could not explain — `tokensIn` alone understates a run by two
         orders of magnitude, since the cache reads are 98% of what moved. The
         split stays published beside it for anyone who needs it. */
      tokens: figure(
        s.tokensIn + s.tokensOut + s.cacheRead,
        big(s.tokensIn + s.tokensOut + s.cacheRead),
        "tokens",
        STORE,
        "in, out and cache read together — the cache reads are most of any run's total"
      ),
      gatesGreen: figure(s.gatesGreen, `${s.gatesGreen}/${s.gatesTotal}`, "gates green", STORE),
      gatesTotal: figure(s.gatesTotal, plain(s.gatesTotal), "gates run", STORE),
      gatesRed: figure(
        s.gatesTotal - s.gatesGreen,
        plain(s.gatesTotal - s.gatesGreen),
        "gates red",
        STORE,
        "every one of them required: no gate in this corpus was skipped or optional"
      ),
      rollovers: figure(s.rollovers, plain(s.rollovers), "rollovers", STORE),
      softBreaks: figure(s.softBreaks, plain(s.softBreaks), "soft breaks", STORE),
      ownerApprovals: figure(s.ownerApprovals, plain(s.ownerApprovals), "owner approvals", STORE),
      bugsFiled: figure(s.bugsFiled, plain(s.bugsFiled), "bugs filed", STORE),
      ledgerEntries: figure(s.ledgerEntries, plain(s.ledgerEntries), "ledger entries", STORE),

      /* From the verb, not from here. See `MONEY` and `refuseBudgetShaped`. */
      tokensPerCheckpoint: figure(
        m.tokensPerCheckpoint,
        big(m.tokensPerCheckpoint),
        "tokens per checkpoint closed",
        money,
        `every token the run spent, over the ${run.checkpointsDone} checkpoints it closed`
      ),
      costPerMillionTokens: figure(
        m.costPerMillionTokens,
        usd(m.costPerMillionTokens),
        "per million tokens, blended",
        money,
        "what the run paid for a million tokens of any kind — the cache reads are most of them, and they are the cheap ones"
      ),
      cacheReadShare: figure(
        m.cacheReadShare,
        pct(m.cacheReadShare),
        "of the run's tokens were cache reads",
        money
      ),
      dearestStageCostUsd: figure(
        round2(m.dearestStage.costUsd),
        usd(round2(m.dearestStage.costUsd)),
        "in the run's dearest single stage",
        money,
        `the dearest of the ${m.stages} stages this run ran`
      ),
      dearestStageShare: figure(
        m.dearestStage.share,
        pct(m.dearestStage.share),
        "of the run, spent in that one stage",
        money
      ),
      dearestStageSessions: figure(
        m.dearestStage.sessions,
        plain(m.dearestStage.sessions),
        "sessions in that stage",
        money,
        `of the ${run.sessions} the whole run took`
      ),
      dearestStageCheckpoints: figure(
        m.dearestStage.checkpoints,
        plain(m.dearestStage.checkpoints),
        "checkpoints closed in it",
        money
      )
    }
  };
}

/** The windows of one run, keyed by what a page is allowed to cite.
    ---------------------------------------------------------------------------
    A third namespace, and it earns its own because a window is neither the
    corpus nor a run: it is one stretch of sessions under one ceiling, and the
    whole argument about caps is a comparison *between* two of them inside the
    same run. Averaged to the run they cancel out — `the-long-build` reads as a
    perfectly ordinary 15.5M per checkpoint until it is split into the three
    ceilings it actually ran under.

    Unlike the run namespace, a window is NOT required to carry every key, and
    that is a fact rather than a slip: a window with no ceiling has no nudge, no
    headroom and no wrap-up, because nothing was ever asked to wrap up. Zero
    would be a measurement and it is not one. `resolveEvidence` renders the keys
    a window has and refuses a key no named window has at all.

    The key is built rather than taken from the verb's own `label`, which reads
    `8M / nudge 6.07M` — a slash and two figures, which is not an identifier and
    would put a rounded number where content has to name a key. */
function windowEntries(run, mapped) {
  if (!run.budget) {
    throw new Error(
      `${mapped.label}: no budget block. A ceiling cannot be recomputed from the store — ` +
        `runs.limits_json is NULL for every imported run — so a run collected without ` +
        `\`conductor budget\` cannot publish a window.`
    );
  }

  const entries = {};
  for (const w of run.budget.windows) {
    const key = w.capMeasured
      ? `${mapped.label}-capped-${round1(w.capTokens / 1e6).replace(".", "-")}m`
      : `${mapped.label}-uncapped`;
    if (entries[key]) {
      throw new Error(
        `${mapped.label} has two windows that would both be published as "${key}". A window key ` +
          `is what content cites, so it has to name exactly one stretch of sessions.`
      );
    }
    entries[key] = {
      key,
      run: mapped.label,
      capMeasured: w.capMeasured,
      scenario:
        `${mapped.scenario} — sessions ${w.firstSession} to ${w.lastSession}, ` +
        `${w.capMeasured ? "under a measured ceiling" : "with no ceiling in force"}`,
      figures: windowFigures(w)
    };
  }
  return entries;
}

/** One window's figures. Every one of them came back from `conductor budget`. */
function windowFigures(w) {
  const budget = BUDGET;
  const shared = {
    windowSessions: figure(w.sessions, plain(w.sessions), "sessions in this window", budget),
    windowCostedSessions: figure(
      w.costedSessions,
      plain(w.costedSessions),
      "of them recorded tokens",
      budget,
      "the divisor for every per-session figure here: a session that recorded none cannot be averaged"
    ),
    windowCheckpoints: figure(w.checkpoints, plain(w.checkpoints), "checkpoints closed", budget),
    windowTokens: figure(w.tokens, big(w.tokens), "tokens spent in the window", budget),
    windowTokensPerCheckpoint: figure(
      w.tokensPerCheckpoint,
      big(w.tokensPerCheckpoint),
      "tokens per checkpoint closed",
      budget,
      "this window's tokens over this window's checkpoints — never one window's cost over another's count"
    ),
    windowRollovers: figure(
      w.rollovers,
      `${w.rollovers}/${w.sessions}`,
      "sessions killed at the ceiling",
      budget
    ),
    windowRolloverRate: figure(w.rolloverRate, pct(w.rolloverRate), "rollover rate", budget),
    windowFloor: figure(
      w.floorTokens,
      big(w.floorTokens),
      "floor — the cheapest session in the window",
      budget
    ),
    windowMedianCloser: figure(
      w.medianCloserTokens,
      big(w.medianCloserTokens),
      "median session that closed a checkpoint",
      budget,
      `over the ${w.closers} sessions in this window that closed one`
    ),
    windowMaxCloser: figure(
      w.maxCloserTokens,
      big(w.maxCloserTokens),
      "largest session that closed a checkpoint",
      budget
    )
  };

  if (!w.capMeasured) return shared;

  const capped = {
    ...shared,
    windowCap: figure(w.capTokens, big(w.capTokens), "ceiling in force", budget),
    windowNudge: figure(
      w.nudgeTokens,
      big(w.nudgeTokens),
      "where the cooperative break fired",
      budget
    ),
    windowNudgeVsFloor: figure(
      w.nudgeTokens / w.floorTokens,
      `${round2(w.nudgeTokens / w.floorTokens)}x`,
      "the nudge, against this window's floor",
      budget
    ),
    windowNudgeVsMedianCloser: figure(
      w.nudgeTokens / w.medianCloserTokens,
      `${round2(w.nudgeTokens / w.medianCloserTokens)}x`,
      "the nudge, against the median closing session",
      budget,
      "below one means the typical session that finished something was interrupted before it could have"
    ),
    windowHeadroom: figure(
      w.headroomTokens,
      big(w.headroomTokens),
      "left between the nudge and the ceiling",
      budget
    ),
    windowNudged: figure(w.nudged, plain(w.nudged), "sessions that were nudged", budget),
    windowNudgesHonoured: figure(
      w.nudgedAndEndedClean,
      plain(w.nudgedAndEndedClean),
      "of them stopped and ended clean",
      budget
    ),
    windowKilledAfterANudge: figure(
      w.nudged - w.nudgedAndEndedClean,
      plain(w.nudged - w.nudgedAndEndedClean),
      "were nudged, carried on, and were killed",
      budget
    )
  };

  /* No wrap-up sample means no session in this window was ever nudged, so
     there is nothing measured to compare the headroom against. The verb falls
     back to an assumed figure for its own prescription; this site does not
     publish an assumption as a measurement. */
  if (w.wrapUpTokens === null) return capped;

  return {
    ...capped,
    windowWrapUp: figure(
      w.wrapUpTokens,
      big(w.wrapUpTokens),
      "median wrap-up after a nudge",
      budget,
      `measured over the ${w.wrapUpSamples} sessions here that took one and stopped`
    ),
    windowHeadroomVsWrapUp: figure(
      w.headroomTokens / w.wrapUpTokens,
      `${round2(w.headroomTokens / w.wrapUpTokens)}x`,
      "headroom, against the measured wrap-up",
      budget,
      "the reserve is absolute: a session needs the same tokens to finish whatever the ceiling is"
    )
  };
}

/** What a run's state actually was, which the store cannot always say.
    ---------------------------------------------------------------------------
    Four runs in this corpus are still marked `running`. Three are July runs
    whose engine exited without closing the record — abandoned, and the reports
    must not present them as in flight. The fourth is genuinely paused and
    somebody means to come back to it. Nothing in the store separates those two,
    so `anonymise.json` says which, and a `running` run without a `disposition`
    is refused rather than guessed at.

    `closed` is the SAME hole and arrived after this was written. Conductor's
    `run close` verb exists because an engine that was killed, rebooted or reaped
    with its shell never got to close its own record; an operator writes a
    terminal status by hand. What that status carries is "somebody closed this
    record", not "this is how the work ended" — the store still cannot tell the
    abandoned from the resumable. When those four rows were closed through the
    new verb they stopped saying `running` and started saying `closed`, and this
    function waved them straight through to a word RunTable.astro paints in no
    role. The disposition is the answer for both. */
const UNRESOLVED = new Set(["running", "closed"]);

function disposition(run, mapped) {
  if (!UNRESOLVED.has(run.status.toLowerCase())) return run.status.toLowerCase();
  if (!mapped.disposition) {
    throw new Error(
      `anonymise.json: run ${short(run.runId)} ("${mapped.label}") is marked ${run.status} in the ` +
        `store, so it needs a "disposition" — "abandoned" or "paused". The store cannot tell a ` +
        `July run whose engine exited from one somebody means to resume, and publishing the ` +
        `wrong one of those is publishing a lie about whether the work is finished.`
    );
  }
  return mapped.disposition;
}

const short = (runId) => runId.slice(0, 8);

/** Corpus-wide figures.
    ---------------------------------------------------------------------------
    Deliberately a different namespace from the per-run ones: `totalSessions` is
    the corpus, `sessions` is one run. `assertDisjoint` below refuses a key that
    lands in both, because a page naming `sessions` beside three runs and a page
    naming it alone would otherwise be asking for two different numbers under
    one word. */
function corpusFigures(runs, repoKeys) {
  const sum = (pick) => runs.reduce((total, run) => total + pick(run), 0);
  const sessions = sum((r) => r.sessions);
  const costed = sum((r) => r.store.costedSessions);
  const cost = round2(sum((r) => r.costUsd));
  const done = sum((r) => r.checkpointsDone);
  const planned = sum((r) => r.checkpointsTotal);
  const green = sum((r) => r.store.gatesGreen);
  const gates = sum((r) => r.store.gatesTotal);
  const runsRed = runs.filter((r) => r.store.gatesTotal > r.store.gatesGreen).length;

  const perSession = round2(cost / sessions);
  const perCheckpoint = round2(cost / done);

  /* See the two time figures below. `engineMs` sums the runs; `corpusMs` is the
     outer envelope of all of them, which is a min/max rather than a sum because
     runs in this corpus overlap — two were in flight on the same afternoon. */
  const engineMs = sum((r) => r.store.engineMs);
  const firstStart = runs.map((r) => r.store.firstStart).sort()[0];
  const lastEnd = runs.map((r) => r.store.lastEnd).sort().at(-1);
  const corpusMs = spanMs(firstStart, lastEnd);

  const tokensIn = sum((r) => r.store.tokensIn);
  const tokensOut = sum((r) => r.store.tokensOut);
  const cacheRead = sum((r) => r.store.cacheRead);
  const allTokens = tokensIn + tokensOut + cacheRead;
  const cacheShare = allTokens > 0 ? cacheRead / allTokens : 0;

  /* The lanes. `costs.category` is how the store separates the delivering agent
     from the two cheap things beside it, and the split is the whole of what
     concept 2 has to say — an orchestrator is not many expensive models, it is
     one expensive model and some arithmetic. Three categories, not two: the
     plan document said "agent vs advisor" from a hand query and the store also
     carries `gate`. Publishing all three is what stops the page rounding the
     third one away. */
  const inCategory = (name) => round2(sum((r) => r.store.byCategory[name]?.costUsd ?? 0));

  /* The ceilings, summed across every window the verb measured one in. This is
     the only place the corpus aggregates windows, and it is here rather than in
     a page because the fact it produces is corpus-wide and holds nowhere
     smaller: whether the cooperative break has *ever* worked as designed.
     Summing what `conductor budget` answered is not the same as computing it
     here — the source stays the verb, and `refuseBudgetShaped` still checks. */
  const capped = runs.flatMap((r) => r.budget.windows.filter((w) => w.capMeasured));
  const overCapped = (pick) => capped.reduce((total, w) => total + pick(w), 0);
  const underACeiling = overCapped((w) => w.sessions);
  const nudged = overCapped((w) => w.nudged);
  const honoured = overCapped((w) => w.nudgedAndEndedClean);
  const killed = overCapped((w) => w.rollovers);

  /* The two populations article 4 compares: every session that rolled over,
     and every session that did not. Both come from the same five columns of
     the same table, so the only thing that differs between the two halves is
     the outcome — which is what makes the contrast a measurement rather than a
     pair of counts that happen to sit next to each other. */
  const rolled = (pick) => sum((r) => pick(r.store.records.rolled));
  const other = (pick) => sum((r) => pick(r.store.records.other));
  const rolledSessions = rolled((rec) => rec.sessions);
  const otherSessions = other((rec) => rec.sessions);

  return {
    totalRuns: figure(runs.length, plain(runs.length), "runs", HISTORY),
    totalRepos: figure(repoKeys.size, plain(repoKeys.size), "repositories", "anonymise.json"),
    totalSessions: figure(sessions, plain(sessions), "sessions", HISTORY),
    costedSessions: figure(
      costed,
      plain(costed),
      "sessions that recorded agent tokens",
      STORE,
      `of ${sessions} sessions in all; the rest recorded no agent spend at all`
    ),
    totalCheckpointsDone: figure(done, `${done}/${planned}`, "checkpoints closed", HISTORY),
    totalCheckpointsPlanned: figure(planned, plain(planned), "checkpoints planned", HISTORY),

    /* Time, corpus-wide, and the same two claims the runs make one at a time.
       ---------------------------------------------------------------------
       `totalEngineTime` sums the runs, so overlapping runs are counted twice
       over — which is correct for the question it answers ("how many machine
       hours are behind this site") and wrong for any question about a clock on
       a wall. The note says so on the page rather than here, because a reader
       who sees 130 hours inside a 27-day window will otherwise do the division
       and conclude the machine was idle 80% of the time.

       `corpusSpan` is the calendar the whole thing happened in: the earliest
       session in the corpus to the latest. It is the figure that makes the rest
       of them legible — $3,016 and 340 sessions mean one thing over three years
       and quite another over one month. */
    totalEngineTime: figure(
      engineMs,
      duration(engineMs),
      "of engine time",
      STORE,
      `every session's duration added up, across all ${runs.length} runs; runs that overlapped are counted in both`
    ),
    corpusSpan: figure(
      corpusMs,
      duration(corpusMs),
      "from the first session to the last",
      STORE,
      "the calendar the whole corpus happened in, not the time anything was working"
    ),
    corpusFirstDay: figure(
      Date.parse(firstStart),
      dayOf(firstStart),
      "first session in the corpus",
      STORE
    ),
    corpusLastDay: figure(
      Date.parse(lastEnd),
      dayOf(lastEnd),
      "last session in the corpus",
      STORE
    ),
    totalCostUsd: figure(cost, usd(cost), "spent across the corpus", HISTORY),
    totalAgentCostUsd: figure(
      inCategory("agent"),
      usd(inCategory("agent")),
      "on the delivering agent",
      STORE,
      "the sessions that did the work, metered by the agent CLI's own token accounting"
    ),
    totalGateCostUsd: figure(
      inCategory("gate"),
      usd(inCategory("gate")),
      "on running the gates",
      STORE,
      "the batteries themselves: real commands, real exit codes, no model in the loop"
    ),
    totalAdvisorCostUsd: figure(
      inCategory("advisor"),
      usd(inCategory("advisor")),
      "on the advisor lane",
      STORE,
      "priced by the engine at a flat rate per second of advisor wall-clock, not metered from the model — an estimate of a lane whose real cost is too small for the ledger to have measured"
    ),
    totalTokensIn: figure(tokensIn, big(tokensIn), "tokens in", STORE),
    totalTokensOut: figure(tokensOut, big(tokensOut), "tokens out", STORE),
    totalCacheRead: figure(cacheRead, big(cacheRead), "cache read", STORE),
    /* The corpus-wide partner of the per-run `tokens`, and the footer of that
       column in the table on `/runs`. */
    totalTokens: figure(
      allTokens,
      big(allTokens),
      "tokens",
      STORE,
      "in, out and cache read together across the whole corpus"
    ),
    /* The shape of the bill rather than its size, and the one figure that
       explains why a corpus of billions of tokens cost thousands of dollars
       rather than tens of thousands. Numerator and denominator are both
       published above it, so a reader can do the division themselves — which
       is the only reason a derived share belongs on this site at all. */
    totalCacheReadShare: figure(
      cacheShare,
      pct(cacheShare),
      "of the corpus's tokens were cache reads",
      STORE,
      "cache read over cache read plus in plus out; the three counts are published beside it"
    ),
    totalGatesGreen: figure(green, `${green}/${gates}`, "gates green", STORE),
    totalGatesRun: figure(gates, plain(gates), "gates run", STORE),
    totalGatesRed: figure(gates - green, plain(gates - green), "gates red", STORE),
    /* The two zeros that make the pass rate mean anything. A battery can be
       green because it passed or because it was allowed not to run, and those
       look identical in a summary line. */
    totalGatesSkipped: figure(
      sum((r) => r.store.gatesSkipped),
      plain(sum((r) => r.store.gatesSkipped)),
      "gates skipped",
      STORE,
      "in the whole corpus — every gate that was configured, ran"
    ),
    totalGatesOptional: figure(
      sum((r) => r.store.gatesOptional),
      plain(sum((r) => r.store.gatesOptional)),
      "gates marked optional",
      STORE,
      "so every red one above was a gate somebody had to answer for"
    ),
    totalGatesCrashed: figure(
      sum((r) => r.store.gatesCrashed),
      plain(sum((r) => r.store.gatesCrashed)),
      "of the red gates never ran at all",
      STORE,
      "an exit status the command did not choose — a process that died starting up, in tens of milliseconds, rather than a check that ran and said no"
    ),
    runsWithARedGate: figure(
      runsRed,
      `${runsRed}/${runs.length}`,
      "runs that ever saw a red gate",
      STORE,
      "the other runs' batteries were green every time they ran"
    ),
    totalRollovers: figure(sum((r) => r.store.rollovers), plain(sum((r) => r.store.rollovers)), "rollovers", STORE),

    /* The ledger block. Ten figures because the claim is a comparison and a
       comparison needs both sides published: the same five columns counted
       over the sessions that rolled over and over the sessions that did not.
       Every one of them names its own denominator in the display string, so a
       reader never has to carry a total down the page to make sense of the
       next number.

       Read as a pair, the two halves invert. Four backward-facing columns are
       near-universal among the sessions that ended normally and empty among
       the rollovers; the one forward-facing column is near-universal among the
       rollovers and present for barely half of everything else. Nothing here
       is a claim about work not done — it is a claim about work not recorded,
       and it is the reason this site publishes what a store says separately
       from what a store proves. */
    sessionsThatRolledOver: figure(
      rolledSessions,
      plain(rolledSessions),
      "sessions ended by being rolled over",
      STORE,
      `counted from the sessions table's own outcome column, out of ${sessions} sessions in the corpus`
    ),
    sessionsThatDidNot: figure(
      otherSessions,
      plain(otherSessions),
      "sessions ended some other way",
      STORE,
      "the comparison population: every session in the corpus whose outcome was not a rollover"
    ),
    rolloversWithACommit: figure(
      rolled((rec) => rec.commits),
      `${rolled((rec) => rec.commits)}/${rolledSessions}`,
      "rolled-over sessions recorded a commit",
      STORE,
      "the column holds a zero rather than nothing at all, which is what makes it read as a measurement instead of a gap"
    ),
    rolloversWithAGateSummary: figure(
      rolled((rec) => rec.gateSummaries),
      `${rolled((rec) => rec.gateSummaries)}/${rolledSessions}`,
      "recorded which gates they ran",
      STORE
    ),
    rolloversWithAClaim: figure(
      rolled((rec) => rec.claims),
      `${rolled((rec) => rec.claims)}/${rolledSessions}`,
      "recorded a checkpoint they closed",
      STORE
    ),
    rolloversWithAResultSummary: figure(
      rolled((rec) => rec.results),
      `${rolled((rec) => rec.results)}/${rolledSessions}`,
      "recorded a result summary",
      STORE
    ),
    rolloversWithADigest: figure(
      rolled((rec) => rec.digests),
      `${rolled((rec) => rec.digests)}/${rolledSessions}`,
      "recorded a digest for the next session",
      STORE,
      "the one field that faces forwards rather than back, and the one field a rollover almost always has"
    ),
    othersWithACommit: figure(
      other((rec) => rec.commits),
      `${other((rec) => rec.commits)}/${otherSessions}`,
      "of the sessions that did not roll over recorded a commit",
      STORE
    ),
    othersWithAGateSummary: figure(
      other((rec) => rec.gateSummaries),
      `${other((rec) => rec.gateSummaries)}/${otherSessions}`,
      "recorded which gates they ran",
      STORE
    ),
    othersWithAClaim: figure(
      other((rec) => rec.claims),
      `${other((rec) => rec.claims)}/${otherSessions}`,
      "recorded a checkpoint they closed",
      STORE
    ),
    othersWithAResultSummary: figure(
      other((rec) => rec.results),
      `${other((rec) => rec.results)}/${otherSessions}`,
      "recorded a result summary",
      STORE
    ),
    othersWithADigest: figure(
      other((rec) => rec.digests),
      `${other((rec) => rec.digests)}/${otherSessions}`,
      "recorded a digest",
      STORE,
      "the inversion: the forward-facing field is the one a normal session most often skips, because the next session did not need it"
    ),
    totalSoftBreaks: figure(
      sum((r) => r.store.softBreaks),
      plain(sum((r) => r.store.softBreaks)),
      "soft breaks",
      STORE,
      "counted from SoftBreakRequested events; the sessions table's own column is empty for every run in the store"
    ),
    totalOwnerApprovals: figure(
      sum((r) => r.store.ownerApprovals),
      plain(sum((r) => r.store.ownerApprovals)),
      "owner approvals",
      STORE
    ),
    totalBugsFiled: figure(sum((r) => r.store.bugsFiled), plain(sum((r) => r.store.bugsFiled)), "bugs filed", STORE),
    totalLedgerEntries: figure(
      sum((r) => r.store.ledgerEntries),
      plain(sum((r) => r.store.ledgerEntries)),
      "ledger entries",
      STORE
    ),
    /* The ceiling block. `totalRollovers` above counts every session the engine
       killed anywhere; these count only the ones that happened under a ceiling
       the verb could measure, which is the population the cap rules are
       actually about. Both are published so the difference is visible rather
       than argued over. */
    cappedWindows: figure(
      capped.length,
      `${capped.length}/${runs.reduce((n, r) => n + r.budget.windows.length, 0)}`,
      "windows that ran under a measured ceiling",
      BUDGET,
      "a window is one stretch of consecutive sessions under one cap; a run has more than one when somebody moved it"
    ),
    sessionsUnderACeiling: figure(
      underACeiling,
      plain(underACeiling),
      "sessions run under a ceiling",
      BUDGET,
      `of ${sessions} in the corpus; the rest had none in force`
    ),
    nudgesDelivered: figure(
      nudged,
      plain(nudged),
      "sessions were nudged to wrap up",
      BUDGET,
      `over ${underACeiling} sessions under a ceiling`
    ),
    nudgesHonoured: figure(
      honoured,
      `${honoured}/${nudged}`,
      "of those stopped and ended clean",
      BUDGET
    ),
    killedAtACeiling: figure(
      killed,
      plain(killed),
      "sessions were killed at a ceiling",
      BUDGET,
      "the ceiling cross is a kill mid-turn: the agent's own commit and handoff step never runs"
    ),
    killedAfterANudge: figure(
      nudged - honoured,
      `${nudged - honoured}/${killed}`,
      "of the killed sessions had already been nudged",
      BUDGET,
      "every one of them was asked to stop first, in time, and carried on anyway — the cooperative rail converted none of them"
    ),
    costPerSession: figure(
      perSession,
      usd(perSession),
      "per session",
      HISTORY,
      `${usd(cost)} over all ${sessions} sessions, not only the ${costed} that recorded agent tokens`
    ),
    costPerCheckpoint: figure(
      perCheckpoint,
      usd(perCheckpoint),
      "per checkpoint closed",
      HISTORY,
      `${usd(cost)} over the ${done} checkpoints that closed, out of ${planned} planned`
    )
  };
}

/** The corpus, from what was collected and what the map allows.
    ---------------------------------------------------------------------------
    Pure: no store, no clock, no filesystem. That is what lets a test hand it a
    run that is not in the map and watch it disappear (S3.2) without going
    anywhere near somebody's real database. */
export function buildCorpus(collected, anonymise) {
  const map = anonymise.runs;
  const runs = {};
  const windows = {};
  const repoKeys = new Set();
  const kept = [];
  const excluded = [];

  for (const run of collected) {
    const mapped = map[short(run.runId)];
    if (!mapped) {
      excluded.push(short(run.runId));
      continue;
    }
    if (runs[mapped.label]) {
      throw new Error(
        `anonymise.json: two runs are both published as "${mapped.label}". A label is what content ` +
          `cites in evidence.runs, so it has to name exactly one run.`
      );
    }
    if (!mapped.repoKey) {
      throw new Error(
        `anonymise.json: "${mapped.label}" has no repoKey. Distinct repoKeys are what the site ` +
          `counts as repositories, so a missing one silently changes a published number.`
      );
    }
    repoKeys.add(mapped.repoKey);
    runs[mapped.label] = runEntry(run, mapped);
    Object.assign(windows, windowEntries(run, mapped));
    kept.push(run);
  }

  /* Failing closed all the way down. With nothing published the corpus rates
     divide by zero and NaN reaches the page as the word "NaN", which is the one
     outcome worse than an empty site — a figure that is visibly wrong is at
     least visibly wrong; a figure that is quietly nonsense is what this whole
     mechanism exists to prevent. */
  if (kept.length === 0) {
    throw new Error(
      `anonymise.json publishes no runs: ${collected.length} run(s) were collected and none of ` +
        `them is in the map. Excluded: ${excluded.join(", ") || "(none collected)"}.`
    );
  }

  const corpus = corpusFigures(kept, repoKeys);
  assertDisjoint(corpus, runs, windows);
  refuseBudgetShaped(corpus, runs, windows);

  /* `excluded` is returned rather than written into the file, and that is not
     tidiness. The count of runs this machine happens to be holding changes
     whenever any other repo starts one, so a corpus.json carrying it would go
     stale for a reason that has nothing to do with anything published — and a
     gate that goes red for reasons nobody can act on is a gate that gets
     switched off. What ships is what was published. */
  return {
    excluded,
    payload: {
      corpus,
      runs,
      windows,
      sources: {
        runLevel: HISTORY,
        store: `${STORE}; every query filtered by run_id`,
        labels: "anonymise.json — a run with no entry is excluded, never renamed",
        budgetShaped:
          "asked of the verbs, never computed here: tokens per checkpoint, blended $/M and the " +
          "stage split come from `conductor money --run <id> --json`; ceilings, nudge points, " +
          "floors, median closers, wrap-up and rollover rates come from " +
          "`conductor budget <run> --json`, window by window"
      }
    }
  };
}

/** One word, one meaning. See `corpusFigures`.
    ---------------------------------------------------------------------------
    Three namespaces now, so three pairs to keep apart. The window one is the
    likeliest to collide by accident, because a window and a run answer the same
    questions at different scales — `sessions` is the obvious name for both, and
    a page naming it beside one run and one window would be asking for two
    different numbers under one word. Hence the `window` prefix, checked here
    rather than trusted. */
function assertDisjoint(corpus, runs, windows) {
  const keysOf = (entries) => new Set(Object.values(entries).flatMap((e) => Object.keys(e.figures)));
  const perRun = keysOf(runs);
  const perWindow = keysOf(windows);
  const clashes = [
    ["a corpus figure and a per-run figure", Object.keys(corpus).filter((k) => perRun.has(k))],
    ["a corpus figure and a per-window figure", Object.keys(corpus).filter((k) => perWindow.has(k))],
    ["a per-run figure and a per-window figure", [...perRun].filter((k) => perWindow.has(k))]
  ].filter(([, keys]) => keys.length > 0);

  if (clashes.length > 0) {
    throw new Error(
      clashes.map(([what, keys]) => `These keys are both ${what}: ${keys.join(", ")}.`).join(" ") +
        ` A page names a key and gets a number; the same key cannot mean the whole corpus on one ` +
        `page and one run — or one window of one run — on the next.`
    );
  }

  /* A window label that is also a run label would make `evidence.runs` and
     `evidence.windows` ambiguous in exactly the place a writer would not look. */
  const bothNamed = Object.keys(windows).filter((label) => label in runs);
  if (bothNamed.length > 0) {
    throw new Error(
      `These are published as both a run and a window: ${bothNamed.join(", ")}.`
    );
  }
}

/** SPEC Part VI, rule zero, as a thrown error rather than a paragraph.
    ---------------------------------------------------------------------------
    `runs.limits_json` is NULL for every imported run, so this script cannot see
    a cap even if it wanted to; and the derived budget figures — floors, median
    closers, wrap-up, rollover rates, tokens per checkpoint, blended $/M — were
    measured wrong by hand once already. They belong to `conductor budget` and
    `conductor money`. A key matching one of these names may still be published,
    but only carrying one of those commands as its source: the test is where the
    number came from, not what it is called. A later session that reaches for one
    of these names over a SQL query finds this instead of a plausible number. */
const BUDGET_SHAPED = [
  /floor/i,
  /median/i,
  /closer/i,
  /wrapUp/i,
  /Rate$/,
  /perMillion/i,
  /blended/i,
  /nudge/i,
  /cap$/i,
  /Cap[A-Z]/,
  /tokensPerCheckpoint/i,
  /headroom/i
];

/** Whether a figure was measured by a verb or computed here.
    ---------------------------------------------------------------------------
    `source` is the check because `source` is also the claim: it is the string
    the evidence strip prints under the number, so a figure that says it came
    from the verb and did not is already lying to a reader on the page. */
const fromAVerb = (figure) => /^conductor (money|budget)\b/.test(figure.source);

export function refuseBudgetShaped(corpus, runs, windows = {}) {
  const entries = [
    ...Object.entries(corpus),
    ...Object.values(runs).flatMap((run) => Object.entries(run.figures)),
    ...Object.values(windows).flatMap((window) => Object.entries(window.figures))
  ];
  const offenders = [
    ...new Set(
      entries
        .filter(([, figure]) => !fromAVerb(figure))
        .filter(([key]) => BUDGET_SHAPED.some((re) => re.test(key)))
        .map(([key]) => key)
    )
  ];
  if (offenders.length > 0) {
    throw new Error(
      `The harvest tried to mint budget-shaped keys from SQL: ${offenders.join(", ")}. ` +
        `Those come from \`conductor budget\` and \`conductor money\`, which read the ledger ` +
        `properly — a hand query of exactly these numbers was contradicted four times over in ` +
        `August 2026. The store cannot even see a cap: runs.limits_json is NULL for every ` +
        `imported run.`
    );
  }
}

/* ---------------------------------------------------------------------------
   The other half of the gate: what the pages actually cite
   ---------------------------------------------------------------------------
   Staleness is only one of the two ways this site's first litmus test fails. A
   corpus that matches the store exactly is still wrong for the page if the page
   names a key it does not have — and that half cannot be checked by looking at
   the corpus alone, because the claim lives in the content.

   `src/lib/evidence.ts` already refuses one at build time, and this is
   deliberately a second implementation of the same rule rather than a shared
   one. It has to be: that file is TypeScript imported by Astro, this runs as
   plain Node inside a gate, and the gate must be able to say "red" without
   Astro's build succeeding first. The build failure it duplicates exits with a
   crash code rather than 1, which is exactly why the gate does not simply
   wrap `npm run build`.
   --------------------------------------------------------------------------- */

const contentDir = join(repoRoot, "src", "content");

/** Every `evidence:` block in the content, with the file that wrote it. */
export function citedEvidence(dir = contentDir) {
  const cited = [];
  let looksLikeEvidence = 0;

  for (const item of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!item.isFile() || !item.name.endsWith(".yaml")) continue;
    const full = join(item.parentPath, item.name);
    const text = readFileSync(full, "utf8");
    if (/^evidence:/m.test(text)) looksLikeEvidence += 1;

    const data = parseYaml(text);
    if (!data?.evidence) continue;
    cited.push({
      where: posix.join(...full.slice(contentDir.length + 1).split(/[\\/]/)),
      runs: data.evidence.runs ?? [],
      windows: data.evidence.windows ?? [],
      figures: data.evidence.figures ?? []
    });
  }

  /* The failure mode of any scanner is under-reporting, and it is silent: a
     file whose evidence block the parser did not see produces a gate that says
     green about a page it never looked at. So the crude grep and the real parse
     have to agree on how many files are in play. */
  if (cited.length !== looksLikeEvidence) {
    throw new Error(
      `The evidence scan parsed ${cited.length} entries but ${looksLikeEvidence} content files ` +
        `have an "evidence:" line. A file the scan cannot see is a page this gate would pass ` +
        `without checking.`
    );
  }

  return cited.sort((a, b) => a.where.localeCompare(b.where));
}

/** Each cited key that has nothing behind it, said the way a writer can act on.
    ---------------------------------------------------------------------------
    Every problem is collected rather than thrown at the first one. A gate that
    reports one missing key, gets fixed, and then reports the next is a gate
    that costs a full run per mistake. */
export function unresolvedCitations(payload, cited = citedEvidence()) {
  const corpusKeys = new Set(Object.keys(payload.corpus));
  const runKeys = new Set(
    Object.values(payload.runs).flatMap((run) => Object.keys(run.figures))
  );
  const windowKeys = new Set(
    Object.values(payload.windows ?? {}).flatMap((window) => Object.keys(window.figures))
  );
  const published = new Set(Object.keys(payload.runs));
  const publishedWindows = new Set(Object.keys(payload.windows ?? {}));
  const problems = [];

  for (const entry of cited) {
    for (const label of entry.runs) {
      if (!published.has(label)) {
        problems.push(
          `${entry.where}: evidence.runs names "${label}", which the corpus does not publish. ` +
            `Either anonymise.json has no entry for that run — in which case it is excluded on ` +
            `purpose and cannot be cited — or the label is a typo.`
        );
      }
    }
    for (const label of entry.windows ?? []) {
      if (!publishedWindows.has(label)) {
        problems.push(
          `${entry.where}: evidence.windows names "${label}", which the corpus does not publish. ` +
            `A window key is its run's label, then the ceiling it ran under — a cap that moved ` +
            `renames the window, and that is the gate working rather than a typo.`
        );
      }
    }
    for (const key of entry.figures) {
      if (corpusKeys.has(key)) continue;
      if (runKeys.has(key)) {
        if (entry.runs.length === 0) {
          problems.push(
            `${entry.where}: evidence.figures names "${key}", a per-run figure, but the page ` +
              `names no runs.`
          );
        }
        continue;
      }
      if (windowKeys.has(key)) {
        /* Windows do not all carry every key — an uncapped one has no nudge —
           so the check is that at least one NAMED window has it. A page citing
           a nudge beside nothing but uncapped windows would otherwise render a
           heading with no figure under it, which is the exact silent hole this
           gate exists for. */
        const named = [...(entry.windows ?? [])].filter((label) =>
          Boolean(payload.windows?.[label]?.figures?.[key])
        );
        if (named.length === 0) {
          problems.push(
            `${entry.where}: evidence.figures names "${key}", a per-window figure, but none of ` +
              `the windows this page names has it. A window with no ceiling in force has no ` +
              `nudge, no headroom and no wrap-up, and publishing a zero there would be inventing ` +
              `a measurement.`
          );
        }
        continue;
      }
      problems.push(
        `${entry.where}: evidence.figures names "${key}", which is not in the corpus. A key with ` +
          `no figure behind it is a claim with no evidence behind it.`
      );
    }
  }
  return problems;
}

/* ---------------------------------------------------------------------------
   Running it
   --------------------------------------------------------------------------- */

export const readAnonymise = () => JSON.parse(readFileSync(anonymisePath, "utf8"));

/** Recompute the whole corpus from the store. */
export function harvest() {
  const anonymise = readAnonymise();
  const listed = readHistory();

  /* One row per run, whatever the verb printed. The engine's history verb
     began listing the three runs of its own repo once per store copy
     (observed 2026-08-13 — the legacy import copies and leaves the original
     in place, so the same run exists in several databases). The same FULL id
     twice is one run shown twice, not two runs, and collapsing identical rows
     is reading the data; rows that share an id but disagree about the run are
     refused, because nothing downstream could know which record to believe. */
  const byId = new Map();
  const history = [];
  for (const run of listed) {
    const before = byId.get(run.runId);
    if (before) {
      if (JSON.stringify(before) !== JSON.stringify(run)) {
        throw new Error(
          `The store lists run ${short(run.runId)} more than once, and the rows disagree. Two ` +
            `records of one run cannot both be true — fix the store before anything is published.`
        );
      }
      continue;
    }
    byId.set(run.runId, run);
    history.push(run);
  }

  /* Prefixes are what a person reads off `conductor history`, so they are what
     the map is keyed by — but only while they are unambiguous. This guard is
     about two DIFFERENT runs colliding at eight characters, which lengthening
     the keys genuinely fixes; the duplicate-listing case is handled above. */
  const seen = new Map();
  for (const run of history) {
    const prefix = short(run.runId);
    if (seen.has(prefix)) {
      throw new Error(
        `Two runs in the store share the id prefix ${prefix}. anonymise.json is keyed by prefix; ` +
          `lengthen both keys before either can be published.`
      );
    }
    seen.set(prefix, run.runId);
  }

  for (const prefix of Object.keys(anonymise.runs)) {
    if (!seen.has(prefix)) {
      throw new Error(
        `anonymise.json names run ${prefix}, which is not in this store. The map has drifted from ` +
          `the data; a label with no run behind it publishes nothing but is one edit away from ` +
          `publishing the wrong thing.`
      );
    }
  }

  /* Only mapped runs are collected, which is also why the live run writing this
     very session is never opened. Fail-closed is checked twice on purpose: here
     it decides which databases get touched at all, and again inside
     `buildCorpus`, which is the half a test can drive without a store. */
  const mapped = (run) => Boolean(anonymise.runs[short(run.runId)]);
  const collected = collect({ history, published: mapped });
  const built = buildCorpus(collected, anonymise);

  return {
    payload: built.payload,
    excluded: [...built.excluded, ...history.filter((run) => !mapped(run)).map((run) => short(run.runId))]
  };
}

/** The file, with the measurement time on it and the data underneath.
    ---------------------------------------------------------------------------
    `generatedAtUtc` is first and is excluded from the staleness comparison on
    purpose: a reader wants to know when the store was read, and a gate that
    failed because the clock moved would be a gate nobody could keep green. */
function serialise(corpus, generatedAtUtc) {
  return `${JSON.stringify({ generatedAtUtc, ...corpus }, null, 2)}\n`;
}

const payloadOf = (json) => {
  const { generatedAtUtc, ...rest } = json;
  return JSON.stringify(rest);
};

/** The half of the evidence gate that needs no run store.
    ---------------------------------------------------------------------------
    `--check` is two questions in one: does the committed corpus still match the
    store, and does every key a page cites have something behind it. The first
    needs the store and therefore only ever runs on the owner's machine. The
    second needs nothing but the committed file and the content — so it can run
    where the site is built, which is where a page citing a key that went away
    would otherwise ship.

    It is a strictly weaker gate and it says so on every run, because a green
    line that reads like the full check is worse than no line at all. */
function citedOnly() {
  let existing;
  try {
    existing = JSON.parse(readFileSync(corpusPath, "utf8"));
  } catch {
    console.error("evidence: src/data/corpus.json is missing or unreadable. Run `npm run harvest`.");
    process.exit(1);
  }

  const cited = citedEvidence();
  const unresolved = unresolvedCitations(existing, cited);
  for (const problem of unresolved) console.error(`evidence: ${problem}`);
  if (unresolved.length > 0) process.exit(1);

  console.log(
    `evidence: every key cited by ${cited.length} content entries resolves against the committed ` +
      `corpus.json — ${existing.corpus.totalRuns.display} runs, ${existing.corpus.totalSessions.display} ` +
      `sessions. NOT CHECKED here, and it is the half that catches a moved number: whether that ` +
      `file still says what the run store says, which needs the store. Run \`npm run evidence\` ` +
      `on a machine that has it.`
  );
}

function main() {
  if (process.argv.includes("--cited")) return citedOnly();

  const check = process.argv.includes("--check");
  const { payload, excluded } = harvest();
  const corpus = payload.corpus;

  /* The gate, and it goes red two ways. Both are run before either is reported,
     because a session that fixes the staleness and then discovers the missing
     key on the next run has paid twice for one gate. */
  if (check) {
    let existing;
    try {
      existing = JSON.parse(readFileSync(corpusPath, "utf8"));
    } catch {
      console.error(
        "evidence: src/data/corpus.json is missing or unreadable. Run `npm run harvest`."
      );
      process.exit(1);
    }

    const stale = payloadOf(existing) !== payloadOf(payload);

    /* Cited keys are checked against what is COMMITTED, not against what was
       just recomputed. The committed file is what the site renders from, so
       when the two disagree it is the committed one whose holes a reader would
       see — and reporting against the fresh corpus would hide a key that the
       stale file is missing behind the staleness message. */
    const unresolved = unresolvedCitations(stale ? existing : payload);

    if (stale) {
      console.error(
        "evidence: src/data/corpus.json is STALE — the store no longer says what the committed " +
          "corpus says. Run `npm run harvest` and commit the result."
      );
      /* Naming what moved, down to the run and the key. "The file is stale" is
         true and useless; the next person needs to know whether a number
         changed, a run appeared, or a run left the corpus — those have three
         different causes and only one of them is "re-run the harvest". */
      const drift = (was, fresh, where) => {
        for (const [key, value] of Object.entries(fresh)) {
          const before = was?.[key];
          if (!before || before.value !== value.value) {
            console.error(
              `  ${where}${key}: committed ${before ? before.display : "(absent)"} → store ${value.display}`
            );
          }
        }
      };
      drift(existing.corpus, payload.corpus, "");
      for (const [label, run] of Object.entries(payload.runs)) {
        const was = existing.runs?.[label];
        if (!was) {
          console.error(`  ${label}: not in the committed corpus at all`);
          continue;
        }
        if (was.status !== run.status) {
          console.error(`  ${label}.status: committed ${was.status} → store ${run.status}`);
        }
        drift(was.figures, run.figures, `${label}.`);
      }
      for (const label of Object.keys(existing.runs ?? {})) {
        if (!payload.runs[label]) {
          console.error(`  ${label}: published, but the store no longer offers it`);
        }
      }
      /* Windows drift for one extra reason runs do not: a cap that moves does
         not change a window's figures, it ends that window and starts another
         under a new key. Reporting the appearance and the disappearance by name
         is what tells the reader which of the two happened. */
      for (const [label, window] of Object.entries(payload.windows)) {
        const was = existing.windows?.[label];
        if (!was) {
          console.error(`  ${label}: a window the committed corpus does not have`);
          continue;
        }
        drift(was.figures, window.figures, `${label}.`);
      }
      for (const label of Object.keys(existing.windows ?? {})) {
        if (!payload.windows[label]) {
          console.error(`  ${label}: published, but the store no longer offers that window`);
        }
      }
    }
    for (const problem of unresolved) console.error(`evidence: ${problem}`);

    if (stale || unresolved.length > 0) process.exit(1);

    console.log(
      `evidence: corpus.json is current — ${corpus.totalRuns.display} runs, ` +
        `${corpus.totalSessions.display} sessions, ${corpus.totalCostUsd.display}; and every ` +
        `key cited by ${citedEvidence().length} content entries resolves.`
    );
    return;
  }

  mkdirSync(dirname(corpusPath), { recursive: true });
  writeFileSync(corpusPath, serialise(payload, new Date().toISOString()), "utf8");
  console.log(
    `harvest: ${corpus.totalRuns.display} runs published, ${excluded.length} excluded by ` +
      `anonymise.json (${excluded.join(", ")}) · ${corpus.totalSessions.display} sessions · ` +
      `${corpus.totalCostUsd.display} · ${corpus.totalGatesGreen.display} gates green`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
