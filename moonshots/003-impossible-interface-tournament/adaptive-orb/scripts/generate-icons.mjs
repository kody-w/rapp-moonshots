import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iconDirectory = resolve(root, "icons");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function createIcon(size) {
  const background = [247, 244, 239, 255];
  const accent = [177, 31, 75, 255];
  const surface = [255, 255, 255, 255];
  const rows = Buffer.alloc((size * 4 + 1) * size);
  const center = (size - 1) / 2;
  const outerRadius = size * 0.31;
  const innerRadius = size * 0.19;
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    rows[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - center, y - center);
      const color =
        distance <= innerRadius
          ? surface
          : distance <= outerRadius
            ? accent
            : background;
      const offset = rowStart + 1 + x * 4;
      rows.set(color, offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

await mkdir(iconDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(iconDirectory, "apple-touch-icon.png"), createIcon(180)),
  writeFile(resolve(iconDirectory, "icon-192.png"), createIcon(192)),
  writeFile(resolve(iconDirectory, "icon-512.png"), createIcon(512)),
]);

process.stdout.write("Generated local Adaptive Orb PWA icons (180, 192, 512).\n");
