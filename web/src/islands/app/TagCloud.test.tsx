import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TagCloud } from "@app/islands/app/TagCloud";

const tags = [
  { id: "a", slug: "home" },
  { id: "b", slug: "work" },
];

describe("TagCloud", () => {
  it("shows the slug itself, so the pill is what goes in the URL", () => {
    render(<TagCloud tags={tags} selected={[]} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "home" })).toBeDefined();
  });

  it("marks the selected ones pressed", () => {
    render(<TagCloud tags={tags} selected={["work"]} onToggle={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "work" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "home" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  /**
   * A tag exists once a task carries it, so inventing one on the filter screen would narrow the
   * list to nothing. The editor's cloud is the one that offers it.
   */
  it("offers a new tag only where one can be created", () => {
    const { unmount } = render(
      <TagCloud tags={tags} selected={[]} onToggle={vi.fn()} />,
    );
    expect(screen.queryByText("New tag")).toBeNull();
    unmount();

    render(
      <TagCloud
        tags={tags}
        selected={[]}
        onToggle={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(screen.getByText("New tag")).toBeDefined();
  });

  /** A tag chosen in the editor but not yet on any task still has to be drawn. */
  it("shows a selected tag the account does not have yet", () => {
    render(
      <TagCloud tags={tags} selected={["brand-new"]} onToggle={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "brand-new" })).toBeDefined();
  });
});
