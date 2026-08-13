# <Site name> — <one line on whose site this is>

TODO: replace this stub when the site takes shape. Until then, README.md
describes what the template provides.

## Stack

Astro 7, strict TypeScript, static output. Content lives in typed collections
under `src/content/`: the schemas are in `src/content/schema.ts` with Zod as
their only import, and `src/content.config.ts` pairs each with its loader. The
pages are arrangement, not words. Feedback machinery and the owner's editor both
come from `@shaahink/sitekit` (pinned exactly) — see `FEEDBACK.md` and
`CMS.md`. **If this site reads right-to-left, `RTL.md` is not optional
reading** — it carries the practice measured on the fleet's two RTL sites, and
the two traps (`dir="auto"`, and a raw font-family name) both fail silently.

Three files are generated and CI diffs all three: `vercel.json` from
`headers.config.mjs` (`npm run headers`), `src/content`'s formatting
(`npm run content`), and `public/editor-panel.css` from the kit
(`npm run editor`). Never hand-edit any of them.

## Run it

```bash
npm install
npm run dev      # dev server
npm run check    # typecheck pages + content schemas
npm run build    # dist/
```

`vercel dev` when touching the `/api` functions.

## Conventions

This site is part of the **sk** fleet. The plan, the locked decisions and the
rules every site inherits live in `shaahink/drydock` — read `PLAN.md` there
before proposing anything architectural.

Three that bite most often: handlers stay Web standard (no `@vercel/*`, no Node
built-ins — Vercel is the host, not the platform); CSS uses logical properties
only, because the sites are bidirectional; and the editor is not this repo's
code. `editorRoute()` in `astro.config.mjs` asks the kit to inject the page, CSP
and all, so there is no editor file here — do not add one. If improving the
editor would mean editing a site repo, the boundary is wrong and the boundary
should move — say so rather than working around it.

`src/content/schema.ts` must import nothing but Zod. A Vercel function serves
the editor and can never reach `astro:content`, so anything Astro-shaped in
there — including `image()` — breaks it. Take the image type as a generic
parameter instead; nimagiti shows the shape.

**Inline `style=""` attributes are dead on this site, silently.** The built
pages carry a meta CSP (the kit's build integration) whose `style-src` allows
stylesheets and hashed `<style>` elements but never style *attributes* — so a
width or height written into one renders as zero in every real browser while
looking perfect in the HTML. Figure geometry lives in each component's own
`<style>` (per-class or nth-child rules for the still); scripts change it
through the CSSOM (`el.style.setProperty`), which CSP permits. Scripts that
*create* elements must also stamp them with the component's scope attribute or
they fall out of the scoped styles — `spawn()` in `src/scripts/figures.js`
does both jobs; see FigureCensor.astro for the whole pattern.

## A pull request nobody should merge yet

The fleet's `catchup.mjs` reads every open PR in this repo and merges the ones
whose build is green, unattended and between sessions. That is what it is for,
and it is wrong exactly once: when a person is still deciding. It has merged an
unpicked redesign onto a client's live site that way.

So say so on the PR itself, where the tool looks:

```bash
gh pr edit <n> --add-label do-not-merge
```

It is refused by name and the reason is printed. Draft status is refused too,
and both are now printed rather than silently skipped — but the label is the
sturdier of the two, because it survives a PR being marked ready for review. A
note in a plan file protects nothing: the tool does not read plan files.
