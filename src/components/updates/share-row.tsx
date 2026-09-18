import { TelegramIcon, WhatsAppIcon } from "@/components/icons";
import { Section } from "@/components/updates/detail-sections";
import { env } from "@/lib/env";

/**
 * The share row.
 *
 * ── Why this is not the share button that already exists ──────────────────
 * `UpdateActions` has one, and it is the right control for the person who has
 * already decided to share: it opens the OS sheet and falls back to the
 * clipboard. It does nothing for the much larger group who would forward a
 * result notice to a study group if a WhatsApp button were sitting in front of
 * them, and would not otherwise think to. Named destinations ask a question
 * that a generic share icon does not.
 *
 * WhatsApp and Telegram, and no others, because those are where this audience
 * actually circulates exam news — the ingest pipeline's own outbound channel is
 * Telegram, and the scraped source pages are thick with WhatsApp group invites,
 * which is the competition telling us where their traffic comes from.
 *
 * ── Why it costs nothing ──────────────────────────────────────────────────
 * Two anchors. No `"use client"`, no state, no effect, no bytes of JavaScript
 * on a page that ~5,300 URLs deep is the most-crawled route on the site. The
 * share URL is composed on the server from `NEXT_PUBLIC_SITE_URL`, so it is in
 * the static HTML and works with scripting disabled — which also means it is
 * correct in the prerendered copy a crawler reads, where `window.location`
 * would have been empty.
 *
 * `nofollow` on both: a share intent is a handoff, not an endorsement, and
 * these are the only two outbound links on the page that exist to be clicked
 * rather than read.
 */
export function ShareRow({ slug, title }: { slug: string; title: string }) {
  const url = `${env.NEXT_PUBLIC_SITE_URL}/updates/${slug}`;

  // One line, because a forwarded message is read in a notification preview.
  // The URL is appended rather than interpolated mid-sentence so that clients
  // which linkify trailing URLs — which is most of them — get a clean target.
  const message = `${title}\n\n${url}`;

  return (
    <Section title="Share this update">
      <div className="grid grid-cols-2 gap-3">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className={
            "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 " +
            "bg-[#25D366] text-sm font-semibold text-white shadow-xs " +
            "transition-opacity duration-(--duration-fast) hover:opacity-90"
          }
        >
          <WhatsAppIcon className="size-4.5 shrink-0" />
          <span>WhatsApp</span>
        </a>

        <a
          href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className={
            "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 " +
            "bg-[#229ED9] text-sm font-semibold text-white shadow-xs " +
            "transition-opacity duration-(--duration-fast) hover:opacity-90"
          }
        >
          <TelegramIcon className="size-4.5 shrink-0" />
          <span>Telegram</span>
        </a>
      </div>
    </Section>
  );
}
