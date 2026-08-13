/* The content model. Everything an owner might one day edit lives in
   src/content as YAML, validated by these schemas — the editor generates
   itself from them, so shape each field for that: strings the owner would
   recognise, numbers only where the layout needs them.

   This file starts with one page collection as the pattern. Grow it to match
   the content the site actually has — not the CMS you can imagine
   (sessions/03-astro-pilot.md in shaahink/drydock, "Schema overreach").

   **Zod is the only import here, and that is the point.** content.config.ts
   wraps these in defineCollection() for the build; api/content.ts imports them
   directly for the editor. That second path is why the split exists:
   `astro:content` and `astro/loaders` are virtual modules that exist only
   inside Astro's build, and a site is a static build plus plain Vercel
   functions — a function can never import them. Keep this file free of
   anything Astro-shaped.

   That includes `image()`. If the site puts images through astro:assets, the
   validator only exists inside the build, so take the image type as a generic
   parameter and instantiate the schema twice — with `image()` in
   content.config.ts, with `z.string()` here. Generic, not `() => z.ZodType`: a
   widened return type erases ImageMetadata and every component reading
   `.width` off the parsed value stops typechecking. nimagiti does this; see
   its src/content/schema.ts.

   Bilingual sites keep one schema and per-locale entries — home.en.yaml and
   home.fr.yaml, looked up as `home.${locale}`. Pass generateId to the glob
   loader for dotted names: the default id generator slugs "home.fr" into
   "homefr" (elfine, session 4). Give each entry a name in `entryLabels` below,
   because "home.fr" only reads as "the French page" to someone who already
   knows.

   Localized alt texts and aria labels are content too — the French page
   describes photographs in French. */

import { z } from "zod";

/** Per-page <head> facts. og fields feed the social cards.
    ---------------------------------------------------------------------------
    The bounds are not decoration. A description is the sentence a search result
    shows and a social card is the sentence someone decides on, and both are
    truncated by somebody else's rules — so the length is part of whether the
    field is *written* rather than merely filled in. Left unbounded, the two
    ways these go wrong are both silent: a description that is the title again,
    which reads as a page nobody described, and one that runs past the snippet
    and is cut mid-clause where the reader is looking.

    ~160 characters is where Google's snippet stops; ~120 is where a card's
    second line does. The floors are lower and cruder, and they exist to refuse
    a stub — a five-word description is a field somebody skipped, and skipping
    it is invisible on the built page because nothing on screen shows it.

    `ogDescription` is allowed to repeat `description` — often it should, and
    the shorter card version of the same sentence is the usual right answer.
    What neither may be is the title, which is already on the card above it. */
const notTheTitle = (label: string) =>
  ({
    error: `${label} restates the title. The title is already on the page and on the card above this line; this is the sentence that says what the page is for.`
  });

export const meta = z
  .object({
    title: z.string().min(1),
    description: z.string().min(60).max(160),
    ogType: z.string().default("website"),
    ogDescription: z.string().min(45).max(120),
    ogImage: z.string().optional(),
    /* A site-relative path with both slashes on it, because this template
       builds with format "directory" and Base.astro resolves it against
       astro.config's `site` to make the canonical, the og:url and the sitemap
       entry. A missing trailing slash publishes a URL that redirects to the
       one the page is actually served at. */
    canonical: z
      .string()
      .regex(
        /^\/([A-Za-z0-9-]+\/)*$/,
        "canonical is a site-relative path with a leading and trailing slash, e.g. /concepts/agent-memory/"
      )
  })
  .refine((m) => m.description.trim() !== m.title.trim(), notTheTitle("description"))
  .refine((m) => m.ogDescription.trim() !== m.title.trim(), notTheTitle("ogDescription"));

/* Name a field with `.meta({ title })` wherever its key is not already a word
   the owner would use. This is not cosmetic: the inline editor puts the label
   in the bar as "Changing {label}" while they type, and that sentence is the
   whole of what tells them which piece of text they have their finger on. A
   key like `p1`, `sub`, `cta` or `fa` produces "Changing P1" — a programmer's
   shorthand handed to a client. The keys themselves stay as they are, because
   they are what the YAML files spell. */
