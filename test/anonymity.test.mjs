/* The anonymisation check (S6.1), driven with fixtures.
   ---------------------------------------------------------------------------
   `scripts/anonymity.mjs` derives its forbidden list from the run store, which
   means the check that matters most on this site is the one that cannot be
   tested where the site is built. So the file is split: everything below the
   `execSync` call is pure, and this suite drives that half with invented runs
   whose "private" names are obviously invented.

   Nothing in this file may be real. The fixtures name a repository called
   `harrowgate-linens` and a run called `harrowgate linens seasonal rebuild`,
   both made up for the purpose, because a test for a privacy rule that ships
   real names in its fixtures has broken the rule in order to check it. */

import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_LIST,
  PUBLIC_NAMES,
  SHAPES,
  forbidden,
  isVendor,
  lastSegment,
  phrasesOf,
  publishedVocabulary,
  redact,
  scan
} from "../scripts/anonymity.mjs";

/* Two runs in one store, which is the normal case: a private client repository
   and this site's own run, sitting side by side. */
const HISTORY = [
  {
    runId: "9f3c1a77d21b48e6b0c5aa41ef770213",
    repo: "C:\\code\\harrowgate-linens",
    plan: "C:\\code\\harrowgate-linens\\plans\\seasonal.plan.json",
    runDb: "C:\\Users\\someone\\.conductor\\runs\\9f3c1a77\\run.db",
    slug: "harrowgate-linens-seasonal-rebuild-with-a-public-graph"
  },
  {
    runId: "0000000000000000000000000000aaaa",
    repo: "C:\\code\\conductor-site",
    plan: "C:\\code\\conductor-site\\conductor.plan.json",
    runDb: "C:\\Users\\someone\\.conductor\\runs\\00000000\\run.db",
    slug: "conductor-site-a-field-guide-to-agentic-engineering"
  }
];

const ANONYMISE = {
  runs: {
    "9f3c1a7": {
      label: "the-linen-round",
      scenario: "A small retailer's site, one seasonal rebuild",
      repoKey: "retail-site"
    }
  }
};

const list = () => forbidden(HISTORY, { anonymise: ANONYMISE });
const has = (entries, text) => entries.some((entry) => entry.text.toLowerCase() === text);

test("a repository path is read the same way on every platform", () => {
  /* The regression this exists for cost six red CI runs against a green local
     battery. The store records Windows paths because the runs happened on a
     Windows machine, but the check also runs on a Linux runner, where
     `basename` treats a backslash as an ordinary character and hands back the
     whole string. The three cases below were the difference between a rule
     that works and a rule that silently stops recognising both this site's own
     run and a private repository's name — on the machine nobody watches. */
  assert.equal(lastSegment("C:\\code\\harrowgate-linens"), "harrowgate-linens");
  assert.equal(lastSegment("/home/someone/code/harrowgate-linens"), "harrowgate-linens");
  assert.equal(lastSegment("C:\\code\\conductor-site\\"), "conductor-site");
  assert.equal(lastSegment(""), "");
  assert.equal(lastSegment(undefined), "");
});

test("this site's own run is not treated as private", () => {
  const { paths, names } = list();
  assert.ok(!has(names, "conductor-site"), "the site may be about itself");
  assert.ok(
    !paths.some((entry) => entry.text.includes("conductor-site")),
    "nor may its own paths be forbidden — every page would fail"
  );
});

test("a private repository's name, path, store and id are all forbidden", () => {
  const { paths, names } = list();
  assert.ok(has(names, "harrowgate-linens"));
  assert.ok(paths.some((entry) => entry.text === "C:\\code\\harrowgate-linens"));
  assert.ok(paths.some((entry) => entry.text.endsWith("run.db")));
  assert.ok(paths.some((entry) => entry.text === HISTORY[0].runId));
});

test("a public repository is never listed as a private name", () => {
  /* The regression this exists for: the first version of the check kept every
     repository basename, so a run in `shaahink/conductor` — which SPEC Part VI
     says may be named — was reported on all nineteen pages of a site whose
     subject is Conductor. A check that fires on its own subject gets deleted. */
  const withPublic = forbidden(
    [...HISTORY, { runId: "1".repeat(32), repo: "C:\\code\\conductor", plan: "", runDb: "", slug: "conductor-engine-work" }],
    { anonymise: ANONYMISE }
  );
  for (const name of PUBLIC_NAMES) {
    assert.ok(!has(withPublic.names, name), `${name} is public and may be named`);
    assert.ok(!has(withPublic.tokens, name), `${name} is public and may be named`);
  }
});

