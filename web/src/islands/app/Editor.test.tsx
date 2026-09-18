import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
    const prose = document.querySelector(".prose")!;
    expect(prose.className).toContain("shrink-0");
    expect(prose.className).toContain("min-h-50");
  });

  it("falls back to naming the field when the task has no title yet", () => {
    editor("Some words", "  ");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("heading", { name: "Description" })).toBeDefined();
  });
});
