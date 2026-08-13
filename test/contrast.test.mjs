/* The Face's legibility gate, run against this site's CSS.

   Conductor refuses to ship a terminal scheme whose roles cannot be read on
   its own base — `face-go/internal/widgets/theme_test.go:44`, and the
   thresholds below are that file's, copied with its reasoning. Since
   2026-08-13 the site wears its own two print schemes — soot and paper —
   rather than the Face's mocha and latte, but it keeps the Face's bar: the
   status hues are still the Face's values, and a site about a tool that
   refuses illegible themes should not publish one the tool would reject.

   What is tested is `src/styles/tokens.css` itself, parsed, not a second copy
   of the palette living in this file. A test that re-declares the colours it
   is checking proves only that two literals agree.

   Run: `npm test` (and `npm run check`, which runs it). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TOKENS = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url));

/* The thresholds are not WCAG AA. They are the floor below which the Face's
   own frames stop being readable, chosen so all four curated schemes clear
   them as published — theme_test.go:47. They earn their keep on the fills:
   the active tab paints Base ON Accent and a search match paints Base ON
   Yellow, and contrast is symmetric, so one check covers both directions. */
const MIN_TEXT = 4.5; // primary text carries the frame
const MIN_SEMANTIC = 3.0; // status colours, the Accent/Yellow fills, muted text
const MIN_QUIET = 1.5; // deliberately receding, but never invisible

const TEXT_ROLES = ["text"];
const SEMANTIC_ROLES = ["accent", "blue", "green", "red", "yellow", "peach", "teal", "sky", "overlay"];
const QUIET_ROLES = ["pending", "skipped"];
const STRUCTURE_ROLES = ["base", "mantle", "surface", "selection"];
const ALL_ROLES = [...STRUCTURE_ROLES, ...TEXT_ROLES, ...SEMANTIC_ROLES, ...QUIET_ROLES];

/* Stock Catppuccin Latte, for the five roles the Face darkens in-hue. Present
   only so a test can assert the shipped values are NOT these — provenance,
   not a palette. Anyone who "fixes" latte from the Catppuccin website will
   land on this list and fail. */
const STOCK_LATTE = {
  green: "#40a02b",
  yellow: "#df8e1d",
  peach: "#fe640b",
  teal: "#179299",
  sky: "#04a5e5"
};

/* WCAG 2.x relative luminance and contrast ratio, ported from
   theme_test.go:17 and :29. 1.0 is identical, 21.0 is black on white. */
function relativeLuminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

