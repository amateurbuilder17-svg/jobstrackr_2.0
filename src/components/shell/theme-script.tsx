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
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme:dark)').matches;var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light'}catch(e){}})()`;

export function ThemeScript() {
  return (
    <Script id="jt-theme" strategy="beforeInteractive">
      {THEME_SCRIPT}
    </Script>
  );
}
