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
   * As tall as its words: a floor here was a gap between the description and the comments under
   * it, so the dialog has it instead. shrink-0 so it never gets shorter either. jsdom lays
   * nothing out, so this pins the classes.
   */
  it("is as tall as its words", () => {
    preview("# Hello");
    expect(prose().className).toContain("shrink-0");
    expect(prose().className).not.toMatch(/min-h-/);
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
    expect(onMention).toHaveBeenCalledWith("kr20fj8m", undefined);
    expect(followed).toBe(true);
  });

  it("opens a comment's mention onto that comment", () => {
    const onMention = vi.fn();
    render(<Preview source="See @kr20fj8m#3." onMention={onMention} />);
    const chip = document.querySelector("a.mention")!;
    expect(chip.textContent).toBe("@kr20fj8m#3");
    expect(chip.getAttribute("href")).toBe("/t/kr20fj8m#c3");
    fireEvent.click(chip);
    expect(onMention).toHaveBeenCalledWith("kr20fj8m", 3);
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