/** Whether a section is on the site.
    ---------------------------------------------------------------------------
    Put it on the sections that can genuinely come and go, and *only* on those.
    PLAN §3.9 draws the line here: whether a section the designer built appears
    at all is content and therefore the owner's; creating one, moving one, or
    changing how it looks is still a content-request issue.

    Deciding the list is per-site work, and it is judgement rather than a
    default. A hero, an about block and a contact block are what a page *is*; a
    seasonal offer, a gallery, a set of collaborators, anything advertising
    something that might end — those are what an owner wants a switch for.

    Defaulting to true means no content file needs changing and a section
    *without* the field simply cannot be hidden, which is the safe answer for
    anything structural. The editor lifts it out of the form and draws it as a
    switch at the head of the section, so it never sits among the words.

    It is on `notes` below so the pattern is here and working. Delete that
    section or keep it; keep the shape either way. */
export const visible = z.boolean().default(true);

/** A picture.
    ---------------------------------------------------------------------------
    **Spell it exactly like this and the owner gets a photo picker for free.**
    The kit recognises a picture from its shape — a `src` string beside `w` and
    `h` integers — rather than from anything a site declares, so a new site
    inherits the picker by following the convention. Choosing a photograph
    scales it in the browser, writes the file and both sizes, and holds Save
    until `alt` has been written.

    `w`/`h` belong in `omit` below. They are structure wearing a number's
    clothing and the layouts depend on them; omitting them hides them from the
    form, not from the picker, which reads this schema.

    Two shapes the picker cannot serve, and both exist in the fleet: images
    behind `astro:assets` (nimagiti), where the YAML holds a path Astro
    resolves inside the build; and pre-built responsive variants (elfine),
    where a new photograph would need a `srcset` of several files that do not
    exist yet. Either is a fine choice — `omit` the image field and leave new
    photographs to a content-request issue — but if the site can use this
    shape, use this shape. */
export const picture = z.object({
  src: z.string(),
  alt: z.string().default(""),
  w: z.number().int().positive(),
  h: z.number().int().positive()
});

/** The phrases in this site's own prose that should reach this page.
    ---------------------------------------------------------------------------
    A third naming field, and the reason it is not `alsoKnownAs` is that the two
    are aimed at different readers. `alsoKnownAs` is the market's words — "LLM
    observability", "agent swarms" — and it is *printed*, so a stranger arriving
    on the word from a job ad recognises the page. `linkAs` is never printed. It
    is the words this site actually writes in its paragraphs, and its only job
    is to make the first mention of one a link.

    They had to be separated because filling `alsoKnownAs` with both makes the
    published line wrong: "Also known as: ceiling, wrap-up, soft break" says a
    concept has a synonym when what it has is a mechanism.

    Measured rather than guessed. The ten lists were chosen by counting which
    phrases occur in the 17 entries' prose and how widely — "ceiling" is in 9
    pages, "rollover" in 5, "gate battery" in 3. Two rules came out of doing it:

    - **Plurals are their own entry.** The matcher is exact and whole-word on
      purpose, because stemming turns "gates" into "gate" and then a sentence
      about a garden gate links to an evals page. Where the prose uses both, both
      are listed.
    - **A word used everywhere belongs to nobody.** "Checkpoint" occurs 69 times
      across 13 of the 17 entries and is deliberately absent from every list. A
      term that would link on almost every page is not a cross-reference, it is
      a decoration, and it is how auto-linking gets switched off six months
      later. */
export const linkAs = z
  .array(z.string().min(4))
  .default([])
  .meta({ title: "Phrases that link here" });

