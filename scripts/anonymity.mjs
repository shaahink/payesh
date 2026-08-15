#!/usr/bin/env node
/* The anonymisation check, run over the built output.
   ---------------------------------------------------------------------------
   SPEC Part VI's rule is the one rule on this site that no schema can hold.
   `reportSchema` can insist a report carries a `scenario`; it cannot know that
   the scenario is a thin disguise, and it cannot know that a client's name has
   turned up in the fourth paragraph of the third section. Neither can a human
   reader after the twentieth read, which is exactly when it happens.

   So the rule is enforced where it actually matters — in `dist/`, after the
   build, against the bytes a stranger would download. A report is a scenario
   in the reader's hands, not in the source.

   THE PROBLEM THIS SCRIPT HAS TO SOLVE FIRST: a forbidden-list check needs a
   forbidden list, and this repository is public. Committing the list of names
   that must not appear would publish exactly the names it exists to protect.
   That is not a hypothetical failure mode; it is the obvious way to write this
   check, and it inverts it completely.

   The way out is that the list is never written down. It is DERIVED, at check
   time, from sources that live outside the repository:

     - `conductor history --json --limit 0`, which knows every run's real name,
       its real repository, its plan path and its store path;
     - `docs/dev/FIELD-NOTES-*.md` when they are present, which are deliberately
       untracked and whose PROSE may never be quoted even though their numbers
       may be republished.

   Nothing derived is ever committed, and by default nothing derived is ever
   printed either — a finding names the file, the shape and a redaction, because
   a CI log is a published artefact too and a check that leaks a client's name
   into a build log has failed at its own job while reporting success. Pass
   `--reveal` on the owner's own machine when a finding has to be acted on.

   What survives being public is the ALLOWLIST, and it is short: the repositories
   that may be named, and the vocabulary the owner has already chosen to publish
   in `anonymise.json`. A word the site already says out loud cannot be the thing
   that gives a client away.

   No Astro import and no dependency on the corpus: `test/anonymity.test.mjs`
   drives the pure half of this file with fixtures, so the rule stays tested on
   a machine that has never seen the run store. */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..");
export const distDir = join(repoRoot, "dist");
export const fieldNotesDir = join(repoRoot, "docs", "dev");

/** Repositories that are public and may therefore be named in prose.
    ---------------------------------------------------------------------------
    SPEC Part VI lists these by name. `conductor-site` is on it because it is
    this repository: its own run is in the same store as the private ones, and
    without this line the check would report the site for being about itself. */
export const PUBLIC_NAMES = [
  "conductor",
  "conductor-site",
  "devcontext2",
  "shamshir",
  "sitekit",
  "site-template"
];

/** Words that identify nothing, in a repository path or a plan name.
    ---------------------------------------------------------------------------
    Deliberately short. The real allowlist is the published vocabulary, which
    maintains itself; this only covers the scaffolding words that appear in
    every plan file ever written and would otherwise flood the report. */
export const GENERIC = [
  "main",
  "plan",
  "json",
  "docs",
  "code",
  "repo",
  "test",
  "tests",
  "build",
  "site",
  "sites",
  "website",
  "phase",
  "stage",
  "round",
  "work",
  "feat",
  "https",
  "http"
];

/** Secret shapes, which are safe to commit because they name no one.
    ---------------------------------------------------------------------------
    These are the leaks that arrive by accident rather than by writing: a path
    pasted out of a terminal, a token in an example, an id copied from a chat.
    A pattern is not a name, so this list can live in public. */
