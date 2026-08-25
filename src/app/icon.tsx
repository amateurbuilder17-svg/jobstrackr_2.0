import { ImageResponse } from "next/og";

/**
 * Favicon, generated rather than shipped as a binary.
 *
 * There was no `public/` directory at all, so every tab showed the browser's
 * default globe. Generating it here means the mark is defined once, in the
 * same tokens as the site, and cannot drift from a .ico nobody can edit.
 *
 * A tab favicon is 16 logical pixels on most screens, so this is a single
 * letterform on the accent ground — anything more detailed is mud at that size.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1d5240",
        color: "#ffffff",
        fontSize: 23,
        fontWeight: 700,
        borderRadius: 7,
      }}
    >
      J
    </div>,
    size,
  );
}
