import { describe, expect, it } from "vitest";

import { lengthName } from "@app/islands/app/TokenFields";

/** The row and the dialog say this the same way: the row once rounded two days up to a week. */
describe("lengthName", () => {
  it("names the presets as the menu does", () => {
    expect(lengthName(86400)).toBe("a day");
    expect(lengthName(7 * 86400)).toBe("a week");
    expect(lengthName(30 * 86400)).toBe("a month");
  });

  it("says anything else exactly", () => {
    expect(lengthName(2 * 86400)).toBe("2 days");
    expect(lengthName(36 * 3600)).toBe("36 hours");
  });
});
