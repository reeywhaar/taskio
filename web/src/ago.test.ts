import { describe, expect, it } from "vitest";

import { ago, MONTH, WEEK } from "@app/ago";

const now = 1_800_000_000;
const back = (seconds: number) => ago(now - seconds, now);

describe("ago", () => {
  it("says the coarsest unit that still says something", () => {
    expect(back(3)).toBe("just now");
    expect(back(59)).toBe("just now");
    expect(back(60)).toBe("1 min ago");
    expect(back(45 * 60)).toBe("45 mins ago");
    expect(back(3600)).toBe("1 hour ago");
    expect(back(5 * 3600)).toBe("5 hours ago");
    expect(back(24 * 3600)).toBe("1 day ago");
    expect(back(3 * 24 * 3600)).toBe("3 days ago");
  });

  // The two that matter: a week is where a task starts looking neglected and a month is where
  // it starts looking abandoned.
  it("counts the weeks and months the color changes on", () => {
    expect(back(WEEK)).toBe("1 week ago");
    expect(back(2 * WEEK)).toBe("2 weeks ago");
    expect(back(MONTH)).toBe("1 month ago");
    expect(back(2 * MONTH)).toBe("2 months ago");
    expect(back(400 * 24 * 3600)).toBe("1 year ago");
  });

  // A clock a few seconds out of step is not a task touched in the future.
  it("does not count forwards", () => {
    expect(ago(now + 30, now)).toBe("just now");
  });
});
