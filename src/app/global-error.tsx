"use client";

import { useEffect } from "react";

/**
 * The last resort.
 *
 * `error.tsx` catches errors inside the layout. This one catches errors in the
 * root layout itself — the case where the shell, the theme script or the font
 * setup is what failed. It therefore has to render its own `<html>` and
 * `<body>`, because the ones it would normally inherit are exactly what did not
 * survive.
 *
 * For the same reason it cannot rely on the design tokens: if `globals.css`
 * failed to apply, a class name resolves to nothing. Colours here are literal
 * and the palette is inlined, so this page is legible even when the stylesheet
 * is the casualty. It is the one place in this codebase where a hard-coded
 * colour is the correct choice.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          backgroundColor: "#f4f8f6",
          color: "#14201a",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <main style={{ maxWidth: "46ch" }}>
          <h1
            style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}
          >
            JobsTrackr could not load
          </h1>
          <p style={{ marginTop: "0.75rem", lineHeight: 1.6, color: "#43554c" }}>
            Something failed before the page could start. Reloading usually fixes it.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.25rem",
              cursor: "pointer",
              borderRadius: "0.375rem",
              border: "none",
              backgroundColor: "#1d5240",
              padding: "0.6rem 1.1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              color: "#ffffff",
            }}
          >
            Reload
          </button>
          {error.digest ? (
            <p style={{ marginTop: "1.5rem", fontSize: "0.75rem", color: "#5f7268" }}>
              Reference <code>{error.digest}</code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
