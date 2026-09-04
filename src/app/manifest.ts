import type { MetadataRoute } from "next";

/**
 * The web app manifest.
 *
 * There was none, which meant the icons had nowhere to be declared: Android's
 * "Add to home screen" fell back to a screenshot of the favicon, scaled up.
 * Three entries rather than one, because the platforms genuinely differ —
 * `any` is the icon shown as drawn, and `maskable` is the one Android crops to
 * whatever shape the launcher uses, so it is full-bleed with the mark inside
 * the circular safe zone. Declaring one file as both is how icons end up with
 * their corners shaved off.
 *
 * `display: "standalone"` and nothing more ambitious: this is a reading app
 * with a URL worth keeping, so no window controls overlay and no shortcuts
 * that would duplicate the bottom nav.
 *
 * A static export — every value here is a literal — so it is generated once at
 * build and CDN-served like any other file.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JobsTrackr — Government jobs and exam updates",
    short_name: "JobsTrackr",
    description:
      "Government job notifications, exam updates, and eligibility tracking for Indian competitive exams.",
    start_url: "/",
    // Pinned rather than inferred. Without `id`, a browser derives app identity
    // from `start_url`, so changing that — or moving origin — would register as
    // a *different* installed app and orphan everyone's home-screen icon.
    id: "/",
    // Everything this app serves is under the origin root, and naming it is
    // what keeps an in-app link inside the standalone window: a navigation
    // outside `scope` is handed to the browser instead, which drops the user
    // out of the installed app.
    scope: "/",
    display: "standalone",
    /**
     * This is the colour Android paints *before the first frame*, so it should
     * be the colour the first frame actually is — and that is the launch
     * splash, not the app behind it.
     *
     * It used to be `#f2f5f2`, the light theme's ground, on the reasoning
     * above. The reasoning was right and the value was wrong: `splash.module.css`
     * paints `oklch(8% 0.012 163)` — `#000201`, near-black — and its own comment
     * records that this is "a colour scheme, not a `.dark` dependency: the
     * splash is dark in both themes". So the light value guaranteed a white
     * flash on *every* install launch, in light mode too, not just dark.
     *
     * `theme_color` deliberately stays light. It tints the OS chrome around a
     * running app rather than the launch screen, and the per-theme
     * `meta[name=theme-color]` pair in `layout.tsx` — which browsers prefer
     * over the manifest — already answers that question properly for both
     * themes. A manifest holds one value and cannot be media-queried.
     */
    background_color: "#000201",
    theme_color: "#f2f5f2",
    icons: [
      { src: "/brand/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/brand/app-icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
