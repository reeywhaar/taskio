import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Task } from "@app/api/types";
import { Editor } from "@app/islands/app/Editor";
import { TaskRow } from "@app/islands/app/TaskRow";

// A parser that throws on everything: what a description marked cannot handle looks like.
vi.mock("@app/markdown", () => ({
  render: () => {
    throw new Error('Token with "code" type was not found.');
  },
  excerpt: () => {
    throw new Error('Token with "code" type was not found.');
  },
  toggleCheck: (source: string) => source,
}));

const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

/** A description the parser throws on is that description's trouble, not the screen's. */
describe("a description that cannot be rendered", () => {
  it("leaves the editor standing, with the text still there to fix", () => {
    quiet();
    render(
      <Editor
        value="1. a list"
        onChange={vi.fn()}
        limits={{ assetMax: 1 << 20 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(
      screen.getByText(/The description could not be shown/),
    ).toBeDefined();
    expect(screen.getByDisplayValue("1. a list")).toBeDefined();
  });

  it("leaves the row its title, and says the description could not be shown", () => {
    quiet();
    render(
      <TaskRow
        task={
          {
            id: "8qw4tz9k",
            project: "main",
            title: "Fix the tap",
            description: "1. a list",
            tags: [],
            status: "todo",
            priority: 0,
            pinned: false,
            color: "",
            created_at: 0,
            updated_at: 0,
            done_at: null,
            deleted_at: null,
          } satisfies Task
        }
        selectable={false}
        selected={false}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("Fix the tap")).toBeDefined();
    expect(
      screen.getByText("The description could not be shown."),
    ).toBeDefined();
  });
});
