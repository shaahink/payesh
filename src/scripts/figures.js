/* The interactive figures' shared runtime (owner's ask, 2026-08-13: the
   concepts should be watchable, not only readable). Each drawing owns its own
   behaviour in a script beside its markup; what they share is only the
   contract. Find the figure by its data-fig name, hand it to the component's
   init, and answer the one environment question every animation has to ask.

   The controls are hidden for a visitor with no JS by styles.css
   (html:not(.js) .fig-controls) — the theme toggle's bargain, made again for
   the same reason: every drawing is complete as a still, so nothing is lost,
   and a button that could not respond is simply not there to lie about it. */

/**
 * @param {string} name
 * @param {(figure: HTMLElement) => void} init
 */
export function wire(name, init) {
  for (const figure of document.querySelectorAll(`figure[data-fig="${name}"]`)) {
    init(/** @type {HTMLElement} */ (figure));
  }
}

/* Asked at the moment of animating rather than cached at load: the visitor
   can change the setting mid-visit, and a stale answer would keep animating
   against their word. A figure that staggers its steps asks this first and
   lands everything at once when the answer is reduce. */
export function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* One timing for every staggered reveal, so ten figures feel like one
   instrument rather than ten. Returns the handle so an init that re-runs can
   cancel the previous pass instead of racing it. */
/**
 * @template T
 * @param {T[]} items
 * @param {(item: T, index: number) => void} each
 * @param {() => void} [done]
 * @returns {ReturnType<typeof setInterval> | null}
 */
export function stagger(items, each, done) {
  if (reducedMotion()) {
    items.forEach(each);
    if (done) done();
    return null;
  }
  let index = 0;
  const handle = setInterval(() => {
    if (index >= items.length) {
      clearInterval(handle);
      if (done) done();
      return;
    }
    each(items[index], index);
    index += 1;
  }, 260);
  return handle;
}
