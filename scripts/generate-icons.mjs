/**
 * Renders the PWA icon set from one SVG source.
 *
 * Run with `npm run icons` after changing the mark. Output goes to
 * client/public, which Vite copies to the build root verbatim.
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUT = path.resolve("client/public");
const BRAND = path.resolve("client/brand");

/**
 * Uses the real Memento artwork when it is available, and a coded placeholder
 * otherwise, so a fresh checkout still builds. Drop the square app icon at
 * client/brand/icon.png (or .svg) and re-run `npm run icons`.
 */
async function findSource() {
  for (const name of ["icon.svg", "icon.png", "icon@1024.png", "app-icon.png"]) {
    const candidate = path.join(BRAND, name);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** The album mark: a warm saffron field with the aperture glyph on top. */
function markSvg({ padding = 0, background = true }) {
  const size = 512;
  const inset = padding;
  const inner = size - inset * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="warm" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3d2378"/>
      <stop offset="100%" stop-color="#2e1a5e"/>
    </linearGradient>
  </defs>
  ${background ? `<rect width="${size}" height="${size}" rx="112" fill="url(#warm)"/>` : ""}
  <g transform="translate(${inset} ${inset}) scale(${inner / size})">
    <g transform="translate(96 96) scale(13.333)" fill="none" stroke="#ffffff" stroke-width="1.6"
       stroke-linejoin="round" stroke-linecap="round">
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2a1 1 0 0 0 .83-.45l.74-1.1A1 1 0 0 1 10.1 4h3.8a1 1 0 0 1 .83.45l.74 1.1a1 1 0 0 0 .83.45h1.2A2.5 2.5 0 0 1 20 8.5v7A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5v-7Z"/>
      <circle cx="12" cy="12" r="3.1"/>
    </g>
  </g>
</svg>`;
}

const source = await findSource();
console.log(source ? `source: ${path.relative(process.cwd(), source)}` : "source: built-in placeholder");

const targets = [
  { file: "icon-192.png", size: 192, svg: markSvg({}) },
  { file: "icon-512.png", size: 512, svg: markSvg({}) },
  { file: "apple-touch-icon.png", size: 180, svg: markSvg({}) },
  // Maskable icons are cropped to a circle by Android, so the glyph is inset.
  { file: "icon-maskable-192.png", size: 192, svg: markSvg({ padding: 64 }), maskable: true },
  { file: "icon-maskable-512.png", size: 512, svg: markSvg({ padding: 64 }), maskable: true },
  { file: "favicon-32.png", size: 32, svg: markSvg({}) },
];

await fs.mkdir(OUT, { recursive: true });

const VIOLET = { r: 46, g: 26, b: 94, alpha: 1 };

for (const target of targets) {
  const input = source ? await fs.readFile(source) : Buffer.from(target.svg);
  let buffer;

  if (target.maskable) {
    // Android crops maskable icons to a circle, so the mark is inset into the
    // safe zone (~80% of the canvas) on a full-bleed brand background.
    const safe = Math.round(target.size * 0.78);
    const mark = await sharp(input).resize(safe, safe, { fit: "contain", background: VIOLET }).toBuffer();
    buffer = await sharp({
      create: { width: target.size, height: target.size, channels: 4, background: VIOLET },
    })
      .composite([{ input: mark, gravity: "centre" }])
      .png({ compressionLevel: 9 })
      .toBuffer();
  } else {
    buffer = await sharp(input)
      .resize(target.size, target.size, { fit: "contain", background: VIOLET })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }
  await fs.writeFile(path.join(OUT, target.file), buffer);
  console.log(`  ${target.file}  ${target.size}x${target.size}  ${buffer.length} bytes`);
}

// The header logo reads /brand/mark.svg (the white mark on its own); copy
// whatever artwork is present so the two stay in step.
await fs.mkdir(path.join(OUT, "brand"), { recursive: true });
const markSource = path.join(BRAND, "mark.svg");
try {
  await fs.access(markSource);
  await fs.copyFile(markSource, path.join(OUT, "brand", "mark.svg"));
} catch {
  await fs.writeFile(path.join(OUT, "brand", "mark.svg"), markSvg({ background: false }));
}
if (source) await fs.copyFile(source, path.join(OUT, "brand", path.basename(source)));
await fs.writeFile(path.join(OUT, "icon.svg"), markSvg({}));
console.log("  icon.svg + brand/mark.svg");