/** An evidence KEY. Never a value.
    ---------------------------------------------------------------------------
    This regex is the mechanism behind the site's first litmus test. Content
    names a key; `src/data/corpus.json` — recomputed from the run store by the
    harvest — carries the number. A figure that cannot be typed cannot drift,
    and a page naming a key the corpus does not have fails the build (S3.3).

    Enforcing it here rather than trusting the comment above it matters,
    because the failure mode is a writer in a hurry doing the obvious thing.
    Every literal they might reach for is refused by shape: a key cannot start
    with a digit (`3016.29`, `18`), cannot carry currency or percent signs
    (`$425.12`, `30%`), and has no spaces or slashes (`18 runs`, `72/81`).
    What passes is an identifier: `softBreaks`, `rollovers`, `fleet-round-four`. */
export const evidenceKey = z
  .string()
  .regex(
    /^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$/,
    "evidence names a key from the corpus, never a value"
  );

/** What a page cites: runs and windows by their published label, figures by name.
    ---------------------------------------------------------------------------
    A *window* is one stretch of a run's sessions under one ceiling, and it is a
    third thing rather than a kind of run because the interesting comparison is
    between two windows of the same run — same repo, same plan, same agents, one
    number moved. Its label is its run's label with the ceiling on the end, so a
    cap that moves renames the window and the citation fails rather than
    quietly meaning something else.

    It sits up here with the shared pieces rather than down with the three
    content collections because the home page cites the corpus too, and a
    `const` cannot be used above the line that declares it — the build says
    "Cannot access 'evidence' before initialization" and stops at the config,
    which reads as a broken config rather than an ordering problem. */
export const evidence = z.object({
  runs: z.array(evidenceKey).default([]),
  windows: z.array(evidenceKey).default([]),
  figures: z.array(evidenceKey).default([])
});

/** The tag vocabulary: closed, small, and the same words on all three
    collections.
    ---------------------------------------------------------------------------
    A `z.enum` rather than a free string array, and that is the whole design.
    Open tags are how a taxonomy dies: the second writer types `costs`, the
    third `cost-control`, and within a season the tag pages are three near-empty
    lists that each look like a mistake. A closed set fails the build on an
    unknown word, which is the only moment anybody is in a position to decide
    whether the vocabulary genuinely needs a ninth entry.

    Eight, and they are deliberately *cross-cutting* rather than a second copy
    of the ten concepts. A tag earns its place by joining pages that are not
    already joined: `cost` gathers the token-economics concept, the article
    about what a run costs and the report on the run that overspent, which are
    one thought spread across three collections and three URLs. A tag that only
    ever lands on one page is a page, not a tag.

    Adding one is a real decision and the enum is where it gets made. Label and
    blurb live in `src/lib/tags.ts`, which is where the reader-facing words are;
    this list is only the vocabulary. The two are held together by a unit test,
    so a slug added here without a description fails rather than publishing a
    tag page with no sentence on it. */
export const TAGS = [
  "cost",
  "measurement",
  "failure",
  "verification",
  "autonomy",
  "context",
  "orchestration",
  "people"
] as const;

export const tags = z
  .array(z.enum(TAGS))
  .default([])
  .meta({ title: "Tags" });

/** A run of prose.
    ---------------------------------------------------------------------------
    An array rather than one string with blank lines in it, and the reason is
    the editor: the panel draws one box per element, so a writer moves a
    paragraph by moving a row instead of hunting for the right newline in a
    textarea the height of a phone. It is also what makes `data-sk-edit` able
    to name a single paragraph — `theIdea[1]` — rather than the whole block.

    The bounds are the shape of the page, not a style opinion. SPEC Part III
    says the idea is three to six paragraphs; a two-paragraph idea has not been
    explained and a nine-paragraph one is the article that concept should have
    been.

    It sits up here with the other shared pieces rather than down with the three
    content collections for the same reason `evidence` does, and the same reason
    is a real failure this file has already had: the home page uses it too, and
    a `const` used above the line that declares it fails as "Cannot access
    'paragraphs' before initialization" — reported against `astro.config.mjs`,
    which reads as a broken config rather than an ordering problem. */
const paragraphs = (min: number, max: number) =>
  z.array(z.string().min(1)).min(min).max(max);

