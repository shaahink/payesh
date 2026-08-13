/* Reading the collections, and the checks that come with it.
   ---------------------------------------------------------------------------
   Every page that lists or renders a collection entry goes through here, and
   that is the point: the checks below run because the build renders a page,
   not because someone remembered to run them. A dangling `readNext` fails
   `npm run build` with the entry and the missing slug named.

   This file may import `astro:content` — it is site code that only ever runs
   inside the build. `src/content/schema.ts` may not, because the editor's
   Vercel function imports that one from outside the build. The two are
   deliberately different jobs. */
import { getCollection, type CollectionEntry } from "astro:content";
import { assertEvidenceResolves } from "./evidence.js";
import { refuseTypedFigures } from "./figures.js";
import { buildIndex, type Term } from "./links.js";
import type { Tag } from "./tags.js";

/** The collections a reader browses. `homePage` and `sectionPages` are the
    site's own furniture and are not listed anywhere. */
export type Listed = "concepts" | "articles" | "reports";

/** One entry of any listed collection. All three share the fields the index
    pages and the nav need: `slug`, `order`, `title`, `meta`, `readNext`. */
export type ListedEntry = CollectionEntry<Listed>;

/** The top bar, built from the section pages rather than from a list kept
    beside them.
    ---------------------------------------------------------------------------
    A section whose collection has no entries yet is left out. The alternative
    is a link to an index of nothing, and an empty page a reader clicked on is
    a worse answer than a bar with two things in it — the site is being written
    in public and the nav should say what is actually there. */
export async function navSections() {
  const pages = (await getCollection("sectionPages")).sort(
    (a, b) => a.data.order - b.data.order
  );

  const filled = [];
  for (const page of pages) {
    const entries = await getCollection(page.data.collection);
    if (entries.length === 0) continue;
    filled.push({
      href: page.data.meta.canonical,
      label: page.data.navLabel,
      count: entries.length
    });
  }
  return filled;
}

/** The section page behind one of the three indexes. */
export async function sectionPage(collection: Listed) {
  const pages = await getCollection("sectionPages");
  const page = pages.find((entry) => entry.data.collection === collection);
  if (!page) {
    throw new Error(
      `No section page lists "${collection}". Add src/content/sections/<name>.yaml ` +
        `with collection: "${collection}".`
    );
  }

  /* Litmus test 1 again, on the one collection `ordered()` never walks. A
     section page's standfirst is prose a reader reads, and `/runs`'s
     `corpusTable` is three paragraphs of it directly above a table of figures
     — which is the likeliest place on the whole site for somebody to helpfully
     type one of those figures into the sentence. */
  refuseTypedFigures(`sections/${page.id}.yaml`, page.data);

  return page;
}

/** One collection in reading order, with everything about it that can be wrong
    checked on the way past.
    ---------------------------------------------------------------------------
    Four failures, all of them silent otherwise:

    - a file renamed without its `slug`, which leaves every `readNext` pointing
      at it broken and the page itself still building perfectly;
    - two entries claiming the same `order`, which makes the reading order —
      the whole shape of the spine — depend on the order the loader happened to
      read the directory in;
    - a `readNext` naming an entry that does not exist, which is a dead link
      published at the exact moment a reader has decided to keep going;
    - a `meta.canonical` that is not the URL the page is served at, which is the
      quietest of the four. Nothing on the rendered page shows it. The canonical
      link, the `og:url` and the sitemap entry are all built from it, so one
      stale path tells every crawler and every social card that the page it just
      read lives somewhere else.

    The route half of that last one is not a constant here. It comes from the
    section page that lists the collection, whose own `meta.canonical` is the
    index URL and the nav's href — so `/runs/the-fleet-round/` is checked
    against the `/runs/` that `runs.yaml` publishes, and a section that moves
    moves its entries with it rather than leaving them behind.

    Each throws with the entry and the offending value named, because a build
    failure a reader of the log cannot act on is only half a gate. */