function contrast(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* Parse the shipped CSS. Each palette block opens with a bang-comment naming
   its scheme, and a block runs from that marker to the next marker or to the
   end of the file. Deliberately dumber than a CSS parser: it reads
   what a person reading the file would read, so a token moved outside a
   marked block disappears from the test rather than being silently inferred. */
function parseSchemes(css) {
  const blocks = [];
  const marker = /\/\*!\s*scheme:([a-z]+)\s*\*\//g;
  let match;
  const starts = [];
  while ((match = marker.exec(css)) !== null) starts.push({ name: match[1], at: match.index });
  for (const [i, start] of starts.entries()) {
    const end = i + 1 < starts.length ? starts[i + 1].at : css.length;
    const body = css.slice(start.at, end);
    const roles = {};
    for (const decl of body.matchAll(/--([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
      roles[decl[1]] = decl[2].toLowerCase();
    }
    /* The one derived token, read out of the same block as a declaration
       rather than as a number this file keeps its own copy of. It is not in
       `roles` on purpose: `roles` is the Face's sixteen, and the test above
       asserts there are exactly sixteen of them. */
    const mix = body.match(
      /--muted\s*:\s*color-mix\(\s*in\s+srgb\s*,\s*var\(--text\)\s+([\d.]+)%\s*,\s*var\(--base\)\s*\)\s*;/
    );
    blocks.push({ name: start.name, roles, mutedMix: mix ? Number(mix[1]) : null });
  }
  return blocks;
}

/* `color-mix(in srgb, ...)` is a plain per-channel lerp on the 0–255 values —
   no gamma, no interpolation space to get wrong — which is the entire reason
   `--muted` is derived in srgb rather than oklab. It means this file can
   compute exactly what the browser will paint and hold it to a bar, instead of
   asserting that a hex somebody typed still looks about right. */
function mixSrgb(aHex, bHex, percentOfA) {
  const parts = (hex) => [0, 8, 16].map((shift) => (parseInt(hex.slice(1), 16) >> shift) & 0xff).reverse();
  const [a, b] = [parts(aHex), parts(bHex)];
  const p = percentOfA / 100;
  const channels = a.map((v, i) => Math.round(v * p + b[i] * (1 - p)));
  return `#${channels.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const css = readFileSync(TOKENS, "utf8");
const blocks = parseSchemes(css);

test("tokens.css declares both of the site's schemes", () => {
  const names = new Set(blocks.map((b) => b.name));
  assert.deepEqual([...names].sort(), ["paper", "soot"]);
});

test("every block declares all sixteen roles, and no role the Face does not have", () => {
  for (const block of blocks) {
    assert.deepEqual(
      Object.keys(block.roles).sort(),
      [...ALL_ROLES].sort(),
      `scheme ${block.name} does not declare exactly the sixteen roles`
    );
  }
});

/* Paper is declared twice — once under prefers-color-scheme, once under the
   toggle's explicit attribute — because CSS cannot express "either of these"
   in one rule. Duplication drifts, so the drift is what is tested. */
test("the repeated paper blocks are identical", () => {
  const paper = blocks.filter((b) => b.name === "paper");
  assert.ok(paper.length >= 2, "expected paper to be declared for both the media query and the toggle");
  for (const block of paper.slice(1)) {
    assert.deepEqual(block.roles, paper[0].roles, "the paper blocks have drifted apart");
    assert.equal(block.mutedMix, paper[0].mutedMix, "the paper blocks' --muted mixes have drifted apart");
  }
});

test("every role clears the Face's legibility bar on its own base", () => {
  for (const block of blocks) {
    const base = block.roles.base;
    const check = (role, min) => {
      const got = contrast(block.roles[role], base);
      assert.ok(
        got >= min,
        `scheme ${block.name}: ${role} is ${got.toFixed(2)}:1 against base, want >= ${min.toFixed(2)}:1`
      );
    };
    for (const role of TEXT_ROLES) check(role, MIN_TEXT);
    for (const role of SEMANTIC_ROLES) check(role, MIN_SEMANTIC);
    for (const role of QUIET_ROLES) check(role, MIN_QUIET);
  }
});

/* No absolute threshold catches a quiet role that is louder than muted text —
   only the ordering does. `pending` is the checkpoint nobody has reached and
   must recede furthest. theme_test.go:77. */
test("the quiet ladder is ordered: pending recedes furthest", () => {
  for (const { name, roles } of blocks) {
    const against = (role) => contrast(roles[role], roles.base);
    assert.ok(against("pending") < against("skipped"), `scheme ${name}: pending is not quieter than skipped`);
    assert.ok(against("pending") < against("overlay"), `scheme ${name}: pending is not quieter than overlay`);
  }
});

/* A test nothing can trip is decoration. This one pins both ends: the colour
   that motivated the bar must fail it, and the shipped replacement must pass.
   theme_test.go:94. */
test("the bar bites: stock Catppuccin Latte yellow fails it, the shipped yellow passes", () => {
  const paper = blocks.find((b) => b.name === "paper");
  const stock = contrast(STOCK_LATTE.yellow, paper.roles.base);
  assert.ok(
    stock < MIN_SEMANTIC,
    `stock Latte yellow is ${stock.toFixed(2)}:1 on paper base — if this now passes, the bar has been weakened`
  );
  const shipped = contrast(paper.roles.yellow, paper.roles.base);
  assert.ok(shipped >= MIN_SEMANTIC, `shipped paper yellow is ${shipped.toFixed(2)}:1, want >= ${MIN_SEMANTIC}:1`);
});

/* ── the derived muted token ───────────────────────────────────────────────
   Everything above is the Face's bar, which is a terminal's bar. These four
   are the web page's, and they are stricter: a standfirst set at 19px is not
   large text, so 3:1 does not buy it. `--muted` exists to carry those strings
   and nothing else — `test/tokens.test.mjs` is the half that stops `--overlay`
   being spent on them again. */

const WEB_TEXT = 4.5; // WCAG AA for text under 24px, which is all of this site's prose
const MUTED_SURFACES = ["base", "mantle"]; // the two backgrounds muted text is ever set on

test("every scheme derives --muted from its own text and base", () => {
  for (const block of blocks) {
    assert.ok(
      typeof block.mutedMix === "number",
      `scheme ${block.name} has no --muted, or declares it as something other than a srgb mix of --text and --base`
    );
  }
});

test("--muted clears the web's 4.5:1 bar on both surfaces it is set on, in both schemes", () => {
  for (const block of blocks) {
    const muted = mixSrgb(block.roles.text, block.roles.base, block.mutedMix);
    for (const surface of MUTED_SURFACES) {
      const got = contrast(muted, block.roles[surface]);
      assert.ok(
        got >= WEB_TEXT,
        `scheme ${block.name}: --muted resolves to ${muted} and is ${got.toFixed(2)}:1 on ${surface}, want >= ${WEB_TEXT}:1`
      );
    }
  }
});

/* A muted token mixed all the way to 100% would pass the bar above and be
   pointless — it would just be `--text` under another name, and the page would
   lose the layer that tells a reader which sentence is the subject. */
test("--muted actually recedes: it is quieter than text and louder than the quiet ladder", () => {
  for (const block of blocks) {
    const muted = mixSrgb(block.roles.text, block.roles.base, block.mutedMix);
    const against = (hex) => contrast(hex, block.roles.base);
    assert.ok(
      against(muted) < against(block.roles.text),
      `scheme ${block.name}: --muted is not quieter than --text`
    );
    assert.ok(
      against(muted) > against(block.roles.skipped),
      `scheme ${block.name}: --muted has receded past the quiet ladder`
    );
  }
});

/* The bar bites, the same way the stock-latte test above does: the role
   `--muted` replaced must still fail the bar it was failing. If `--overlay`
   ever passes 4.5:1 on both surfaces in both schemes, the Face's palette has
   been edited to suit this site — which is the wrong direction — and the
   derived token can be deleted rather than quietly kept. */
test("the bar bites: --overlay, which used to carry this text, fails it", () => {
  const failures = blocks.flatMap((block) =>
    MUTED_SURFACES.map((surface) => contrast(block.roles.overlay, block.roles[surface])).filter(
      (ratio) => ratio < WEB_TEXT
    )
  );
  assert.ok(
    failures.length > 0,
    `--overlay now clears ${WEB_TEXT}:1 everywhere muted text is set — if that is real, --muted is dead weight`
  );
});

/* Provenance. Paper's status hues are latte's darkened set, inherited when
   the print dress went site-wide. If they were ever re-copied from the
   Catppuccin website — the one mistake this site's brief calls out by name —
   these five roles would match stock again and the page would go quietly
   unreadable in light mode. */
test("paper's five darkened status roles are the Face's values, not upstream Catppuccin's", () => {
  const paper = blocks.find((b) => b.name === "paper");
  for (const [role, stockHex] of Object.entries(STOCK_LATTE)) {
    assert.notEqual(
      paper.roles[role],
      stockHex,
      `paper ${role} is stock Catppuccin ${stockHex} — take it from face-go/internal/widgets/style.go instead`
    );
  }
});