test("a private repository whose whole name is an ordinary word is not an identity", () => {
  /* The regression this exists for: a private repo directory on the author's
     machine is called `website`. `keepTokens` already exempted the word — it is
     in GENERIC beside `site` and `code` — but the whole-name check did not ask,
     so 69 findings landed on 22 pages, 404.html among them, and the only route
     to green was deleting the word from the site's English. A rule whose only
     remedy is "say less" stops being run.

     The identifying form is still forbidden, and that is the whole argument:
     the PATH keeps its entry, so the directory can never be published. */
  const generic = forbidden(
    [...HISTORY, { runId: "2".repeat(32), repo: "C:\\code\\website", plan: "", runDb: "", slug: "a-quiet-round" }],
    { anonymise: ANONYMISE }
  );

  assert.ok(!has(generic.names, "website"), "an ordinary noun identifies nobody");
  assert.ok(!has(generic.tokens, "website"), "and keepTokens already agreed");
  assert.ok(
    generic.paths.some((entry) => entry.text === "C:\\code\\website"),
    "the path is the identifying form and it stays forbidden"
  );

  /* The exemption is by vocabulary, not by length: a one-word name the site has
     never had reason to say is still a name. */
  const distinctive = forbidden(
    [...HISTORY, { runId: "3".repeat(32), repo: "C:\\code\\harrowgate", plan: "", runDb: "", slug: "a-quiet-round" }],
    { anonymise: ANONYMISE }
  );
  assert.ok(has(distinctive.names, "harrowgate"), "a distinctive one-word name is still forbidden");
});

test("a run in a public repository is not a secret run", () => {
  /* The other half of "a public repository is never listed as a private name",
     which only ever checked one field of three. The karvan run in
     `C:/code/conductor` is called "the engine knows what it did and what it
     cost" — a sentence in that engine's own README and release notes — so its
     slug and every three-word phrase inside it were forbidden on a site whose
     entire subject is that engine. The page about human-in-the-loop could not
     write "the engine knows". */
  const withPublic = forbidden(
    [
      ...HISTORY,
      {
        runId: "4".repeat(32),
        repo: "C:\\code\\conductor",
        plan: "",
        runDb: "",
        slug: "conductor-karvan-core---the-engine-knows-what-it-did"
      }
    ],
    { anonymise: ANONYMISE }
  );

  assert.ok(!has(withPublic.names, "conductor-karvan-core---the-engine-knows-what-it-did"));
  assert.ok(
    !withPublic.phrases.has("the engine knows"),
    "a phrase out of a public repository's run name is not a secret"
  );
  assert.ok(
    withPublic.paths.some((entry) => entry.text === "C:\\code\\conductor"),
    "the machine path is still forbidden — public repo, private disk"
  );

  /* And the case the rule exists for is untouched: the private fixture's run
     name and its phrases stay forbidden. */
  const { names, phrases } = list();
  assert.ok(names.length > 0 && phrases.size > 0, "the private fixtures still produce secrets");
});

test("run names are not a token source, because they are English", () => {
  /* `graph` and `public` are words in the fixture run name and words this site
     writes on purpose. The noisy first version derived tokens from run names
     and reported twenty findings, every one of them a word like these. */
  const { tokens } = list();
  for (const word of ["graph", "public", "seasonal", "rebuild"]) {
    assert.ok(!has(tokens, word), `${word} comes from a run name and identifies nobody`);
  }
  assert.ok(has(tokens, "harrowgate"), "the repository name still yields its distinctive word");
});

test("the published vocabulary allowlists itself", () => {
  const words = publishedVocabulary(ANONYMISE);
  assert.ok(words.has("retail") && words.has("seasonal") && words.has("linen"));
  /* `linen` is published; `linens` is the repository. The check is per word, so
     the repository's own plural survives — which is the behaviour that makes a
     thin disguise fail rather than pass. */
  const { tokens } = forbidden(HISTORY, {
    anonymise: { runs: { "9f3c1a7": { label: "x", scenario: "harrowgate", repoKey: "y" } } }
  });
  assert.ok(!has(tokens, "harrowgate"), "a word the site publishes cannot be the thing that leaks");
});