/** One thing the corpus turned out to say, and where it is worked out.
    ---------------------------------------------------------------------------
    The front page's own shape, and the one piece of this schema that exists
    because of what a cold reader needs rather than because of what the content
    is. A stranger arriving here does not want to be sold an orchestrator and
    does not want a list of ten headings either. What they can use is the
    findings: the handful of things a month of running one against real
    repositories actually showed, each with the number behind it and a route to
    the page where it is argued properly.

    Three fields, and the discipline is in the split:

    - `figure` is a corpus KEY. The number is never in the sentence — same rule
      as everywhere else on this site, and it bites hardest here, because a
      front page is exactly where somebody would type "98%" to save a step.
    - `claim` is the sentence, written to *follow* the number rather than
      contain it: the page renders the figure and then this, so it reads as one
      line. Write it starting lower-case and without the digits.
    - `where` is `<collection>/<entry>` — the page that works it out.
      `src/lib/collections.ts` resolves it against the real collections and
      fails the build on a finding that points nowhere, so a renamed article
      cannot leave the front page linking into a hole.

    A finding with no `where` is refused by the shape rather than allowed as an
    optional field. An insight with nowhere to go is a boast; the whole reason
    this page is not marketing is that every line on it can be checked. */
export const finding = z.object({
  figure: evidenceKey,
  claim: z.string().min(20).meta({ title: "The sentence after the number" }),
  where: z
    .string()
    .regex(
      /^(concepts|articles|reports)\/[a-z0-9-]+$/,
      'where names the page that works it out, as "articles/what-a-run-costs"'
    )
    .meta({ title: "The page it is worked out on" })
});

/** One door on the front page: who it is for, and where it leads.
    ---------------------------------------------------------------------------
    The findings tell a stranger what the record said; the doors tell them where
    to go first, sorted by the question they arrived with rather than by the
    site's own structure. Same discipline as a finding: the destination is a
    `<collection>/<entry>` reference resolved against the real collections, so a
    renamed page fails the build here rather than publishing a dead door. */
export const door = z.object({
  eyebrow: z.string().meta({ title: "Who this door is for" }),
  blurb: z.string().min(20).meta({ title: "The sentence on the door" }),
  where: z
    .array(
      z
        .string()
        .regex(
          /^(concepts|articles|reports)\/[a-z0-9-]+$/,
          'each destination is "<collection>/<entry>", as "concepts/evals-and-gates"'
        )
    )
    .min(1)
    .max(3)
    .meta({ title: "The pages it leads to" })
});

