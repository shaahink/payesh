// @ts-check
import { defineConfig, fontProviders } from "astro/config";
import { checkAnnotations, checkPlaceholders, editorRoute } from "@shaahink/sitekit/astro";
import { editable } from "./src/content/schema.js";

export default defineConfig({
  /* The one line canonical, og:url, og:image, every sitemap entry, robots.txt's
     Sitemap: line and the footer credit all derive from.

     ⚠ A bare `.vercel.app` label is claimed globally, first come, and most
     short words are gone. `conductor-site`, and later `karvan` and `rasad`,
     were each already assigned to a stranger's project — which is why the
     first value here was the `-virid` collision suffix Vercel generates when
     the label it wants is taken. `payesh` was claimed for this project on
     2026-08-07 and is the canonical from that day.

     The lesson survives the rename: reachability proves nothing, because a
     squatted label answers 200 as happily as this one does. What settles
     whether a host is ours is what it *serves* — Astro, this site's `<title>`,
     the hashed same-origin faces the Fonts API builds. Re-confirm that way if
     the domain ever moves. Fetch it and read the title; do not ping it.

     `conductor-site-virid.vercel.app` is still attached to the project on
     purpose, so every link published before the rename keeps resolving.

     `scripts/seo.mjs` holds the rest of the site to this string — every
     absolute URL in `dist/` has to be on it, or the gate is red. */
  site: "https://payesh.vercel.app",

  /* The owner's editor. The whole route is the kit's — this site owns no
     editor page, so a change to the editor's markup or its CSP arrives as a
     version bump like every other kit change, and its URL still follows this
     site's build.format. The title is the one part that is genuinely ours:
     an owner should see whose site they are editing.

     `checkAnnotations` is the other half, and it fails the build: a
     `data-sk-edit` on this site that stops resolving — a renamed field, a
     deleted sentence, a layout change that dropped the collection attribute
     — is an element an owner can point at that would not save. It reads the
     same `editable` map api/content.ts hands the content handler, so the
     build and the editor cannot disagree about what is editable. Without it
     the rot is found by whoever opens that page in edit mode, which is the
     owner. SCALE.md §6.

     `checkPlaceholders` is that same bargain over the values rather than the
     markup, and it came from a live page rather than from a rule: a client's
     published contact address sat on a reserved `.example` domain for months,
     where no mail could ever reach it, and nothing in the build, the editor
     or the review widget had ever said a word about it — because this fleet's
     owner-ask lists are generated from what a client's material *lacked* and
     never from what the site *asserts*. It reads the same `editable` map that
     `checkAnnotations` reads, refuses the build on a reserved `.example` or
     `example.com` domain, on lorem, on TODO/FIXME/TBD and on a row of x's,
     and prints the exact `allow:` line for a string that is genuinely meant
     to be there — because a gate with no escape is a gate somebody deletes.
     It runs on `build` only: a dev server that refused to start because a
     paragraph says TODO would be a check that gets removed rather than a
     check that gets obeyed. */
  integrations: [
    editorRoute({ title: "Edit — Payesh" }), checkAnnotations({ collections: editable }),
    /* No `allow:` list, and the absence is the point (S1.4). The template
       shipped two escapes — `homePage:meta.description` and
       `homePage:meta.ogDescription` were `TODO:` on purpose, because they are
       two of the sentences a new site has to write for itself. This site has
       written them, so the escapes are gone and every string in `editable` is
       now held to the gate.

       Nothing should be added back here. This site's whole argument is that a
       published claim has to be checkable, and an `allow:` line is how a
       placeholder gets published: the string stops failing the build and
       nothing else in the build, the editor or the review widget ever
       mentions it again. If a genuine sentence trips the gate — a concept
       page that has to quote `example.com`, a report that has to print a row
       of x's — that is a real argument to have on its own, in that stage,
       with the string in front of you. Do not pre-authorise it here. */
    checkPlaceholders({ collections: editable })
  ],

  /* Locales for this site. One entry keeps URLs unprefixed; add a second and
     Astro's i18n routing takes over — set lang/dir per locale in the layout.
     RTL locales cost nothing if new CSS sticks to logical properties
     (PLAN §3.5).

     The bilingual pattern, proven on elfine (session 4): per-locale content
     entries (home.en.yaml / home.fr.yaml, one schema), a locale-prefixed
     pages dir (src/pages/fr/index.astro), and one shared component the thin
     pages parameterize with a locale prop. Two traps: the glob loader slugs
     the dot out of "home.fr" unless you pass generateId, and build.format
     "file" flattens /fr/ into /fr.html — locale-directory sites need the
     default "directory" format. */
  i18n: { locales: ["en"], defaultLocale: "en" },

  /* No markdown is rendered by default; this silences the build's
     Shiki-vs-CSP warning. Remove if the site gains markdown content. */
  markdown: { syntaxHighlight: false },

  /* Two faces, and the split between them is the site's argument rather than
     a taste call (SPEC Part II).

     Source Sans 3 is the body: a humanist sans, which is what long-form
     reading wants and what a monospace wall defeats. Long-form reading is
     this site's main job.

     JetBrains Mono is reserved for machine truth — costs, token counts, run
     ids, gate names, CLI lines, checkpoint tables, the evidence strip. When a
     reader sees mono on this site they are looking at something recomputed
     from a run store, so the typeface itself carries meaning. Spending a
     second family on that is the point; using mono decoratively would spend
     it and buy nothing.

     Built same-origin by the Fonts API, which the template's same-origin CSP
     requires. Subsets are pinned: a dropped subset is silent tofu.

     ⚠ The built CSS hashes the family names, so site CSS must consume the
     cssVariable — never the raw name. A token like
     `--sans: "Source Sans 3", system-ui, sans-serif` silently renders the
     fallback forever (Bez shipped exactly that in session 3; session 4's
     screenshot verification caught it). src/styles/type.css writes
     `--sans: var(--font-sans)`, and the fallback stacks live below, where the
     variable is assembled. test/tokens.test.mjs fails the build's sibling
     check if a raw family name ever appears in site CSS.

     Both are preloaded: both paint above the fold on every page — the body
     immediately, and the mono in the top bar's wordmark and the evidence
     figures. Filter by subset or style if that ever narrows, never by weight:
     the API records each merged file under its first face's weight, so a
     weight filter silently misses. */
  fonts: [
    {
      provider: fontProviders.google(),
      name: "Source Sans 3",
      cssVariable: "--font-sans",
      weights: [400, 600, 700],
      styles: ["normal", "italic"],
      subsets: ["latin"],
      fallbacks: ["Segoe UI", "Helvetica Neue", "Arial", "sans-serif"]
    },
    {
      provider: fontProviders.google(),
      name: "JetBrains Mono",
      cssVariable: "--font-mono",
      weights: [400, 700],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["ui-monospace", "SFMono-Regular", "Consolas", "monospace"]
    },

    /* The site's third face. It still routes through a cssVariable that
       type.css consumes, same trap, same rule as the two above.

       Fraunces is the display serif: the site dresses as print — ink on
       paper — and a grotesk headline would leave that claim half made. It was
       the cover's alone until the print dress was unified site-wide
       (2026-08-13); now Base.astro renders it on every page and it carries
       every heading. Display and heading sizes only; body copy stays in the
       sans.

       There used to be a fourth: Vazirmatn, for the Persian-script covermark
       on the cover. The owner retired that mark (2026-08-13) in favour of the
       drawn one (src/components/Mark.astro), and the face went with it —
       test/tokens.test.mjs would rightly fail a family that is downloaded and
       never consumed. */
    {
      provider: fontProviders.google(),
      name: "Fraunces",
      cssVariable: "--font-display",
      weights: [400, 600],
      styles: ["normal", "italic"],
      subsets: ["latin"],
      fallbacks: ["Georgia", "Times New Roman", "serif"]
    }
  ],

  security: {
    csp: {
      /* Everything same-origin. data: images are the feedback widget's
         screenshot preview. Add third-party origins here deliberately, one
         by one, when the design demands them — and "media-src 'self'" the
         day the site ships audio or video (shade and elfine both needed it
         for their mp4s). When the analytics tag goes live (see Base.astro),
         https://sk-stats.vercel.app joins both connect-src below and the
         script resources — the tracker is an external script and its beacon
         posts back to the same origin. */
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'"
      ],
      scriptDirective: {
        resources: ["'self'"],
        /* sha256 of the is:inline <head> snippet that adds html.js and
           applies an explicitly chosen theme before first paint. Astro does
           not process inline scripts, so this is maintained by hand — and a
           stale hash fails nothing anywhere except a browser console, where
           the snippet simply never runs.

           test/csp.test.mjs recomputes it from Base.astro on every `npm run
           check`, fails if it disagrees, and prints the correct value. Do not
           hand-compute it; change the snippet, run the test, paste what it
           says. */
        hashes: ["sha256-LH/KOH5MvjXYDz6CFr0SP5Y/iXBGHDNO31Yy0265z7c="]
      },
      styleDirective: {
        resources: ["'self'"]
      }
    }
  }
});
