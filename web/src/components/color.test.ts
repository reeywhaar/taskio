import { describe, expect, it } from "vitest";

import { COLOURS } from "@app/components/Swatches";
import { hexToHsv, hsvToHex, readHex } from "@app/components/color";

describe("color", () => {
  /** The picker works in HSV and everything else speaks hex, so the trip has to be lossless. */
  it("comes back as the color it went in as", () => {
    for (const hex of [
      ...COLOURS,
      "#000000",
      "#ffffff",
      "#123456",
      "#0f0f0f",
    ]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it("reads black and white without a hue to speak of", () => {
    expect(hexToHsv("#000000")).toEqual({ h: 0, s: 0, v: 0 });
    expect(hexToHsv("#ffffff")).toEqual({ h: 0, s: 0, v: 1 });
  });

  it("puts the primaries a third of the wheel apart", () => {
    expect(Math.round(hexToHsv("#ff0000").h)).toBe(0);
    expect(Math.round(hexToHsv("#00ff00").h)).toBe(120);
    expect(Math.round(hexToHsv("#0000ff").h)).toBe(240);
  });

  it("takes a hex the way somebody would type one", () => {
    expect(readHex("#2563EB")).toBe("#2563eb");
    expect(readHex("2563eb")).toBe("#2563eb");
    expect(readHex(" #ABC ")).toBe("#aabbcc");
    for (const bad of ["", "#12", "blue", "#12345g", "#1234567"]) {
      expect(readHex(bad)).toBeNull();
    }
  });
});
