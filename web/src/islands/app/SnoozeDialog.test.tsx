import { describe, expect, it } from "vitest";

import { wakeAt } from "@app/islands/app/SnoozeDialog";

describe("when a snooze ends", () => {
  it("is noon, here, that many days on", () => {
    const from = new Date(2026, 10, 13, 22, 30);
    expect(wakeAt(1, "days", from)).toEqual(new Date(2026, 10, 14, 12));
    expect(wakeAt(3, "days", from)).toEqual(new Date(2026, 10, 16, 12));
  });

  it("counts a week as seven days, across a month", () => {
    const from = new Date(2026, 10, 27, 8);
    expect(wakeAt(2, "weeks", from)).toEqual(new Date(2026, 11, 11, 12));
  });
});
