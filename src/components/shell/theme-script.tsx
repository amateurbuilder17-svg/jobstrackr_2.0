/**
 * Resolves the theme before first paint.
 *
 * This has to be a blocking inline script. The alternatives both fail:
 * resolving in React means the page paints light and then flips, which is the
 * flash everyone recognises; resolving from a cookie on the server makes the
 * layout dynamic, and a dynamic layout is one that renders per request — the
 * exact thing this architecture exists to avoid.
 *
 * Minified by hand rather than by a build step, because it is inlined verbatim
 * and it is short enough to read. Roughly 200 bytes.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme:dark)').matches;document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}})()`;

export function ThemeScript() {
  // The content is a compile-time constant with no interpolation, so there is
  // no injection surface here.
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
