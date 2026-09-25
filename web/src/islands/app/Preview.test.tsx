import { fireEvent, render, screen } from "@testing-library/react";
import { marked } from "marked";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Preview } from "@app/islands/app/Preview";

const preview = (source: string, onChange = vi.fn(), onMention = vi.fn()) =>
  render(<Preview source={source} onChange={onChange} onMention={onMention} />);

const prose = () => document.querySelector(".prose")!;

describe("Preview", () => {
  it("draws the words", () => {
    preview("# Hello\n\nThere.");
    expect(screen.getByRole("heading", { name: "Hello" })).toBeDefined();
  });

  it("says so when there are none", () => {
    preview("   ");
    expect(screen.getByText("No description.")).toBeDefined();
  });

  /**
   * A flex item's implicit min-height:auto is what stops it shrinking below its own content, and
   * stating a min-height replaces it. Without shrink-0 the prose shrank to fit the dialog and its
   * last paragraphs sat under the bottom edge. jsdom lays nothing out, so this pins the class a
   * browser proved was load-bearing.
   */
  it("does not shrink below its own words", () => {
    preview("# Hello");
    expect(prose().className).toContain("shrink-0");
    expect(prose().className).toContain("min-h-50");
  });

  it("ticks a box as an edit to the text", () => {
    const onChange = vi.fn();
    preview("- [ ] one\n- [ ] two", onChange);
    fireEvent.click(document.querySelectorAll("li[data-check]")[1]!);
    expect(onChange).toHaveBeenCalledWith("- [ ] one\n- [x] two");
  });

  it("ticks from the keyboard on the box's own row", () => {
    const onChange = vi.fn();
    preview("- [ ] one", onChange);
    fireEvent.keyDown(document.querySelector("li[data-check]")!, { key: " " });
    expect(onChange).toHaveBeenCalledWith("- [x] one");
  });

  it("opens a mention rather than following it", () => {
    const onMention = vi.fn();
    preview("See @kr20fj8m.", vi.fn(), onMention);
    const chip = document.querySelector("a.mention")!;
    const followed = !fireEvent.click(chip);
    expect(onMention).toHaveBeenCalledWith("kr20fj8m");
    expect(followed).toBe(true);
  });

  /** A new tab is the link's own business, and it is a real link for that. */
  it("leaves a mention pressed for a new tab to the link", () => {
    const onMention = vi.fn();
    preview("See @kr20fj8m.", vi.fn(), onMention);
    fireEvent.click(document.querySelector("a.mention")!, { metaKey: true });
    expect(onMention).not.toHaveBeenCalled();
  });
});

/** A block marked throws on is drawn by React as text: its tags stay words. */
describe("a block that cannot be rendered", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows as its source, beside the blocks that rendered", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const real = marked.parser.bind(marked);
    vi.spyOn(marked, "parser").mockImplementation((tokens, options) => {
      if (JSON.stringify(tokens).includes("BOOM")) throw new Error("marked");
      return real(tokens, options);
    });
    preview("Before\n\nBOOM <b>bold</b>\n\nAfter");

    const bad = document.querySelector(".prose .unrendered")!;
    expect(bad.textContent).toBe("BOOM <b>bold</b>");
    expect(bad.querySelector("b")).toBeNull();
    expect(prose().textContent).toContain("Before");
    expect(prose().textContent).toContain("After");
  });
});
