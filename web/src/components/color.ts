/**
 * Color, in the two shapes this needs it.
 *
 * Hex is what everything else here speaks: the server stores it, the row's edge takes it, the
 * favicon is written with it. HSV is the only one a person can pick in — a square of shade and
 * a strip of hue is a picker, and a square of red, green and blue is a puzzle.
 */
export type HSV = { h: number; s: number; v: number };

/** h is degrees; s and v are 0 to 1. */
export function hsvToHex({ h, s, v }: HSV): string {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    const value = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

export function hexToHsv(hex: string): HSV {
  const part = (at: number) => parseInt(hex.slice(at, at + 2), 16) / 255;
  const [r, g, b] = [part(1), part(3), part(5)];
  const max = Math.max(r, g, b);
  const span = max - Math.min(r, g, b);

  let h = 0;
  if (span !== 0) {
    if (max === r) h = ((g - b) / span) % 6;
    else if (max === g) h = (b - r) / span + 2;
    else h = (r - g) / span + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : span / max, v: max };
}

/** Six hex digits after a hash, lowercase, or nothing. What the server accepts. */
export function readHex(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  const full = /^#?([0-9a-f]{6})$/.exec(text);
  if (full) return `#${full[1]}`;
  // Three digits is what people type, and every browser expands it the same way.
  const short = /^#?([0-9a-f]{3})$/.exec(text);
  if (short) return `#${[...short[1]!].map((c) => c + c).join("")}`;
  return null;
}
