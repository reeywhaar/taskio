import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BRAND, markSVG, markURI } from "@app/mark";

/** Every rect as "x,y,w,h,rx,fill", which is the whole of this drawing. */
function shapes(svg: string): string[] {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  return [...doc.querySelectorAll("rect")].map((rect) => {
    const fill =
      rect.getAttribute("fill") ??
      rect.parentElement?.getAttribute("fill") ??
      "";
    return ["x", "y", "width", "height", "rx"]
      .map((name) => rect.getAttribute(name) ?? "")
      .concat(fill.toLowerCase())
      .join(",");
  });
}

describe("the mark", () => {
  /**
   * The file is what a browser loads before any of this has run, and this is what the tab wears
   * afterwards. A mark drawn in two places is a mark that gets changed in one of them.
   */
  it("is the same drawing as public/favicon.svg", () => {
    const file = readFileSync("public/favicon.svg", "utf8");
    expect(shapes(markSVG())).toEqual(shapes(file));
  });

  it("wears the color it is given", () => {
    expect(markSVG("#2563eb")).toContain("#2563eb");
    expect(markSVG("#2563eb")).not.toContain(BRAND);
  });

  /** The value lands inside an attribute, so anything that is not a color is not written. */
  it("refuses anything that is not six hex digits", () => {
    for (const bad of ['" onload="x', "red", "#fff", ""]) {
      expect(markSVG(bad)).toContain(`fill="${BRAND}"`);
    }
  });

  it("encodes to something an href can hold", () => {
    expect(markURI("#2563eb")).toMatch(/^data:image\/svg\+xml,%3Csvg/);
    expect(markURI()).not.toContain("#");
  });
});
