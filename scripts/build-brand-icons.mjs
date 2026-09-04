#!/usr/bin/env node
/**
 * Generates every derivative of the JobsTrackr mark from one master.
 *
 * The mark exists as a single 1024×1024 PNG whose every visible pixel is white
 * and whose shape lives entirely in the alpha channel. That is the only file
 * anyone should ever edit: the white emblem, the navy emblem, the app icons,
 * the maskable icon and the favicon are all derived from it here, so the
 * colours cannot drift between the tab icon, the home-screen icon and the
 * header — which is exactly what had happened across the three generations of
 * icons sitting in the legacy project's `public/`.
 *
 *   node scripts/build-brand-icons.mjs [path/to/logo-master.png]
 *
 * Not wired into `pnpm build`, for the same reason `build-brand-art.mjs` is
 * not: the master changes once a year, and a build step that rewrites
 * committed binaries makes every diff noisy. `sharp` comes in with Next's
 * image optimiser, so there is no dependency to install.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const brand = join(root, "public", "brand");
const appDir = join(root, "src", "app");

// The master is not in this repository — it is the design file, and the only
// copy of it lives beside the legacy web app.
const master = process.argv[2] ?? join(root, "..", "src", "assets", "logo-color.png");

/* ── Brand colour ────────────────────────────────────────────────────────
   Sampled from the icon artwork rather than invented: the ground is the navy
   of the app icon's squircle, top-left to bottom-right, and the emblem
   gradient is the blue of the transparent-background logo. Two gradients, four
   values, and nothing else in this file is a colour. */
const GROUND = { from: "#2e4276", to: "#101f45" };
const EMBLEM = { from: "#17498f", to: "#062458" };

/** iOS' squircle radius, as a fraction of the icon's side. */
const RADIUS = 0.2237;

await mkdir(brand, { recursive: true });

/* ── The emblem, cropped to its own ink ──────────────────────────────────
   The master is a 1024px canvas with the mark floating inside it. Everything
   below wants the mark, not the canvas, so the alpha bounding box is measured
   once and every derivative is cut from it. Trimming here rather than padding
   in CSS is what lets the header place the mark on a baseline without a magic
   negative margin. */
const { data: alpha, info } = await sharp(master)
  .ensureAlpha()
  .extractChannel("alpha")
  .raw()
  .toBuffer({ resolveWithObject: true });

const box = bounds(alpha, info.width, info.height);
const cropped = sharp(master).extract(box);
const ASPECT = box.width / box.height;

/* ── 1. The white emblem ─────────────────────────────────────────────────
   Drawn on the credential artwork and on the splash's dark disc, where it is
   never any other colour. Greyscale-plus-alpha rather than RGBA: every visible
   pixel is the same white, so three identical colour planes are two planes of
   waste. */
const MARK_W = 540;
const MARK_H = Math.round(MARK_W / ASPECT);

{
  const a = await markAlpha(MARK_W, MARK_H);
  const greyAlpha = Buffer.alloc(MARK_W * MARK_H * 2);
  for (let i = 0; i < MARK_W * MARK_H; i++) {
    greyAlpha[i * 2] = 255;
    greyAlpha[i * 2 + 1] = a[i];
  }
  await sharp(greyAlpha, { raw: { width: MARK_W, height: MARK_H, channels: 2 } })
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(join(brand, "logo-mark.png"));

  // AVIF wants three colour planes. They are constant, so they cost nothing.
  await sharp({ create: { width: MARK_W, height: MARK_H, channels: 3, background: "#fff" } })
    .joinChannel(a, { raw: { width: MARK_W, height: MARK_H, channels: 1 } })
    .avif({ quality: 72 })
    .toFile(join(brand, "logo-mark.avif"));
  report("brand/logo-mark.png", "brand/logo-mark.avif");
}

/* ── 2. The navy emblem ──────────────────────────────────────────────────
   The same shape in the brand blue, for the app chrome in light mode — where
   a white mark is invisible. It is a second file rather than a CSS filter on
   the first because a hand-tuned `hue-rotate` chain is a colour nobody can
   look up, and because the light and dark rules swap a background image, so
   only the one that applies is ever fetched. */
await tinted(MARK_W, MARK_H, EMBLEM, join(brand, "logo-mark-navy"));

/* ── 3. App icons ────────────────────────────────────────────────────────
   Three shapes, because the platforms genuinely differ:
   `squircle` — rounded corners, transparent outside them. Browser tabs and
     anywhere the icon is shown as-is.
   `square`   — full bleed, opaque. iOS and Android both apply their own mask;
     handing them pre-rounded corners rounds the icon twice, and a transparent
     corner is composited onto black by iOS.
   `maskable` — full bleed with the mark at 60%, so it survives Android's
     circular crop. */
