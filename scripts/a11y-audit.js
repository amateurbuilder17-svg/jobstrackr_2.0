/**
 * Accessibility audit — paste into the browser console, or inject via devtools.
 *
 * Checks colour contrast (WCAG AA), landmarks, accessible names, heading order
 * and cumulative layout shift, in whichever theme is currently active.
 *
 * Three measurement traps are encoded here, because each one produced a
 * confidently wrong answer during Module 3 before being caught:
 *
 *   1. Colours are authored in OKLCH, and `getComputedStyle` returns them that
 *      way. Reading the three numbers as R/G/B reports every pair on the page
 *      as failing at roughly 1.3:1. Colours are resolved by painting them to a
 *      canvas and reading the pixel back, which is the only reliable route.
 *
 *   2. Semi-transparent surfaces (the top bar is `bg-bg/85`) must be
 *      composited over the ACTUAL page background. A hard-coded white base
 *      inverts the result in dark mode and invents failures that are not there.
 *
 *   3. Focus rings cannot be checked with `element.focus()`. Browsers reserve
 *      `:focus-visible` for genuine keyboard interaction, so scripted focus
 *      reports every control as ringless. Tab through by hand instead.
 *
 * Module 12 turns this into a Playwright + axe-core job that runs in CI. Until
 * then it is run by hand, and it is written to be read.
 */
(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const pageBg = getComputedStyle(document.body).backgroundColor;
  const cache = new Map();

  function toRGB(css) {
    if (cache.has(css)) return cache.get(css);
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = pageBg; // trap 2
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const rgb = [d[0], d[1], d[2]];
    cache.set(css, rgb);
    return rgb;
  }

  const channel = (c) =>
    (c /= 255) <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const luminance = ([r, g, b]) =>
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

  function contrast(fg, bg) {
    const a = luminance(toRGB(fg));
    const b = luminance(toRGB(bg));
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return (hi + 0.05) / (lo + 0.05);
  }

  function effectiveBackground(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
        const alpha = (bg.match(/[\d.]+\s*\)$/) || [])[0];
        if (!alpha || parseFloat(alpha) > 0.5) return bg;
      }
      node = node.parentElement;
    }
    return pageBg;
  }

  const failures = [];
  const seen = new Set();
  let sampled = 0;
  let min = Infinity;

  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) continue;

    const hasOwnText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 1,
    );
    if (!hasOwnText) continue;

    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
    const required = isLarge ? 3 : 4.5;

    const bg = effectiveBackground(el);
    const key = `${cs.color}|${bg}|${isLarge ? "L" : "S"}`;
    if (seen.has(key)) continue;
    seen.add(key);

    sampled += 1;
    const ratio = contrast(cs.color, bg);
    min = Math.min(min, ratio);
    if (ratio < required) {
      const label = (el.textContent || "").trim().slice(0, 30);
      failures.push(
        `${ratio.toFixed(2)}:1 (need ${required}) ${el.tagName.toLowerCase()} "${label}"`,
      );
    }
  }

  const navs = [...document.querySelectorAll("nav")].map(
    (n) => n.getAttribute("aria-label") || "(unlabelled)",
  );

  const unnamed = [...document.querySelectorAll('a,button,input,[role="button"]')]
    .filter((el) => el.getBoundingClientRect().height > 0)
    .filter(
      (el) =>
        !(
          el.getAttribute("aria-label") ||
          el.textContent ||
          el.getAttribute("title") ||
          ""
        ).trim(),
    )
    .map((el) => el.outerHTML.slice(0, 70));

  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(
    (h) => +h.tagName[1],
  );
  const skips = headings.filter((level, i) => i > 0 && level > headings[i - 1] + 1);

  const cls = await new Promise((resolve) => {
    let total = 0;
    try {
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) total += entry.value;
      });
      po.observe({ type: "layout-shift", buffered: true });
      setTimeout(() => {
        po.disconnect();
        resolve(total);
      }, 600);
    } catch {
      resolve(-1);
    }
  });

  return {
    theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
    contrast: { sampled, min: min.toFixed(2), failures },
    navLandmarks: navs,
    duplicateNavLabels: navs.filter((v, i) => navs.indexOf(v) !== i),
    interactiveWithoutName: unnamed,
    headingSkips: skips,
    h1Count: document.querySelectorAll("h1").length,
    hasMain: Boolean(document.querySelector("main")),
    lang: document.documentElement.lang,
    cls,
    // Reminder, not a result: this cannot be measured from script (trap 3).
    focusRing: "verify by pressing Tab — element.focus() never matches :focus-visible",
  };
})();
