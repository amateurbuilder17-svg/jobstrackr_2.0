import Script from "next/script";

/**
 * Decides, before first paint, whether the launch splash runs.
 *
 * This has to be a script and it has to be this early, for the same reason
 * `ThemeScript` next to it does: the answer lives in `sessionStorage`, which
 * the server cannot read, and resolving it in a component means the overlay
 * paints and then disappears — a flash on every repeat view, which is worse
 * than having no splash at all.
 *
 * It sets `data-splash="show"` on `<html>`. `splash.module.css` hides the
 * overlay unless that attribute is present, so the default in every other
 * case — JavaScript off, storage unavailable, a second page load, a crawler —
 * is no splash. That direction matters: a gate that fails open would leave a
 * full-screen overlay covering the page for anyone whose script did not run.
 *
 * The timeout removes the attribute once the sequence has finished. Without
 * it, navigating away from the home page and back would remount the overlay
 * markup with the attribute still set and replay the whole animation
 * mid-session. 2,600ms is the 2,500ms CSS timeline plus a frame's slack; the
 * two numbers are coupled, and this comment is the coupling.
 *
 * `beforeInteractive` rather than a bare `<script>` element, and the lint
 * suppression below is the same Pages Router rule `ThemeScript` disables —
 * see that file for the full reasoning.
 */
const SPLASH_SCRIPT = `(function(){try{var d=document.documentElement;if(sessionStorage.getItem('jt-splash'))return;sessionStorage.setItem('jt-splash','1');d.dataset.splash='show';setTimeout(function(){delete d.dataset.splash},2600)}catch(e){}})()`;

export function SplashGate() {
  return (
    // eslint-disable-next-line @next/next/no-before-interactive-script-outside-document -- see above
    <Script id="jt-splash" strategy="beforeInteractive">
      {SPLASH_SCRIPT}
    </Script>
  );
}
