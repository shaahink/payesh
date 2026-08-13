/* The two halves of a page nobody looks at.
   ---------------------------------------------------------------------------
   A page's head facts and its edit annotations have the same problem: both are
   invisible on the rendered page, so both go wrong without anyone noticing.
   A description that is a stub, a canonical pointing at the URL the page used
   to have, an element that stopped being editable — a reader sees none of it,
   and neither does anyone reviewing the diff.

   The kit's `checkAnnotations` covers most of one of those: it fails the build
   when a `data-sk-edit` names a path the form model does not have, and it
   *warns* on a page that scopes a collection and then carries no annotation at
   all. Measured on this tree, stripping every annotation off the concept
   template produces two warnings and a green build — which is the right call
   for a shared kit, where a site may legitimately scope a page it has not
   finished, and the wrong one for this site, where an uneditable page is a
   regression. So the assertion below is the same fact promoted to a failure:
   the same shape `test/collections.test.mjs` guards for a whole collection,
   one level down.

   So: the schema carries the head bar (and these assertions prove it bites),
   and the walk below carries annotation coverage. `meta.canonical` agreeing
   with the route the page is served at is checked in src/lib/collections.ts
   instead, because only the build knows what the routes are. */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  articleSchema,
  conceptSchema,
  conductorPageSchema,
  homePageSchema,
  meta,
  reportSchema,
  sectionPageSchema
} from "../src/content/schema.ts";

/** A head that passes, used as the shape to break. */
const wholeMeta = () => ({
  title: "Agent memory",
  description:
    "What an agent is able to carry from one session to the next, why almost none of it survives by default, and what it costs to keep the part that matters.",
  ogDescription:
    "What an agent carries from one session to the next, and why almost none of it survives by default.",
  canonical: "/concepts/agent-memory/"
});

const refuses = (patch, why) => {
  const result = meta.safeParse({ ...wholeMeta(), ...patch });
  assert.equal(result.success, false, why);
};

test("a head that is written passes, and every collection uses the same one", () => {
  assert.equal(meta.safeParse(wholeMeta()).success, true);

  /* One bar for the whole site. A collection that declared its own head
     object would be a second, looser standard nobody would think to look
     for — and the pages that render these all read the same fields. */
  for (const [name, schema] of Object.entries({
    homePageSchema,
    conductorPageSchema,
    sectionPageSchema,
    conceptSchema,
    articleSchema,
    reportSchema
  })) {
    assert.equal(schema.shape.meta, meta, `${name} should carry the shared meta, not its own`);
  }
});

test("the description bar bites at both ends", () => {
  refuses(
    { description: "Agent memory." },
    "a stub description is a field somebody skipped, and nothing on the page shows it"
  );
  refuses(
    { description: `${wholeMeta().description} And one more clause past the snippet.` },
    "past ~160 characters the search result is cut mid-clause"
  );
  refuses(
    { ogDescription: "Memory." },
    "a card with three words on it is the card nobody clicks"
  );
  refuses(
    { ogDescription: wholeMeta().description },
    "the full description overruns a social card's second line"
  );
});

test("neither description may be the title again", () => {
  refuses(
    { description: "Agent memory" },
    "restating the title describes nothing, and it is short enough to look deliberate"
  );
  refuses({ ogDescription: "Agent memory" }, "the title is already on the card above this line");

  /* But og repeating the page description is fine, and often right. */
  const shared = "What an agent carries between sessions, and why almost none of it survives.";
  assert.equal(
    meta.safeParse({ ...wholeMeta(), description: `${shared} ${shared}`, ogDescription: shared })
      .success,
    true
  );
});

test("a canonical is a site-relative directory path", () => {
  for (const bad of [
    "concepts/agent-memory/",
    "/concepts/agent-memory",
    "https://example.invalid/concepts/agent-memory/",
    "/concepts/agent-memory/index.html",
    ""
  ]) {
    refuses({ canonical: bad }, `${JSON.stringify(bad)} is not the URL this page is served at`);
  }

  for (const good of ["/", "/concepts/", "/runs/the-fleet-round/"]) {
    assert.equal(meta.safeParse({ ...wholeMeta(), canonical: good }).success, true, good);
  }
});

/* ---------------------------------------------------------------------------
   Annotation coverage.

   A route's markup is its page file plus every .astro it pulls in, so the
   answer to "does this page carry annotations" is not in one file. Walk the
   import graph and ask it of the closure. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Every `.astro` a page reaches, itself included. */
const closureOf = (page) => {
  const seen = new Set();
  const queue = [page];

  while (queue.length > 0) {
    const path = queue.pop();
    if (seen.has(path)) continue;
    seen.add(path);

    const source = read(`../${path}`);
    for (const [, specifier] of source.matchAll(/from\s+"(\.[^"]*\.astro)"/g)) {
      const resolved = fileURLToPath(new URL(specifier, new URL(`../${path}`, import.meta.url)));
      queue.push(resolved.slice(resolved.indexOf("src")).replaceAll("\\", "/"));
    }
  }
  return [...seen];
};

/** Every page under src/pages, as repo-relative paths. */
const pages = (dir = "src/pages") =>
  readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((item) =>
    item.isDirectory()
      ? pages(`${dir}/${item.name}`)
      : item.name.endsWith(".astro")
        ? [`${dir}/${item.name}`]
        : []
  );

test("every page showing a content entry says which entry, and can be edited on the page", () => {
  const showing = [];

  for (const page of pages()) {
    const sources = closureOf(page).map((path) => read(`../${path}`));
    const declares = sources.some((source) => /editCollection=/.test(source));
    if (!declares) continue;

    showing.push(page);
    const annotations = sources.reduce(
      (count, source) => count + [...source.matchAll(/data-sk-edit=/g)].length,
      0
    );
    assert.ok(
      annotations > 0,
      `${page} names a content entry for the editor but renders not one data-sk-edit, so ` +
        `there is nothing on it to click. checkAnnotations only sees annotations that exist.`
    );
  }

  /* The site's eight content-bearing routes: the home page, the machine's
     page, the three section indexes and the three entry templates. 404.astro
     is deliberately not one — it shows no entry, so the layout's editor gate
     finds no collection and stops, which is the right answer rather than a
     wrong guess. Spelled out because the failure this test is for is a page
     dropping OFF this list. */
  assert.deepEqual(showing.sort(), [
    "src/pages/articles/[entry].astro",
    "src/pages/articles/index.astro",
    "src/pages/concepts/[entry].astro",
    "src/pages/concepts/index.astro",
    "src/pages/conductor.astro",
    "src/pages/index.astro",
    "src/pages/runs/[entry].astro",
    "src/pages/runs/index.astro"
  ]);

  assert.ok(
    !closureOf("src/pages/404.astro").some((path) => /editCollection=/.test(read(`../${path}`))),
    "404 shows no content entry and should claim none"
  );
});

test("the annotation walk actually reaches the layouts", () => {
  /* The check above is only worth anything if the closure is more than the
     page file — every concept page's annotations are half in its template and
     half in the layouts it shares. */
  const closure = closureOf("src/pages/runs/[entry].astro");
  assert.ok(closure.length > 1, "a page that imports layouts should reach them");
  assert.ok(
    closure.some((path) => path.startsWith("src/layouts/")),
    `expected a layout in the closure, got ${closure.join(", ")}`
  );
});