export const homePageSchema = z.object({
  meta,
  hero: z.object({
    title: z.string(),
    tagline: z.string().meta({ title: "Tagline under the title" }),
    /* The paragraph that says what a stranger is actually looking at, in the
       first person, before any number. It is separate from `tagline` because
       the two do different jobs and one of them is new: the tagline is the
       site's subtitle, and this is the answer to "why does this exist and who
       ran it". A cold reader needs the second one within a screen or they
       leave. */
    standfirst: paragraphs(1, 3).meta({ title: "What this is" })
  }),
  /* The front page cites the corpus like any other page, which is the whole
     argument of SPEC Part VII requirement 2: what makes this site different
     from every other page on the topic is above the fold, and it is the
     numbers rather than the prose. Same field, same keys, same gate — a home
     page naming a key the corpus does not have fails the build exactly as a
     concept page does. Declared after `hero` because that is the reading
     order: the claim, then what is behind it. */
  evidence,
  /* What the month actually showed, which is the reason to read on.
     ---------------------------------------------------------------------
     This is the section that decides whether the front page is a contents page
     or a piece of writing. Ten headings tell a reader what subjects exist; a
     finding tells them something they did not know and hands them the page
     where it is argued. Five or six is the range: fewer and the page has no
     shape, more and it becomes the list it was replacing. */
  findings: z.object({
    visible,
    title: z.string(),
    intro: z.string().meta({ title: "The line above the findings" }),
    items: z.array(finding).min(3).max(8)
  }),
  /* The drawings. Only the words around them are content — the figures
     themselves are arrangement (FigureLoop, FigureRun), because a drawing of
     the machine is the page's furniture the same way a list's markup is. */
  machine: z.object({
    visible,
    title: z.string(),
    intro: z.string().meta({ title: "The line above the drawings" })
  }),
  /* The doors. A reader who followed the findings knows what the record said;
     this is the section for the reader who arrived cold and wants to know
     where people like them start. Three doors is the shape — by question, not
     by collection — and each one resolves like a finding does. */
  orient: z.object({
    visible,
    title: z.string(),
    intro: z.string().meta({ title: "The line above the doors" }),
    doors: z.array(door).min(2).max(4)
  }),
  /* The way in. Ten concepts is too many for a paragraph and exactly right for
     a list, and a reader who already knows what context engineering is should
     be able to enter at the one they do not. The headings are content; the
     list itself is arrangement, read from the collection in `order`. */
  spine: z.object({
    title: z.string(),
    intro: z.string().meta({ title: "The line above the list" })
  }),
  /* The two sections that were on the site but not on its front page: the
     long-form pieces, and the runs they are drawn from. A front page listing
     only the concepts published a site with one third of itself hidden. */
  reading: z.object({
    title: z.string(),
    intro: z.string().meta({ title: "The line above the articles" })
  }),
  runs: z.object({
    title: z.string(),
    intro: z.string().meta({ title: "The line above the runs" }),
    /* The sentence under the three reports, pointing at the whole corpus. It
       is content rather than markup because it is the one place the front page
       says *why* eighteen runs are published when three are written up. */
    corpus: z.string().meta({ title: "The line pointing at all the runs" })
  }),
  /* Where the work goes next. Deliberately the one section allowed to talk
     about the future, and the copy has to say so itself: nothing here has an
     evidence key behind it, which is why the detail lives on /roadmap/ where
     every item names what it waits on. Intent, labelled as intent, is the only
     way a forward-looking sentence survives litmus test 1. */
  next: z.object({
    visible,
    title: z.string(),
    body: paragraphs(1, 3).meta({ title: "Where this goes" })
  }),
  ways: z.object({
    title: z.string(),
    intro: z.string().meta({ title: "The line above the tags" })
  }),
  /* A section that can be turned off — the working example of the pattern.
     index.astro renders it through `isVisible`, and a site that grows a nav
     filters that nav's links through `visibleOnly`. */
  notes: z.object({
    visible,
    title: z.string(),
    body: z.string().meta({ title: "The paragraph" })
  })
});

/* ---------------------------------------------------------------------------
   This site's own three collections (SPEC Part III).

   `concepts` is the spine: ten pages, each the same five moves — the idea, the
   problem, the mechanism in Conductor, the evidence, something to try.
   `articles` and `reports` are long-form, and a report is an article with a
   generalised scenario label on the front of it.
   --------------------------------------------------------------------------- */


/** A pointer into `shaahink/conductor`, which is public and therefore citable.
    ---------------------------------------------------------------------------
    `path` and `line` together are the claim — "the mechanism is here" — and
    `note` is what a reader is meant to see when they arrive. S4.4 re-verifies
    every one of these against a named commit, because a line number is the
    most perishable fact on the site. */
export const citation = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  note: z.string()
});

/** A heading and the prose under it. Long-form pages are a list of these, and
    the list is also what the in-page table of contents is built from. */
export const section = z.object({
  heading: z.string(),
  body: paragraphs(1, 12)
});

/** A concept page: the five moves, in order (SPEC Part III).
    ---------------------------------------------------------------------------
    `theIdea` comes first and mentions Conductor nowhere. That ordering is the
    third litmus test made structural — delete `inConductor` from an entry and
    what is left must still be worth reading, which is only true if the idea
    was written for a reader who has never heard of the tool. */
