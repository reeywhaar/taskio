/**
 * Draws public/favicon.ico from the same geometry as public/favicon.svg.
 *
 * The svg is what browsers use. The ico exists because Safari and anything older ask for
 * /favicon.ico by name, and without one that request reaches the SPA and is answered with a
 * redirect to the sign-in page — an HTML document where an icon was expected.
 *
 * Written by hand rather than with a converter: the mark is two rectangles on a rounded
 * square, which is less code than a dependency to draw it and leaves nothing to install.
 *
 *   node scripts/favicon.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";

const SIZE = 32;
const RADIUS = 7;
const GROUND = [0xff, 0xf7, 0xf0, 255];
const BRAND = [0xef, 0x65, 0x00, 255];

/** The bar and the stem, in the svg's coordinates. */
const inMark = (x, y) =>
  (x >= 6 && x < 26 && y >= 7 && y < 13) ||
  (x >= 13 && x < 19 && y >= 7 && y < 25);

/** Outside a corner's arc is transparent, which is what rounds the tile. */
function inTile(x, y) {
  for (const [cx, cy] of [
    [RADIUS, RADIUS],
    [SIZE - RADIUS, RADIUS],
    [RADIUS, SIZE - RADIUS],
    [SIZE - RADIUS, SIZE - RADIUS],
  ]) {
    const outX = cx === RADIUS ? x < cx : x > cx;
    const outY = cy === RADIUS ? y < cy : y > cy;
    if (outX && outY) return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2;
  }
  return true;
}

const raw = Buffer.concat(
  Array.from({ length: SIZE }, (_, y) => {
    const row = [0]; // filter: none
    for (let x = 0; x < SIZE; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      if (!inTile(px, py)) row.push(0, 0, 0, 0);
      else row.push(...(inMark(px, py) ? BRAND : GROUND));
    }
    return Buffer.from(row);
  }),
);

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(tag, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(tag, "ascii"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

// An ICO carrying a PNG rather than a BMP, which every browser that still asks for .ico reads.
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image
header[6] = SIZE % 256;
header[7] = SIZE % 256;
header.writeUInt16LE(1, 10); // colour planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32BE(0, 14);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18); // where the payload starts

await writeFile("public/favicon.ico", Buffer.concat([header, png]));
console.log(`favicon.ico: ${22 + png.length} bytes`);