export const SHAPES = [
  { name: "a home directory on someone's machine", pattern: /[A-Za-z]:[\\/]Users[\\/]/i },
  { name: "a Unix home directory", pattern: /\/(?:home|Users)\/[A-Za-z0-9._-]+\// },
  { name: "a working copy on the owner's machine", pattern: /[A-Za-z]:[\\/]code[\\/]/i },
  { name: "a reference to the private field notes", pattern: /FIELD[-_ ]?NOTES/i },
  { name: "an API token", pattern: /\b(?:sk-ant-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}/ },
  { name: "a bearer secret", pattern: /\bbearer\s+[A-Za-z0-9._-]{20,}/i },
  { name: "a chat id", pattern: /\bchat[_-]?id["'\s]*[:=]["'\s]*-?\d{5,}/i },
  { name: "a bot token", pattern: /\b\d{8,}:[A-Za-z0-9_-]{30,}\b/ }
];

/* ---------------------------------------------------------------------------
   Redaction
   --------------------------------------------------------------------------- */

/** Enough to find it locally, not enough to be the leak.
    ---------------------------------------------------------------------------
    First character, last character, length. A person who already knows the name
    recognises it instantly; a person who does not learns nothing they could not
    have guessed. Anything shorter than four characters is redacted whole,
    because two of four characters is most of the word. */
export function redact(text) {
  const length = text.length;
  if (length < 4) return `${"·".repeat(length)} (${length} chars)`;
  return `${text[0]}${"·".repeat(length - 2)}${text[length - 1]} (${length} chars)`;
}

/* ---------------------------------------------------------------------------
   Deriving the list nobody may write down
   --------------------------------------------------------------------------- */

const HISTORY = "conductor history --json --limit 0";

/** Every run the engine has ever recorded, real names and all.
    ---------------------------------------------------------------------------
    The BOM strip is the same one `scripts/harvest.mjs` needs: the verb writes
    UTF-8 with a byte order mark on Windows, and `JSON.parse` refuses it with a
    message that names the token rather than the cause. */
export function readHistory() {
  const raw = execSync(HISTORY, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(raw.replace(/^﻿/, "")).runs;
}

const withoutExtension = (name) => name.replace(/\.[A-Za-z0-9.]+$/, "");

/** The words the owner has already decided to publish.
    ---------------------------------------------------------------------------
    Every label, scenario and repo key in `anonymise.json`, lowercased and split
    into words. A token that survives derivation but appears here is a word this
    site says on purpose, so it cannot be the thing that identifies anybody —
    and if it is, the answer is a better scenario rather than a quieter check.
    SPEC Part VI: "if swapping the name back in is the only difference,
    generalise harder." */
export function publishedVocabulary(anonymise) {
  const words = new Set();
  for (const entry of Object.values(anonymise.runs ?? {})) {
    for (const value of [entry.label, entry.scenario, entry.repoKey]) {
      for (const word of String(value ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
        if (word) words.add(word);
      }
    }
  }
  return words;
}

/** What must not appear, derived from the store and never written to disk.
    ---------------------------------------------------------------------------
    Three kinds, because they leak differently and so they are looked for in
    different places.

    `paths` are machine truth — a run's id, its repository path, its store path,
    its plan path. Long, exact, and impossible to type by accident, so they are
    matched everywhere in the build and can never produce a false positive.

    `names` are the identities: a private repository's name and a run's real
    name, matched whole. Whole is the right unit — a leak of a repository name is
    the name, not one syllable of it, and matching syllables is how this check
    first tried to work. It reported a hundred findings, every one of them a
    common English word that happened to also be a word in somebody's plan file.
    A check that cries wolf a hundred times has been switched off by its third
    run, which is a worse outcome than not having written it.

    `tokens` are what is left of that idea, kept because a report is more likely
    to say a client's name than to paste a path: the distinctive words inside a
    private REPOSITORY name, at least five characters, absent from the published
    vocabulary and from the small list of scaffolding words above. Run names are
    not a token source. They are slugified plan titles — long, lowercased,
    English, and full of words like `graph` and `public` that this site says on
    purpose; every false positive in the noisy first version came from one.

    `phrases` is how run names are covered instead: every run of three
    consecutive words from a real run name, minus the ones built entirely out of
    words the site already publishes. Three words of English is distinctive
    enough that a match is a quotation rather than a coincidence, and it catches
    the leak a whole-string match cannot — a writer typing part of a plan's real
    title into a sentence.

    `self` is dropped entirely. This site's own run is in the same store, and
    this site is allowed to be about itself. */
/** No derived list at all: the shapes still fire, every named source is empty.
    ---------------------------------------------------------------------------
    What `--shapes` runs with on a machine that has no run store. Named rather
    than written inline so the CI half and the tests describe one object. */
export const EMPTY_LIST = { paths: [], names: [], tokens: [], phrases: new Set() };

/** The last segment of a path, read the same way on every platform.
    ---------------------------------------------------------------------------
    Not `basename`. The store records the paths of the machine each run happened
    on, and those are Windows paths — but this check also runs on a Linux CI
    runner, where a backslash is an ordinary character and
    `basename("C:\\code\\conductor-site")` comes back whole. That is not a
    cosmetic difference: the whole string never equals `self`, so this site's own
    run stopped being recognised as its own and a private repository's name was
    never extracted from its path. Three cases failed on Linux and passed on
    Windows, which is the worst way for a privacy rule to be wrong. */
export const lastSegment = (value) =>
  String(value ?? "")
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() ?? "";

export function forbidden(runs, { anonymise, self = "conductor-site" } = {}) {
  const publicNames = new Set(PUBLIC_NAMES);
  const allowed = new Set([...PUBLIC_NAMES, ...GENERIC, ...publishedVocabulary(anonymise)]);
  const paths = new Map();
  const names = new Map();
  const tokens = new Map();
  const phrases = new Set();

  const keep = (into, value, source, floor) => {
    const text = String(value ?? "").trim();
    const key = text.toLowerCase();
    if (text.length >= floor && !publicNames.has(key) && !into.has(key)) {
      into.set(key, { text, source });
    }
  };

  const keepTokens = (value, source) => {
    for (const word of String(value ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length < 5 || allowed.has(word) || tokens.has(word)) continue;
      tokens.set(word, { text: word, source });
    }
  };

  for (const run of runs) {
    const repoName = lastSegment(run.repo);
    if (repoName.toLowerCase() === self.toLowerCase()) continue;

    keep(paths, run.runId, "a run id", 16);
    keep(paths, run.repo, "a repository path", 8);
    keep(paths, run.runDb, "a run store path", 8);
    keep(paths, run.plan, "a plan path", 8);

    /* A repository whose WHOLE name is a word this site is already allowed to
       say is not an identity, and forbidding it makes the check unfalsifiable:
       a machine with a private repo directory called `website` reported every
       page that used the word in prose, 404.html included, and the only way to
       green was to delete English from the site. keepTokens() has always made
       this judgement — GENERIC carries site, code, docs, repo, build — so a
       MULTI-word name never poisoned its parts; the whole-name check just never
       asked. Nothing is lost: the repository PATH is kept separately below the
       8-character floor, so `C:\code\website` is still forbidden. It is the
       bare noun, which identifies nobody, that is exempt. */
    if (!allowed.has(repoName.toLowerCase()))
      keep(names, repoName, "a private repository name", 4);

    keepTokens(repoName, "a private repository name");

    /* A run in a repository this site is ALLOWED to name is not a secret run.
       The rule already says so for the repository's own name — `conductor` is in
       PUBLIC_NAMES and keep() skips it — but it said it in one field out of
       three, so the run's slug and the phrases inside it stayed forbidden. The
       karvan era's run in `C:/code/conductor` is called "the engine knows what
       it did and what it cost"; that sentence is in this engine's own README,
       CHANGELOG and release notes, and forbidding it meant the field guide could
       not write "the engine knows" on a page about its own subject.

       Scoped to PUBLIC repositories on purpose. A private repository's run slug
       stays secret in all three fields — that is the case the check exists for,
       and `harrowgate-linens` in the fixtures still proves it. */
    if (publicNames.has(repoName.toLowerCase())) continue;

    keep(names, run.slug, "a run's real name", 4);

    /* A three-word run is only worth flagging if it says something the site has
       not already chosen to say. `a four site` is the published scenario; `nine
       streets interactive` is a name. */
    for (const phrase of phrasesOf(String(run.slug ?? ""), 3)) {
      if (!phrase.split(" ").every((word) => allowed.has(word))) phrases.add(phrase);
    }
  }

  return {
    paths: [...paths.values()],
    names: [...names.values()],
    tokens: [...tokens.values()],
    phrases
  };
}

/* ---------------------------------------------------------------------------
   Field-note prose
   --------------------------------------------------------------------------- */

/** Overlapping runs of eight words, as a plagiarism check would build them.
    ---------------------------------------------------------------------------
    SPEC Part VI allows the field notes' NUMBERS to be republished and forbids
    their PROSE. Eight words is the line between the two: a sentence about what a
    session cost shares figures with the notes and shares no phrasing, while a
    sentence lifted out of them matches for as long as it runs. Punctuation and
    case are dropped so that a lightly reworded quote is still a quote. */
export function phrasesOf(text, span = 8) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const phrases = new Set();
  for (let i = 0; i + span <= words.length; i += 1) {
    phrases.add(words.slice(i, i + span).join(" "));
  }
  return phrases;
}

/** The field notes if this machine has them, and an honest answer if not.
    ---------------------------------------------------------------------------
    They are untracked on purpose, so CI will never have them and the quotation
    half of this check will never run there. That is a coverage gap and it is
    reported as one rather than counted as a pass — a check that reports success
    for work it did not do is the failure mode this whole site is about. */
export function fieldNotePhrases(dir = fieldNotesDir) {
  if (!existsSync(dir)) return { phrases: new Set(), files: [] };
  const files = readdirSync(dir).filter((name) => /^FIELD-NOTES-.*\.md$/i.test(name));
  const phrases = new Set();
  for (const name of files) {
    for (const phrase of phrasesOf(readFileSync(join(dir, name), "utf8"))) phrases.add(phrase);
  }
  return { phrases, files };
}

/* ---------------------------------------------------------------------------
   Scanning
   --------------------------------------------------------------------------- */

const TEXT = /\.(?:html?|xml|txt|json|js|mjs|css|svg|webmanifest)$/i;

/** Code this repository did not write: the kit's bundles and the injected editor.
    ---------------------------------------------------------------------------
    A minified vendor bundle is full of ordinary English words, so matching NAMES
    against it is all noise and no signal — a private repository called something
    like `platform` matches a variable in every bundle on the site. Machine truth
    and secret shapes are still looked for there, because a token or a path in a
    vendored bundle is a leak wherever it came from. Nothing is skipped silently:
    the run prints how many files got which treatment. */
export const isVendor = (path) =>
  path.startsWith("_astro/") ||
  path.startsWith("edit/") ||
  /* The editor's stylesheets are the same class as `edit/` — kit code copied
     verbatim into public/ by `npm run editor`, which this repo is forbidden
     to hand-edit. No site content or store-derived text can enter them, and
     "desktop" in a stylesheet matching a repository's name (2026-08-13) is
     exactly the platform-variable noise this predicate exists for. Tokens
     and paths are still looked for there, like the other vendor files. */
  /^editor-(?:panel|inline)\.css$/.test(path);

/** Every text file the build produced, as [relative path, contents]. */
export function builtFiles(dir = distDir) {
  const found = [];
  const walk = (at, prefix) => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else if (TEXT.test(name)) found.push([`${prefix}${name}`, readFileSync(full, "utf8")]);
    }
  };
  walk(dir, "");
  return found;
}

/** One file against the list. Findings carry a redaction, never the name.
    ---------------------------------------------------------------------------
    `names` and `tokens` are matched on a word boundary, so `four` inside
    `fourteen` is not a finding. `paths` are matched anywhere, because a path
    does not sit on word boundaries and a fragment of one is still a leak. */
export function scan(
  text,
  {
    paths = [],
    names = [],
    tokens = [],
    phrases = new Set(),
    notePhrases = new Set(),
    shapes = SHAPES,
    prose = true
  } = {}
) {
  const findings = [];
  const haystack = text.toLowerCase();
  const whole = (word) =>
    new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(haystack);

  for (const { text: needle, source } of paths) {
    if (haystack.includes(needle.toLowerCase())) findings.push({ kind: source, found: needle });
  }

  for (const { name, pattern } of shapes) {
    const hit = text.match(pattern);
    if (hit) findings.push({ kind: name, found: hit[0] });
  }

  if (!prose) return findings;

  for (const { text: needle, source } of [...names, ...tokens]) {
    if (whole(needle.toLowerCase())) findings.push({ kind: source, found: needle });
  }

  for (const phrase of phrases.size > 0 ? phrasesOf(text, 3) : []) {
    if (phrases.has(phrase)) findings.push({ kind: "wording from a run's real name", found: phrase });
  }

  for (const phrase of notePhrases.size > 0 ? phrasesOf(text) : []) {
    if (notePhrases.has(phrase)) {
      findings.push({ kind: "prose quoted from the field notes", found: phrase });
    }
  }

  return findings;
}

/** The whole check: every built file against every source of privacy. */
export function audit({ files, list, notePhrases }) {
  const findings = [];
  for (const [path, text] of files) {
    const found = scan(text, { ...list, notePhrases, prose: !isVendor(path) });
    for (const finding of found) findings.push({ path, ...finding });
  }
  return findings;
}

/* ---------------------------------------------------------------------------
   Running it
   --------------------------------------------------------------------------- */

function main() {
  const reveal = process.argv.includes("--reveal");
  /* The half of this check that needs no store, for the machine that has none.
     ---------------------------------------------------------------------------
     The forbidden list is derived from `conductor history`, which is the whole
     point of it — but it means the strongest gate on this site is the one that
     cannot run where the site is built, and a gate that only ever runs on one
     laptop is a gate that rots. The shapes need nothing: a path out of a
     terminal, an API token, a chat id and a reference to the field notes are
     patterns, not names. So CI runs those, and says in one line that it ran
     half a check. This does not soften `npm run anonymity`, which is unchanged
     and still what the owner runs before a report goes out. */
  const shapesOnly = process.argv.includes("--shapes");

  if (!existsSync(distDir)) {
    console.error("anonymity: there is no dist/ to read. Run `npm run build` first — this check " +
      "reads the bytes a stranger would download, not the source they came from.");
    process.exit(1);
  }

  const anonymise = shapesOnly
    ? { runs: {} }
    : JSON.parse(readFileSync(join(repoRoot, "anonymise.json"), "utf8"));
  const list = shapesOnly ? EMPTY_LIST : forbidden(readHistory(), { anonymise });
  const notes = shapesOnly ? { files: [], phrases: new Set() } : fieldNotePhrases();
  const files = builtFiles();
  const findings = audit({ files, list, notePhrases: notes.phrases });

  /* What did not run is printed whether or not anything failed. A reader of
     this output has to be able to tell a clean pass from a pass with a hole in
     it, and the hole is the normal case on CI. */
  const coverage = shapesOnly
    ? "NOT CHECKED at all in this mode: the derived list — machine paths, private repository " +
      "names, distinctive tokens, run-name phrases and the field notes — which is the half that " +
      "needs the run store. Only the secret shapes ran"
    : notes.files.length
      ? `${notes.files.length} field-note file(s) read for quoted prose`
      : "NOT CHECKED for quoted prose: no docs/dev/FIELD-NOTES-*.md on this machine, which is " +
        "expected in CI because they are untracked — this run did not test that half of the rule";

  const vendored = files.filter(([path]) => isVendor(path)).length;

  if (findings.length === 0 && shapesOnly) {
    console.log(
      `anonymity: ${files.length} built files carry none of ${SHAPES.length} secret shapes — a ` +
        `path out of a terminal, an API token, a bearer secret, a chat id, a bot token or a ` +
        `reference to the field notes. NOT CHECKED here, and it is the larger half: the machine ` +
        `paths, private repository names, distinctive tokens and run-name phrases, all of which ` +
        `are derived from the run store rather than written down. Run \`npm run anonymity\` on a ` +
        `machine that has the store before a report goes out.`
    );
    return;
  }

  if (findings.length === 0) {
    console.log(
      `anonymity: ${files.length} built files carry none of ${list.paths.length} machine paths, ` +
        `${list.names.length} private names, ${list.tokens.length} distinctive tokens, ` +
        `${list.phrases.size} three-word run-name phrases or ${SHAPES.length} secret shapes — of ` +
        `those, ${vendored} vendored file(s) were checked for paths and secrets only, not for ` +
        `names; ${coverage}.`
    );
    return;
  }

  console.error(`anonymity: ${findings.length} finding(s) in the built output.\n`);
  for (const { path, kind, found } of findings) {
    console.error(`  ${path}: ${kind} — ${reveal ? found : redact(found)}`);
  }
  console.error(
    `\nThe match is redacted because a build log is published too. Re-run with --reveal on a ` +
      `machine that is allowed to see it. ${coverage}.`
  );
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
