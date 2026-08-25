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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 72,
            height: 72,
            borderRadius: 16,
            background: "#1d5240",
            color: "#ffffff",
            fontSize: 46,
            fontWeight: 700,
          }}
        >
          J
        </div>
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