export async function ordered<C extends Listed>(collection: C): Promise<CollectionEntry<C>[]> {
  const entries = await getCollection(collection);
  const ids = new Set(entries.map((entry) => entry.id));
  const seenOrder = new Map<number, string>();
  const base = (await sectionPage(collection)).data.meta.canonical;

  for (const entry of entries) {
    const { slug, order, readNext } = entry.data;

    /* SPEC Part I, litmus test 1, made mechanical for the prose as well as for
       the `evidence` field. See src/lib/figures.ts for what counts and for the
       one gap it leaves. */
    refuseTypedFigures(`${collection}/${entry.id}.yaml`, entry.data);

    /* And the other half of litmus test 1: the keys a page *does* name have to
       have something behind them. A key the corpus does not carry fails here,
       from the index page that merely lists the entry, rather than rendering as
       a blank cell on the page a reader actually opened. See
       src/lib/evidence.ts for why an empty cell is the worse outcome. */
    assertEvidenceResolves(`${collection}/${entry.id}.yaml`, entry.data);

    /* And litmus test 3, made structural. "A concept page is useful without
       Conductor": delete `inConductor` from an entry and what is left has to
       still be worth reading, which is only true if the idea was written for
       someone who has never heard of the tool. schema.ts already puts `theIdea`
       first for this reason; this is the half that can actually be checked.

       Only `theIdea`. `theProblem` is a judgement — a failure is sometimes
       clearest told as one that happened — and SPEC Part III asks for the
       tool-free discipline on the idea specifically. */
    if ("theIdea" in entry.data) {
      const index = entry.data.theIdea.findIndex((para) => /conductor/i.test(para));
      if (index >= 0) {
        throw new Error(
          `${collection}/${entry.id}.yaml: theIdea[${index}] names Conductor. The idea has to ` +
            `read for someone who has never heard of it — the mechanism belongs in ` +
            `inConductor, which is the section a reader is allowed to skip.`
        );
      }
    }

    const expected = `${base}${entry.id}/`;
    if (entry.data.meta.canonical !== expected) {
      throw new Error(
        `${collection}/${entry.id}.yaml says canonical: "${entry.data.meta.canonical}", but the ` +
          `page is served at "${expected}". The canonical is also the og:url and the sitemap ` +
          `entry, so nothing on the page shows this being wrong.`
      );
    }

    if (slug !== entry.id) {
      throw new Error(
        `${collection}/${entry.id}.yaml says slug: "${slug}". The file name is the URL and ` +
          `the name other entries link to, so the two have to agree.`
      );
    }

    const taken = seenOrder.get(order);
    if (taken) {
      throw new Error(
        `${collection}: "${entry.id}" and "${taken}" both claim order ${order}. ` +
          `Reading order is the shape of this section; it cannot be a tie.`
      );
    }
    seenOrder.set(order, entry.id);

    for (const next of readNext) {
      if (next === entry.id) {
        throw new Error(`${collection}/${entry.id}: readNext points at itself.`);
      }
      if (!ids.has(next)) {
        throw new Error(
          `${collection}/${entry.id}: readNext names "${next}", which is not an entry in ` +
            `${collection}. Known entries: ${[...ids].sort().join(", ")}.`
        );
      }
    }
  }

  return entries.sort((a, b) => a.data.order - b.data.order);
}

/** Where each section's entries live, so a URL is built in one place.
    ---------------------------------------------------------------------------
    `reports` is at `/runs/` rather than `/reports/`, which is the one case that
    stops this being derivable from the collection name — a reader looking for
    what a run cost is not looking for a report. Every other function here
    routes through this rather than spelling a path. */
export const sectionRoute: Record<Listed, string> = {
  concepts: "/concepts/",
  articles: "/articles/",
  reports: "/runs/"
};

export const hrefOf = (collection: Listed, id: string): string =>
  `${sectionRoute[collection]}${id}/`;

/** The term index the prose linker matches against.
    ---------------------------------------------------------------------------
    Every concept offers its title and each of its other names; articles and
    reports offer their titles. That asymmetry is deliberate: a concept is a
    *thing the site defines*, so a reader meeting the phrase anywhere should be
    able to reach the definition, and the market's other names for it are
    exactly the phrases somebody will have written. An article is a piece of
    writing rather than a term, so only its own title points at it.

    A report contributes its title too, not its scenario sentence — the scenario
    is a paragraph, and a paragraph matched inside other prose would be a
    coincidence rather than a mention.

    Titles under four characters are dropped. There are none today; the guard is
    for the day somebody adds a concept called "RAG" or "MCP" and every page
    that happens to contain those letters inside a longer word starts sprouting
    links. Whole-word matching handles most of it and a floor handles the rest. */
