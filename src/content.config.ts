/* The Astro half of the content model.
   ---------------------------------------------------------------------------
   The schemas live in src/content/schema.ts with Zod as their only import;
   this file pairs each with the loader that finds its files. The split is what
   lets the editor's Vercel function import the same schemas the build validates
   against — `astro:content` and `astro/loaders` only exist inside Astro's
   build, so a function can never reach them. See CMS.md.

   Adding a collection touches three places: the schema in schema.ts, the loader
   here, and an entry in schema.ts's `editable` map so the editor can find its
   file. Miss the third and the collection simply isn't editable — which is a
   legitimate choice, not an error.

   If the site puts images through astro:assets, hand `image()` to the schema
   here — `schema: ({ image }) => pageSchema(image)`. See nimagiti. */

import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import {
  articleSchema,
  conceptSchema,
  conductorPageSchema,
  homePageSchema,
  reportSchema,
  sectionPageSchema
} from "./content/schema.js";

const homePage = defineCollection({
  loader: glob({ pattern: "home.yaml", base: "./src/content/pages" }),
  schema: homePageSchema
});

/* The machine's own page (owner's call, 2026-08-13): one entry, same pattern
   as the home page — the split is what let the front page become the field
   guide's and this page become the tool's. */
const conductorPage = defineCollection({
  loader: glob({ pattern: "conductor.yaml", base: "./src/content/pages" }),
  schema: conductorPageSchema
});

/* The three collections of SPEC Part III. One file per entry, and the file
   name is the entry id — so `context-engineering.yaml` is the entry another
   concept's `readNext` names and the segment its URL ends in, with nothing in
   between to disagree.

   `*.yaml` and not the recursive form: a nested directory would put a slash
   in the id, and the routes these feed are one segment deep. (Spelling the
   recursive glob out here would also end this comment early, which is its own
   small lesson about writing globs inside block comments.)

   Every one of them also has an entry in schema.ts's `editable` map, which is
   the third place this file's header warns about — miss it and the collection
   builds, renders and is quietly uneditable. test/collections.test.mjs holds
   the two lists against each other so that cannot happen silently again. */
const concepts = defineCollection({
  loader: glob({ pattern: "*.yaml", base: "./src/content/concepts" }),
  schema: conceptSchema
});

const articles = defineCollection({
  loader: glob({ pattern: "*.yaml", base: "./src/content/articles" }),
  schema: articleSchema
});

const reports = defineCollection({
  loader: glob({ pattern: "*.yaml", base: "./src/content/reports" }),
  schema: reportSchema
});

/* The three section pages — the copy on `/concepts/`, `/articles/` and
   `/runs/`, and the labels in the top bar. Content rather than markup, so the
   placeholder gate can see it: this repo has already shipped a placeholder
   that lived in a component, where nothing looks. */
const sectionPages = defineCollection({
  loader: glob({ pattern: "*.yaml", base: "./src/content/sections" }),
  schema: sectionPageSchema
});

export const collections = { homePage, conductorPage, sectionPages, concepts, articles, reports };
