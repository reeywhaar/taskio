import { fireEvent, render, screen } from "@testing-library/react";
import { marked } from "marked";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Editor } from "@app/islands/app/Editor";

const editor = (value: string, title?: string) =>
  render(
    <Editor
      value={value}
      title={title}
      onChange={vi.fn()}
      limits={{ assetMax: 1 << 20 }}
    />,
  );

/** The rendered copy, not the textarea holding the same words. */
const prose = () => document.querySelector(".prose")!.textContent!.trim();

describe("Editor", () => {
  it("offers no preview of nothing", () => {
    editor("   ");
    expect(screen.queryByRole("button", { name: "Preview" })).toBeNull();
  });

  /**
   * A tab made the preview the same size and shape as the box it replaced, which is the one
   * thing a preview should not be. It opens now, and the writing stays where it was.
   */
  it("opens the description rather than swapping the box for it", () => {
    editor("# Hello", "Fix the tap");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByRole("heading", { name: "Hello" })).toBeDefined();
    // Named after the task, because on a phone this is the whole screen and the editor behind
    // it is not there to say which task it belongs to.
    expect(screen.getByRole("heading", { name: "Fix the tap" })).toBeDefined();
    expect(
      screen.getByPlaceholderText(/Markdown\. Paste a file/),
    ).toBeDefined();
  });

  /**
   * A flex item's implicit min-height:auto is what stops it shrinking below its own content, and
   * stating a min-height replaces it. Without shrink-0 the prose shrank to fit the dialog, its
   * text painted past the end of the scrollable area, and the last paragraphs sat under the
   * bottom edge with no way to scroll to them. jsdom lays nothing out, so this pins the class
   * that a browser proved was load-bearing.
   */
  it("does not let the preview shrink below its own words", () => {
    editor("# Hello");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const box = document.querySelector(".prose")!;
    expect(box.className).toContain("shrink-0");
    expect(box.className).toContain("min-h-50");
  });

  /** An edit from elsewhere should not swap a page of prose mid-sentence. */
  it("holds the preview steady, and offers the newer text as a button", () => {
    const { rerender } = editor("first words");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(prose()).toBe("first words");

    rerender(
      <Editor
        value="second words"
        onChange={vi.fn()}
        limits={{ assetMax: 1 << 20 }}
      />,
    );
    expect(prose()).toBe("first words");

    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(prose()).toBe("second words");
  });

  it("falls back to naming the field when the task has no title yet", () => {
    editor("Some words", "  ");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("heading", { name: "Description" })).toBeDefined();
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
    editor("Before\n\nBOOM <b>bold</b>\n\nAfter");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    const bad = document.querySelector(".prose .unrendered")!;
    expect(bad.textContent).toBe("BOOM <b>bold</b>");
    expect(bad.querySelector("b")).toBeNull();
    expect(prose()).toContain("Before");
    expect(prose()).toContain("After");
  });
});