export async function termIndex(): Promise<Term[]> {
  const terms: Term[] = [];

  for (const entry of await getCollection("concepts")) {
    const href = hrefOf("concepts", entry.id);
    terms.push({ text: entry.data.title, href });
    for (const name of entry.data.alsoKnownAs) terms.push({ text: name, href });
    for (const name of entry.data.linkAs) terms.push({ text: name, href });
  }

  for (const collection of ["articles", "reports"] as const) {
    for (const entry of await getCollection(collection)) {
      const href = hrefOf(collection, entry.id);
      terms.push({ text: entry.data.title, href });
      for (const name of entry.data.linkAs) terms.push({ text: name, href });
    }
  }

  return buildIndex(terms.filter((term) => term.text.trim().length >= 4));
}

/** A finding's destination, resolved — or a build failure naming it.
    ---------------------------------------------------------------------------
    A finding, a door or a map row points at the page that works it out, as
    `articles/what-a-run-costs`. The schema checks the *shape* of that string;
    only the collections know whether it names anything. Without this, renaming
    an article leaves the pages nobody re-reads — the front page and the
    machine's — linking into a hole, and every gate on this site stays green
    while it does.

    `from` names the entry doing the pointing, because the useful half of the
    failure is which file to fix. Returns the title as well as the href, so the
    link text is the destination's own name rather than a second copy of it
    kept in the YAML. */
export async function findingTarget(
  where: string,
  from = "pages/home.yaml"
): Promise<{ href: string; title: string; kind: string }> {
  const [collection, id] = where.split("/") as [Listed, string];
  const entries = await getCollection(collection);
  const entry = entries.find((candidate) => candidate.id === id);

  if (!entry) {
    throw new Error(
      `${from}: a reference points at "${where}", which is not an entry in ` +
        `${collection}. A claim with nowhere to go is a boast — the whole reason these ` +
        `pages are not marketing is that every line on them can be followed. Known entries: ` +
        `${entries.map((candidate) => candidate.id).sort().join(", ")}.`
    );
  }

  const KIND: Record<Listed, string> = {
    concepts: "Concept",
    articles: "Article",
    reports: "Run report"
  };

  return { href: hrefOf(collection, id), title: entry.data.title, kind: KIND[collection] };
}

/** Everything carrying one tag, across all three collections.
    ---------------------------------------------------------------------------
    Whole entries rather than links, so a caller can show the summary sentence
    too — a tag page listing bare titles asks the reader to guess. Ordered by
    collection first and reading order second, so the concepts come before the
    long-form pieces that assume them. */
export interface TaggedEntry {
  collection: Listed;
  id: string;
  href: string;
  title: string;
  summary: string;
  tags: Tag[];
}

export async function taggedEntries(): Promise<TaggedEntry[]> {
  const out: TaggedEntry[] = [];
  for (const collection of ["concepts", "articles", "reports"] as const) {
    for (const entry of await ordered(collection)) {
      out.push({
        collection,
        id: entry.id,
        href: hrefOf(collection, entry.id),
        title: entry.data.title,
        /* A concept's one-liner, or the standfirst the two long-form shapes
           both carry. One field per shape, named where the shape is known,
           rather than a chain of optional lookups at every call site. */
        summary: "oneLine" in entry.data ? entry.data.oneLine : entry.data.standfirst,
        tags: [...entry.data.tags]
      });
    }
  }
  return out;
}

/** The entries one page's `readNext` points at, in the order it named them.
    `ordered()` has already refused the build if any of them is missing, so
    this cannot return a hole. */
export async function readNextOf<C extends Listed>(
  collection: C,
  entry: CollectionEntry<C>
): Promise<CollectionEntry<C>[]> {
  const all = await ordered(collection);
  return entry.data.readNext.map((slug) => all.find((other) => other.id === slug)!);
}
