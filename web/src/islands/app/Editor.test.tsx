import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Editor } from "@app/islands/app/Editor";

describe("Editor", () => {
  /** Reading is the dialog's other face, switched from its title bar, not a button here. */
  it("is only the writing", () => {
    render(
      <Editor
        value="# Hello"
        onChange={vi.fn()}
        limits={{ assetMax: 1 << 20 }}
      />,
    );
    expect(screen.getByDisplayValue("# Hello")).toBeDefined();
    expect(screen.queryByRole("button", { name: "View" })).toBeNull();
    expect(document.querySelector(".prose")).toBeNull();
  });
});
