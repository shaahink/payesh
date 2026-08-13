/* The sitemap, generated at build from the same content that drives the pages.
   ---------------------------------------------------------------------------
   Two rules, and the second is the one that was wrong here until S7.1:

   1. **The origin lives in exactly one place** — astro.config's `site`. Nothing
      in this file spells a hostname, so moving the domain moves the sitemap.
   2. **Every page a reader can reach is in it, and nothing else is.** The
      template shipped this file listing the home page alone, which was right
      for a template with one page and quietly wrong from the moment this site
      grew a second. A sitemap with 1 of 21 URLs in it is worse than none: it
      does not say "crawl this site", it says "this is the site", and a crawler
      that believes it never asks about the other twenty.

   So the list is built from the collections rather than kept beside them.
   Adding a concept adds a sitemap entry, because the concept's own
   `meta.canonical` is the entry — the same field the page's `<link rel=
   canonical>` and its `og:url` come from, which is what makes them incapable
   of disagreeing. `ordered()` has already refused the build if any of those
   canonicals is not the URL the page is served at.

   Three kinds of page are deliberately absent, and `scripts/seo.mjs` checks
   that the absence is exactly this list: `/404`, which is not a destination;
   `/edit`, the owner's editor, which is behind Google sign-in and has no
   public content; and `/og/*`, the rendering surface the social cards are
   screenshotted from. All three are also disallowed in robots.txt. */

import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { absolute, sitemap } from "@shaahink/sitekit/seo";
import { ordered } from "../lib/collections.js";
import { allTags, tagHref } from "../lib/tags.js";

export const GET: APIRoute = async ({ site }) => {
  /* Reading order, top down: the front page, then each section index followed
     by its own entries. A sitemap carries no ranking, but it is read by people
     too — and a file whose order is the site's order is one a person can check
     against the nav. */
  const paths: string[] = [(await getCollection("homePage"))[0]!.data.meta.canonical];

  const sections = (await getCollection("sectionPages")).sort(
    (a, b) => a.data.order - b.data.order
  );

  for (const section of sections) {
    paths.push(section.data.meta.canonical);
    for (const entry of await ordered(section.data.collection)) {
      paths.push(entry.data.meta.canonical);
    }
  }

  /* The two orientation pages, between the sections and the tags: furniture
     rather than shape, which is also why they live in the footer and not the
     bar. Standalone pages are not derivable from any collection, so each one
     is a line here — and scripts/seo.mjs fails the build if a built page is
     missing from this file, which is what catches the next one being added
     without its line. */
  paths.push("/glossary/", "/roadmap/");

  /* The tags last, because they are a second way through the site rather than
     part of its shape — a reader reads the sections in order and arrives at the
     tags from an entry.

     Built from the vocabulary rather than from what is tagged, which is the
     same source `/tags/[tag].astro` generates its routes from. Deriving either
     one from usage instead would let the two disagree, and the way they would
     disagree is a page that exists and is never crawled. */
  paths.push("/tags/", ...allTags().map(tagHref));

  const xml = sitemap(paths.map((path) => ({ loc: absolute(site!, path) })));
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