test("a private name planted in a page is found", () => {
  const page = "<p>The work was done for Harrowgate Linens over four weeks.</p>";
  const found = scan(page, list());
  assert.ok(found.length > 0, "the planted name must be a finding");
  assert.ok(found.some((f) => f.kind === "a private repository name"));
});

test("a finding is redacted, and the redaction is not the name", () => {
  const [finding] = scan("<p>harrowgate-linens</p>", list());
  const shown = redact(finding.found);
  assert.notEqual(shown, finding.found);
  assert.ok(!shown.toLowerCase().includes("arrowgate"));
  assert.ok(shown.startsWith("h") && shown.includes("(17 chars)"));
});

test("matching is on whole words, so a substring is not a finding", () => {
  const tokens = [{ text: "four", source: "a private repository name" }];
  assert.deepEqual(scan("fourteen sessions, fourthly", { tokens }), []);
  assert.equal(scan("four sessions", { tokens }).length, 1);
});

test("three consecutive words of a real run name are a finding", () => {
  const { phrases } = list();
  const quoted = scan("<p>the harrowgate linens seasonal rebuild went well</p>", { phrases });
  assert.ok(quoted.some((f) => f.kind === "wording from a run's real name"));
  /* And a phrase built only out of published words is not in the list at all,
     which is what stops the scenario the owner chose from failing its own
     check. */
  assert.ok(![...phrases].some((phrase) => phrase === "a small retailer"));
});

test("field-note prose is caught at eight words, and paraphrase is not", () => {
  const notes = phrasesOf(
    "The owner said the third site was the one that always broke, and nobody knew why."
  );
  const quoting = scan("<p>the third site was the one that always broke</p>", {
    notePhrases: notes
  });
  assert.ok(quoting.some((f) => f.kind === "prose quoted from the field notes"));

  const republishing = scan("<p>One site in the fleet failed more often than the others.</p>", {
    notePhrases: notes
  });
  assert.deepEqual(republishing, [], "the same fact in different words is allowed");
});

test("secret shapes are caught wherever they appear", () => {
  const cases = [
    "C:\\Users\\someone\\code",
    "/home/someone/code",
    "C:\\code\\something",
    "see docs/dev/FIELD-NOTES-fleet.md",
    "sk-ant-api03-abcdefghijkl",
    "Authorization: Bearer abcdefghijklmnopqrstuvwx",
    'chat_id: -1001234567',
    "12345678:AAEEabcdefghijklmnopqrstuvwxyz0123456"
  ];
  assert.equal(cases.length, SHAPES.length, "every shape has a case that proves it");
  for (const text of cases) {
    assert.ok(scan(text, {}).length > 0, `${text} should have matched a shape`);
  }
});

test("the shapes half stands on its own, with nothing derived", () => {
  /* What `--shapes` runs in CI, where there is no run store and therefore no
     forbidden list. The shapes still have to fire — they are patterns, not
     names — and a private name must NOT, because a finding of that kind in
     this mode would mean the list had come from somewhere it cannot have come
     from. Both halves of that matter: the first is the check still working,
     the second is it not quietly pretending to be the whole check. */
  assert.deepEqual(scan("harrowgate-linens is a name this mode cannot know", EMPTY_LIST), []);
  assert.equal(scan("C:\\Users\\someone\\code\\notes", EMPTY_LIST).length, 1);
  assert.equal(scan("see docs/dev/FIELD-NOTES-fleet.md", EMPTY_LIST).length, 1);
});

test("vendored bundles are checked for secrets but not for names", () => {
  assert.ok(isVendor("_astro/edit.abc123.js") && isVendor("edit/index.html"));
  assert.ok(!isVendor("runs/the-fleet-round/index.html"));

  const bundle = "const harrowgate=1;"; // an ordinary identifier in minified code
  assert.deepEqual(scan(bundle, { ...list(), prose: false }), []);
  assert.ok(scan(`${bundle} C:\\Users\\someone\\`, { ...list(), prose: false }).length > 0);
});
