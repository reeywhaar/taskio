import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Task } from "@app/api/types";
import { SelectionDialog } from "@app/islands/app/SelectionDialog";
import { mount } from "@app/test/harness";

const task = (id: string, title: string, over: Partial<Task> = {}): Task => ({
  id,
  project: "main",
  title,
  description: "See [the notes](https://example.com)",
  tags: ["home"],
  status: "todo",
  priority: 0,
  pinned: false,
  color: "",
  created_at: 0,
  updated_at: 0,
  done_at: null,
  deleted_at: null,
  ...over,
});

// One from the todo list, one finished, one in another project: none of them need be on screen.
const known: Record<string, Task> = {
  "8qw4tz9k": task("8qw4tz9k", "Fix the tap", { pinned: true }),
  kr20fj8m: task("kr20fj8m", "Buy washers", { status: "done", done_at: 1 }),
  m3v9x2pq: task("m3v9x2pq", "Sow the beans", { project: "garden" }),
};
vi.mock("@app/api/actions/tasks", () => ({
  getTasksById: (id: string) =>
    known[id] ? Promise.resolve(known[id]) : Promise.reject(new Error("gone")),
}));

describe("SelectionDialog", () => {
  it("lists every selected task, whichever view or project it is in", async () => {
    mount(
      <SelectionDialog
        open
        ids={["8qw4tz9k", "kr20fj8m", "m3v9x2pq"]}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText("Fix the tap")).toBeDefined();
    expect(await screen.findByText("Buy washers")).toBeDefined();
    expect(await screen.findByText("Sow the beans")).toBeDefined();
    expect(screen.getByRole("heading", { name: "3 selected" })).toBeDefined();
  });

  /** A row to look at: the only thing to press is the dialog's own close. */
  it("draws rows with nothing to press in them", async () => {
    mount(<SelectionDialog open ids={["8qw4tz9k"]} onClose={vi.fn()} />);
    const row = (await screen.findByText("Fix the tap")).closest("li")!;
    expect(within(row).queryAllByRole("button")).toEqual([]);
    expect(within(row).queryAllByRole("link")).toEqual([]);
    expect(within(row).queryAllByRole("checkbox")).toEqual([]);
    expect(within(row).getByLabelText("Pinned")).toBeDefined();
  });

  it("says which one could not be read", async () => {
    mount(<SelectionDialog open ids={["zzzzzzzz"]} onClose={vi.fn()} />);
    expect(await screen.findByText("zzzzzzzz could not be read")).toBeDefined();
  });
});
