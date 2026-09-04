#!/usr/bin/env node
/**
 * Generates every file in `public/brand` from the design masters.
 *
 * The artwork is served as pre-encoded AVIF with a JPEG fallback rather than
 * through `next/image` — see `src/components/brand/artwork.tsx` for the
 * measurement behind that. Pre-encoding means the variants are build inputs,
 * not build outputs, so this script exists to make them reproducible: a master
 * changes, this runs, and nobody has to remember which quality setting the
 * last person used.
 *
 * It is deliberately NOT wired into `pnpm build`. The masters change once a
 * year at most, the encode takes seconds per file, and a build step that
 * rewrites committed binaries on every CI run makes every diff noisy.
 *
 *   node scripts/build-brand-art.mjs [path/to/masters]
 *
 * `sharp` comes in with Next's image optimiser, so there is no extra
 * dependency to install.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "brand");

// Where the design files live. Overridable, because they are not in this
// repository — they are 4 MB of PNG masters that only this script reads.
const masters = process.argv[2] ?? join(root, "..", "..", "new y videos", "assets");

/** AVIF quality. 62 is where these particular images stop improving: the
    artwork is smooth gradients, which AVIF handles far better than JPEG, and
    the 1920px sweep lands at 18 kB with no visible banding. */
const AVIF_QUALITY = 62;

await mkdir(out, { recursive: true });

/**
 * The credential-screen background. Widths chosen for the three cases that
 * exist: a phone at 2×, a laptop, and everything above it.
 */
await variants({
  master: join(masters, "login-bg@2x.png"),
  name: "auth-bg",
  widths: [768, 1280, 1920],
  fallbackWidth: 1280,
  fallbackQuality: 80,
});

/**
 * The splash's landscape. Cropped to the bottom 44% of the master — the band
 * that holds the ridge line and the road. The full portrait image cannot be
 * used as a background at desktop aspect ratios: scaled to cover, it pushes
 * the mountains off screen entirely.
 */
await variants({
  master: join(masters, "splash-bg@2x.png"),
  name: "splash-ridge",
  widths: [640, 946],
  fallbackWidth: 946,
  fallbackQuality: 82,
  crop: async (image) => {
    const { width, height } = await image.metadata();
    const top = Math.round(height * 0.56);
    return image.extract({ left: 0, top, width, height: height - top });
  },
});

/*
 * The emblem used to be generated here too. It moved to
 * `build-brand-icons.mjs`, which derives the white mark, the navy mark, the
 * app icons and the favicon from one 1024px master — so the tab icon, the
 * home-screen icon and the header cannot drift apart. This file now owns only
 * the two photographs.
 */

async function variants({ master, name, widths, fallbackWidth, fallbackQuality, crop }) {
  let base = sharp(master);
  if (crop) base = await crop(base);
  const buffer = await base.toBuffer();

  for (const width of widths) {
    await sharp(buffer)
      .resize(width, null, { kernel: "lanczos3" })
      .avif({ quality: AVIF_QUALITY })
      .toFile(join(out, `${name}-${width}.avif`));
    report(`${name}-${width}.avif`);
  }

  await sharp(buffer)
    .resize(fallbackWidth, null, { kernel: "lanczos3" })
    .jpeg({ quality: fallbackQuality, progressive: true, mozjpeg: true })
    .toFile(join(out, `${name}-${fallbackWidth}.jpg`));
  report(`${name}-${fallbackWidth}.jpg`);
}

async function report(file) {
  const { size } = await (await import("node:fs/promises")).stat(join(out, file));
  console.log(`  ${file.padEnd(28)} ${(size / 1024).toFixed(1)} kB`);
}
