# Payesh

[![CI](https://github.com/shaahink/payesh/actions/workflows/ci.yml/badge.svg)](https://github.com/shaahink/payesh/actions/workflows/ci.yml)
[![Gates](https://github.com/shaahink/payesh/actions/workflows/gates.yml/badge.svg)](https://github.com/shaahink/payesh/actions/workflows/gates.yml)
[![Live](https://img.shields.io/badge/live-payesh.vercel.app-b02f10)](https://payesh.vercel.app)

**A field guide to agentic engineering** — ten concepts the market is hiring for, each one worked
end to end in a real orchestrator, with what it cost.

Live at **<https://payesh.vercel.app>**.

| paper — the light scheme | soot — the dark scheme |
| --- | --- |
| ![The front page in paper: a cream cover, an ink display headline, پایش set large in vermilion, and a contents rail](docs/assets/front-page-paper.png) | ![The same cover in soot: warm near-black, a cream headline, the vermilion brighter](docs/assets/front-page-soot.png) |

*پایش* is Persian for **monitoring**: watching something over time and keeping the record of it,
which is what this site is made of. The repo was `conductor-site` until 2026-08-07; GitHub
redirects the old path and the old `conductor-site-virid.vercel.app` is still attached to the
Vercel project, so nothing published before the rename has broken.

The site explains concepts, not a product. Each concept page states the idea in plain language
you can use anywhere, then shows how [Conductor](https://github.com/shaahink/conductor)
implements it, then points at a real run and what it cost.
[Conductor](https://github.com/shaahink/conductor) is the worked example and the evidence — not
the pitch.

It was itself built by Conductor driving this repository, unattended, one stage at a time —
[`TRACKER.md`](TRACKER.md) is the board that run wrote, and [`docs/SPEC.md`](docs/SPEC.md) is the
design it was given.

## What is on it

| Section | What |
| --- | --- |
| `/` | The findings — what a month of this actually showed, each with the figure behind it and a route to where it is argued |
| `/concepts` | Ten concepts — agentic engineering, multi-agent orchestration, context engineering, token economics, evals and gates, independent verification, durable execution, human-in-the-loop, agent observability, agent memory |
| `/articles` | Four longer pieces, each carrying at least one number nobody else publishes |
| `/runs` | Anonymised reports from real autonomous runs, and the corpus they come from — with each run's dates, how long the machine actually worked, and how long it took on a calendar |
| `/tags` | Eight cross-cutting subjects, each gathering concepts, articles and reports that share it |

The prose links itself. Every concept contributes its title, the market's other names for it and
the phrases this site's own paragraphs use (`linkAs`) to a term index; the first mention of any of
them on any other page becomes a link. Adding a name to a concept wires that phrase site-wide,
including into pages written before the concept existed. See `src/lib/links.ts` for the five rules
that keep it from becoming a sea of blue.

## The look

The inner pages wear Conductor's terminal Face: the sixteen colour roles in `src/styles/tokens.css`
are the exact values the Face ships in its mocha and latte schemes, so the site and the tool are
visibly one thing. The front page is the one exception — it dresses as print (warm paper and ink
with a single vermilion, in both a light and a dark cut), with a display serif for the cover and
پایش set in its own script. That dress is scoped to the front page alone; step into any concept and
you are back in the Face's own palette.

Every colour is a role and every size is a step: `test/tokens.test.mjs` fails the build on a hex or
a font-size literal outside the two token files, and `test/contrast.test.mjs` recomputes the
contrast of the shipped palette against the same thresholds the Face's own theme test enforces.

## The rule that shapes everything

**No figure is ever typed into content.** A page names an evidence *key*; the value is read from
`src/data/corpus.json`, which `scripts/harvest.mjs` recomputes from Conductor's run store. A page
citing a key that is not in the corpus fails the build, and the `evidence` gate goes red when the
corpus is stale.

That is the site keeping its own first rule: every number is traceable, or it does not ship.

The reports are **generalised into scenarios** — "a four-site web fleet with a shared component
library" rather than a client's name. That is for the reader as much as for privacy: you should be
able to map your own situation onto a report. Runs absent from `anonymise.json` are excluded, never
published under their real name — the rule fails closed.

## Development

```bash
npm install
npm run dev          # local dev server
npm run check        # astro check + the unit suite — must be 0 errors, 0 failures
npm run build        # must be green; the gates below read what it writes
```

Three files are generated and CI diffs all three, so none of them is ever hand-edited:

```bash
npm run headers      # vercel.json ← headers.config.mjs
npm run content      # normalise src/content
npm run editor       # copy the kit's editor stylesheets into public/
```

## The gates

Each answers one question about the built site that nothing else would catch, and each is designed
to be seen red. They run against `dist/`, so they go after `npm run build`.

| Gate | What it answers | Where it runs |
| --- | --- | --- |
| `npm run evidence` | Does the committed corpus still match the run store, and does every cited key resolve? | Locally — needs the store |
| `npm run evidence:cited` | Does every cited key resolve against the committed corpus? | CI too — needs no store |
| `npm run anonymity` | Do the built bytes carry any machine path, private name, distinctive token or quoted run name? | Locally — the list is derived from the store, never written down |
| `npm run anonymity:shapes` | Do they carry a path out of a terminal, an API token, a chat id? | CI too — a shape is a pattern, not a name |
| `npm run seo` | One canonical per page, a sitemap that is the site, robots agreeing with it, social cards that still render their own numbers | CI |
| `npm run a11y` | A lang, one identified `<main>`, a working skip link, landmarks, accessible names, tab order | CI |
| `npm run harvest` | *(not a gate)* recompute `corpus.json` from the run store | Locally |

Contrast, focus visibility and layout shift need a browser and are measured by hand — the run and
its numbers are in [`docs/evidence`](docs/evidence).

## CI

Two workflows, on purpose:

- **`ci.yml`** calls the fleet's reusable pipeline in `shaahink/.github`. It runs what every site
  in the fleet has: the types, the build, and the three generated files still matching their
  sources. Six sites were carrying byte-similar copies of that before it moved.
- **`gates.yml`** runs the four above, which the shared pipeline cannot know about. Two run whole;
  two run the half that needs no run store, and say on every run which half they did not do.

## Licence

Content © Shahin Kiassat. Code MIT — see [LICENSE](LICENSE).
