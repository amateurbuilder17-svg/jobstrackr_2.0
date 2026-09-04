import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ImageResponse } from "next/og";

/**
 * The default share card.
 *
 * There was none, so every link shared to WhatsApp — which is how most of this
 * site's traffic actually spreads — rendered as a bare grey box. One image,
 * generated once at build, applies to every route that does not override it.
 *
 * **Why there is no per-job card.** A `jobs/[slug]/opengraph-image.tsx` would
 * be generated per prerendered slug, and there are ~5,800 of them: several
 * minutes of build time and a large memory ceiling, on a Hobby plan, to
 * personalise the one element of a link preview that carries the least
 * information. The title and description in a preview are already per-job
 * through `generateMetadata`, and those are what a reader actually reads. If
 * the job count ever stops growing, or the plan changes, this is the first
 * thing worth revisiting.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "JobsTrackr — government jobs and exam updates";

/**
 * The app icon, inlined — the same file the browser tab uses, so the share card
 * and the tab cannot disagree about what the product looks like.
 *
 * Read at module scope and synchronously, which is load-bearing twice over.
 * `ImageResponse` fetches a remote `src` over the network, and at build time —
 * when this is rendered — there is no server to fetch it from. And an `await`
 * inside the component is uncached async work, which under Cache Components
 * takes the whole route out of static generation: the card stops being one
 * file on the CDN and becomes a function invocation per crawler.
 *
 * The path is resolved from `process.cwd()`, which is the project root during
 * the build — the only time this runs, because the route above it is static.
 * (`new URL("./icon.png", import.meta.url)` is the tidier-looking way to say
 * this and does not work: Turbopack rewrites it to the asset's *public* path,
 * `/_next/static/media/icon.<hash>.png`, which is a browser URL and not a file
 * anything can read.) `outputFileTracingIncludes` in `next.config.ts` carries
 * the PNG into the bundle regardless, so this cannot become a runtime crash if
 * the route is ever made dynamic.
 */
const ICON = `data:image/png;base64,${readFileSync(
  join(process.cwd(), "public", "brand", "app-icon-192.png"),
).toString("base64")}`;

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#f4f8f6",
        padding: "72px 80px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {/* A bare <img>: Satori renders this to a PNG at build time, and
            `next/image` has no meaning inside an `ImageResponse`. */}
        <img src={ICON} alt="" width={72} height={72} />
        <div
          style={{ fontSize: 38, fontWeight: 700, color: "#14201a", letterSpacing: "-0.02em" }}
        >
          JobsTrackr
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            fontSize: 76,
            fontWeight: 700,
            color: "#14201a",
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
            maxWidth: 900,
          }}
        >
          Every government job, without the noise
        </div>
        <div style={{ fontSize: 32, color: "#3d5449", lineHeight: 1.4, maxWidth: 820 }}>
          Notifications, deadlines and eligibility for Indian competitive exams.
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 120, height: 6, background: "#1d5240", borderRadius: 3 }} />
        <div style={{ fontSize: 26, color: "#5f7268" }}>jobstrackr.in</div>
      </div>
    </div>,
    size,
  );
}