await icon(180, "square", join(appDir, "apple-icon.png"));
await icon(192, "squircle", join(appDir, "icon.png"));
await icon(192, "squircle", join(brand, "app-icon-192.png"));
await icon(512, "squircle", join(brand, "app-icon-512.png"));
await icon(512, "maskable", join(brand, "app-icon-maskable-512.png"));

/* ── 4. favicon.ico ──────────────────────────────────────────────────────
   Only for the browsers that still ask `/favicon.ico` before reading the
   markup. Three PNG frames in an ICO container — the format has allowed PNG
   payloads since Vista, and every browser that requests this file supports
   them. */
{
  const frames = [];
  for (const size of [16, 32, 48]) frames.push(await icon(size, "squircle"));
  await writeFile(join(appDir, "favicon.ico"), ico(frames));
  report("app/favicon.ico");
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

/**
 * The emblem's alpha at a given size, posterised to 16 levels.
 *
 * The master's edge carries 256 levels of anti-aliasing, which is 256 values
 * for PNG to encode along every curve in a shape made entirely of curves: the
 * fallback lands at 57 kB. Sixteen levels is more gradient than a 1px edge can
 * show — the two files are indistinguishable at any size the mark is drawn —
 * and the PNG drops to 8 kB, which is smaller than the AVIF beside it. This
 * repository has no `imagequant`, so `png({ palette: true })` is a silent
 * no-op; quantising the channel by hand is the same idea a step earlier.
 */
async function markAlpha(w, h) {
  const a = await cropped.clone().extractChannel("alpha").resize(w, h).raw().toBuffer();
  const step = 255 / 15;
  for (let i = 0; i < a.length; i++) a[i] = Math.round(Math.round(a[i] / step) * step);
  return a;
}

/** The tight bounding box of everything with meaningful alpha. */
function bounds(a, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (a[y * width + x] <= 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** `<linearGradient>` across the diagonal, which is how both marks are drawn. */
function gradient(id, { from, to }) {
  return (
    `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient>`
  );
}

/** The emblem's alpha, filled with a gradient. PNG and AVIF. */
async function tinted(w, h, colour, out) {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<defs>${gradient("g", colour)}</defs>` +
      `<rect width="${w}" height="${h}" fill="url(#g)"/></svg>`,
  );
  // `dest-in` keeps the gradient only where the emblem is opaque — the mark
  // punched out of a solid sheet of colour. (`joinChannel` looks like the
  // shorter way to say this and is not: on an SVG pipeline it appends a fourth
  // band that PNG then drops, and the file comes out a solid rectangle.)
  const a = await markAlpha(w, h);
  const stencil = await sharp({
    create: { width: w, height: h, channels: 3, background: "#fff" },
  })
    .joinChannel(a, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();
  const fill = sharp(svg).composite([{ input: stencil, blend: "dest-in" }]);

  await fill.clone().png({ compressionLevel: 9, effort: 10 }).toFile(`${out}.png`);
  await fill.clone().avif({ quality: 72 }).toFile(`${out}.avif`);
  report(`${out.split("/public/").pop()}.png`, `${out.split("/public/").pop()}.avif`);
}

/**
 * One app icon: the white mark centred on the navy ground.
 *
 * Returns the buffer, and writes it only when given a path — the favicon
 * frames are wanted in memory, not on disk.
 */
async function icon(size, shape, out) {
  const radius = shape === "squircle" ? size * RADIUS : 0;
  const ground = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<defs>${gradient("g", GROUND)}</defs>` +
      `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="url(#g)"/></svg>`,
  );

  // 60% inside Android's circular safe zone; 64% elsewhere, which is the
  // optical weight the icon was drawn at.
  const markH = Math.round(size * (shape === "maskable" ? 0.6 : 0.64));
  const markW = Math.round(markH * ASPECT);
  const mark = await cropped.clone().resize(markW, markH).png().toBuffer();

  const png = await sharp(ground)
    .composite([{ input: mark, gravity: "centre" }])
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();

  if (out) {
    await writeFile(out, png);
    report(
      out.includes("/public/") ? out.split("/public/").pop() : `app/${out.split("/").pop()}`,
    );
  }
  return { size, png };
}

/** ICO container around PNG frames. */
function ico(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(frames.length, 4);

  let offset = 6 + frames.length * 16;
  const entries = frames.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });

  return Buffer.concat([header, ...entries, ...frames.map((f) => f.png)]);
}

function report(...names) {
  for (const name of names) console.log(`  ✓ ${name}`);
}
