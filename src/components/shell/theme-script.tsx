import Script from "next/script";

/**
 * Resolves the theme before first paint.
 *
 * This has to run ahead of React. The alternatives both fail: resolving in a
 * component means the page paints light and then flips, which is the flash
 * everyone recognises; resolving from a cookie on the server makes the layout
 * dynamic, and a dynamic layout renders per request — the exact thing this
 * architecture exists to avoid.
 *
 * Delivered through `next/script` with `beforeInteractive` rather than a bare
 * `<script>` element. A raw script rendered by a React component logs
 * "Scripts inside React components are never executed when rendering on the
 * client" — harmless in production, since it does run in the initial HTML, but
 * it is a console error on every page and console errors that are normal are
 * console errors nobody reads. `beforeInteractive` injects it into the document
 * ahead of hydration, which is both correct and quiet.
 *
 * Minified by hand because it is inlined verbatim and short enough to read.
 *
 * The lint rule disabled below is a Pages Router rule: it wants
 * `beforeInteractive` confined to `pages/_document.js`, which does not exist in
 * an App Router project. Verified empirically rather than assumed — swapping
 * this back to a bare `<script>` reproduces the console error on every page,
 * while this version emits none. `beforeInteractive` does not hoist the tag
 * into `<head>` here; it renders inline at the top of `<body>`, which still runs
 * before any body content paints, so the anti-flash guarantee holds.
 */
/**
 * The credential screens are dark by default.
 *
 * They are the one place in the app that is designed dark-first — full-bleed
 * artwork behind a glass card — so a visitor who has never touched the toggle
 * should land on the screen as it was drawn, rather than on whatever their OS
 * happens to prefer. An explicit choice still wins: the check below only
 * replaces the *system* fallback, so someone who has picked light stays in
 * light here too, and the toggle on the screen keeps working.
 *
 * Matched on the pathname because this script runs before React exists and has
 * no other way to know the route. Client-side navigation into these routes
 * does not re-run it — `AuthDarkDefault` in the auth layout covers that case,
 * and the two have to agree on this list.
 */
const AUTH_ROUTES = /^\/(sign-in|sign-up|forgot-password|reset-password)\/?$/;

const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');var a=${String(AUTH_ROUTES)}.test(location.pathname);var d=t?t==='dark':a||matchMedia('(prefers-color-scheme:dark)').matches;var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light'}catch(e){}})()`;

export function ThemeScript() {
  return (
    // eslint-disable-next-line @next/next/no-before-interactive-script-outside-document -- see above
    <Script id="jt-theme" strategy="beforeInteractive">
      {THEME_SCRIPT}
    </Script>
  );
}