export const conceptSchema = z.object({
  meta,
  /* The file name is already the URL. This repeats it inside the file so a
     renamed file is caught by a test rather than silently re-routing a page
     that other entries link to by slug. */
  slug: z.string(),
  /** Reading order across the whole spine, which is also the nav order. */
  order: z.number().int().positive(),
  title: z.string(),
  /** The market's other names for the same idea — the words in the job ads.
      A reader who searched for "prompt engineering at scale" should find the
      page that answers it under a different heading. */
  alsoKnownAs: z.array(z.string()).default([]).meta({ title: "Also known as" }),
  /* `alsoKnownAs` does a second job beyond being printed under the title, and
     it is the one that makes the site link itself: `src/lib/links.ts` builds a
     term index out of every concept's title and its other names, then links the
     first mention of any of them in the prose of every *other* page. So "prompt
     engineering at scale" written in an article reaches this concept without
     anybody maintaining a link. Adding a name here wires it site-wide. */
  linkAs,
  tags,
  oneLine: z.string().meta({ title: "The one-line summary" }),
  theIdea: paragraphs(3, 6).meta({ title: "The idea, with no Conductor in it" }),
  theProblem: paragraphs(1, 4).meta({ title: "What goes wrong without it" }),
  inConductor: z
    .object({
      mechanism: paragraphs(1, 4),
      citations: z.array(citation).min(1)
    })
    .meta({ title: "How Conductor does it" }),
  evidence,
  tryIt: z
    .array(z.object({ command: z.string(), note: z.string() }))
    .min(1)
    .max(3)
    .meta({ title: "Something the reader can run" }),
  /* Slugs of other concepts. Empty is allowed while the spine is being
     written; S2.2 adds the check that a non-empty one resolves to a real
     entry and fails the build when it does not. */
  readNext: z.array(z.string()).default([]).meta({ title: "Read next" })
});

/** A long-form piece (SPEC Part V). A standfirst and titled sections. */
export const articleSchema = z.object({
  meta,
  slug: z.string(),
  order: z.number().int().positive(),
  title: z.string(),
  /* Long-form pieces claim phrases too, and one of them has to: "the nudge" is
     written on four pages and the article about it is where a reader should
     land, not the concept that merely mentions the mechanism. */
  linkAs,
  tags,
  standfirst: z.string().meta({ title: "The standfirst under the title" }),
  evidence,
  sections: z.array(section).min(1),
  readNext: z.array(z.string()).default([]).meta({ title: "Read next" })
});

/** A run report (SPEC Part VI).
    ---------------------------------------------------------------------------
    Same shape as an article plus `scenario`, and that extra field is the whole
    anonymisation rule wearing a schema's clothing: a report is published as a
    situation a stranger can map onto their own, never as the run it was. The
    rule is not enforced here — no regex knows a client's name — it is enforced
    by S6.1's grep over the built output and by the harvest failing closed on a
    run with no entry in `anonymise.json`. */
export const reportSchema = articleSchema.extend({
  scenario: z.string().meta({ title: "The published scenario label" })
});

/** A section of the site: the page that lists one collection.
    ---------------------------------------------------------------------------
    Three entries, one per section, and they are what the top bar is built
    from — so a section that exists and a section that is linked cannot
    disagree, which is what TopBar.astro's own comment asked for.

    It exists at all because of a failure this repo has already had: the footer
    printed a placeholder on every page for three sessions, and nothing caught
    it, because `checkPlaceholders` reads the `editable` map and a sentence
    written into a component is invisible to it. Index-page copy is copy. It
    goes in content, where the gate can see it.

    `meta.canonical` is the section's URL and the nav's href — one fact in one
    place rather than a `href` field that can drift away from the canonical the
    same page publishes. */
export const sectionPageSchema = z.object({
  meta,
  /** Which collection this page lists. */
  collection: z.enum(["concepts", "articles", "reports"]),
  /** Left-to-right order in the top bar. */
  order: z.number().int().positive(),
  navLabel: z.string().meta({ title: "Label in the top bar" }),
  title: z.string(),
  standfirst: z.string().meta({ title: "The standfirst under the title" }),
  /** The words above `/runs`'s corpus table, and only that page's.
      ---------------------------------------------------------------------
      Optional because two of the three sections are a list and nothing else,
      and a required field they would have to fill with something is how a
      schema starts collecting fields nobody meant. The table itself is not in
      here and cannot be: it is every run in `src/data/corpus.json`, rendered
      by `RunTable.astro`, and a run appears in it because the harvest
      published it rather than because somebody added a row.

      What *is* here is the paragraph that says what the reader is looking at —
      including that the runs the store still calls running were abandoned,
      which is the one thing on that page a number cannot say on its own. That
      is copy, so it lives in content where `checkPlaceholders` can see it and
      the owner can change it. See sectionPageSchema's own note above for the
      three sessions of placeholder this rule was bought with. */
  corpusTable: z
    .object({
      heading: z.string(),
      body: paragraphs(1, 3)
    })
    .optional()
    .meta({ title: "The words above the corpus table" })
});

