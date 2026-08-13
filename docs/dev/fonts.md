# Fonts, and the one non-hermetic step in the build

Four families are declared in `astro.config.mjs`, all through `fontProviders.google()`. Astro
resolves each to a set of `fonts.gstatic.com` URLs at build time, downloads the `.woff2` files and
copies them into `dist/`. Nothing about the shipped site depends on Google — the fonts are
self-hosted in the output — but **the build does**, and that is the only step in it that reaches
the network for something it cannot regenerate.

## What happened on 2026-08-13

Commit `85e370c` added the front page's two extra faces, Fraunces and Vazirmatn. The push produced:

- **CI green** — both workflows passed on that commit.
- **Vercel red** — the production deploy failed after 7s.

Same commit, same lockfile, opposite results. The Vercel log:

```
[assets] Copying fonts (6 files)...
[ERROR] [vite] ✗ Build failed in 964ms
[CannotFetchFontFile] An error occurred while fetching the font file from
https://fonts.gstatic.com/s/fraunces/v38/6NVU8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0K7iN7hzFUPJH58nib1603gg7S2nfgRYIctxvBBdYiXdf1MCDlV3mcRZXg3I5VEII.woff2
Caused by: Response was not successful, received status code 404
```

A local build with the font cache deleted — a genuine cold fetch — succeeded, and resolved Fraunces
to a *different* file:

```
…/fraunces/v38/6NUu8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0K7iN7hzFUPJH58nib14c7qv8oRcTn.woff2
```

Both URLs share a prefix and then diverge; the one Vercel was handed is the longer of the two and
returns 404 from anywhere, including a plain `curl`. So this was not a network failure and not a
Vercel outage. Google's CSS API handed that build a URL for a subset slice it does not serve.

Redeploying the same commit with no change succeeded. The site has been live since.

## What this means

The failure is **non-deterministic and retry-fixable**, which is the least pleasant kind:

- A red deploy here does not imply a bad commit. Read the log before touching the config — if it is
  `CannotFetchFontFile`, redeploy first.
- CI being green proves nothing about the deploy, because they fetch independently and can be given
  different answers.
- It is likeliest on a commit that *adds or changes a font*, because that is when a URL is resolved
  for the first time rather than served from a warm build cache.

```bash
# redeploy the failed deployment, same commit, no push
npx vercel redeploy <deployment-url>
```

## The durable fix, not yet taken

Vendor the `.woff2` files into the repo and declare them with a local provider. The build then
touches the network for nothing, the exact bytes shipped are reviewable in a diff, and this failure
mode is gone permanently. The cost is four families' worth of binaries in the tree and a manual step
whenever a weight or a subset changes.

That trade has not been made yet. It should be if this recurs, and it is the obviously correct
choice for a site whose stated rule is that everything it publishes is traceable.