/* Which YAML file backs which collection, for the editor.
   ---------------------------------------------------------------------------
   Astro's loaders know this too, but only inside the build — the handler needs
   it as plain data. `file` is a collection of exactly one entry; `dir` is one
   file per entry, and `entryLabels` names them.

   `omit` is what an owner should not be able to break from a form: image pixel
   sizes the layout depends on, `srcset` strings, `order` numbers. Anything that
   is structure wearing a value's clothing. Array items are spelled the way the
   form model spells them — `images[].w`, not `images[0].w` — and omitting a
   whole object is usually better than omitting its leaves, or the panel shows
   an empty box with its label still on it. */
export const editable = {
  homePage: {
    label: "Home page",
    schema: homePageSchema,
    file: "src/content/pages/home.yaml",
    /* Where this entry can be seen on the site, so the panel can offer to go
       and edit it on the page itself. It is the only route to inline editing
       that does not involve typing `?edit=1` onto the end of a URL, which is
       to say the only one that exists on a phone — so give every entry one.

       "/" because this template builds with format "directory"; a site with
       format "file" says "/index.html". A directory collection takes a
       pattern instead: entryUrl: "/projects/{entry}". Only site-relative
       paths; the kit drops anything else. */
    entryUrl: "/",
    /* Same reason as the other three: editing a key does not produce a
       different number, it produces a failed build. There is nothing here for
       an owner to change, so the panel should not offer a box. */
    omit: ["evidence"]
  },

  /* The three collections below are `dir` rather than `file`: one YAML per
     entry, and the file name is the entry id and the URL segment both.

     No `entryLabels`. It exists for ids that do not read as their own name —
     `home.fr` is the case it was built for — and these are already sentences:
     an owner scanning `context-engineering`, `what-a-run-costs` and
     `the-fleet-round` knows which is which. A hand-kept label per entry would
     be a second copy of `title` that goes stale on the day someone renames one
     and not the other.

     `omit` is the same judgement everywhere here: `slug` and `order` are
     structure wearing a value's clothing — `order` is the reading order of the
     spine and the nav, and `slug` is the URL. `evidence` is omitted whole
     rather than by its leaves, because it is not prose at all: those strings
     are keys into the corpus, and an owner who edits one does not get a
     different number, they get a build that fails. Same for the citations —
     `path` and `line` are a claim about someone else's source file, verified
     against a named commit at S4.4, and a form is the wrong place to change
     one. The prose beside them stays editable. */
  /* The three section pages. `entryUrl` is a map rather than a pattern here,
     because a section's URL is not its id — `reports` lives at `/runs/`, since
     a reader looking for what a run cost is not looking for a report. */
  sectionPages: {
    label: "Section pages",
    schema: sectionPageSchema,
    dir: "src/content/sections",
    entryUrl: { concepts: "/concepts/", articles: "/articles/", runs: "/runs/" },
    omit: ["collection", "order"]
  },

  concepts: {
    label: "Concepts",
    schema: conceptSchema,
    dir: "src/content/concepts",
    entryUrl: "/concepts/{entry}",
    omit: ["slug", "order", "evidence", "inConductor.citations"]
  },

  articles: {
    label: "Articles",
    schema: articleSchema,
    dir: "src/content/articles",
    entryUrl: "/articles/{entry}",
    omit: ["slug", "order", "evidence"]
  },

  reports: {
    label: "Run reports",
    schema: reportSchema,
    dir: "src/content/reports",
    entryUrl: "/runs/{entry}",
    omit: ["slug", "order", "evidence"]
  }
};
