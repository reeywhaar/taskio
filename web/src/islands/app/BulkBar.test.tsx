import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BulkBar } from "@app/islands/app/BulkBar";
import { mount } from "@app/test/harness";

const postTasksBulkPinned = vi.fn();
const postTasksBulkPriority = vi.fn();
const postTasksBulkDone = vi.fn();
const postTasksBulkTodo = vi.fn();
vi.mock("@app/api/actions/tasks", () => ({
  postTasksBulkPinned: (ids: string[], pinned: boolean) =>
    postTasksBulkPinned(ids, pinned),
  postTasksBulkPriority: (ids: string[], priority: number) =>
    postTasksBulkPriority(ids, priority),
  postTasksBulkDone: (ids: string[]) => postTasksBulkDone(ids),
  postTasksBulkTodo: (ids: string[]) => postTasksBulkTodo(ids),
  postTasksBulkTags: vi.fn(),
  postTasksBulkDelete: vi.fn(),
}));

const ids = ["8qw4tz9k", "kr20fj8m"];
const bar = (view: "pinned" | "todo" | "done" = "todo") =>
  mount(<BulkBar ids={ids} view={view} onDone={vi.fn()} />);

describe("BulkBar", () => {
  beforeEach(() => {
    for (const fn of [
      postTasksBulkPinned,
      postTasksBulkPriority,
      postTasksBulkDone,
      postTasksBulkTodo,
    ]) {
      fn.mockReset().mockResolvedValue(undefined);
    }
  });

  /**
   * The bug: pinning followed the view, as the status button does. But no view fixes whether a
   * task is pinned — a todo list holds both — so from there a selection could be pinned and
   * never unpinned.
   */
  it("offers both pin and unpin from every view", async () => {
    for (const view of ["todo", "pinned", "done"] as const) {
      const { unmount } = bar(view);
      fireEvent.click(screen.getByRole("button", { name: "Pin" }));
      await waitFor(() =>
        expect(postTasksBulkPinned).toHaveBeenCalledWith(ids, true),
      );

      fireEvent.click(screen.getByRole("button", { name: "Unpin" }));
      await waitFor(() =>
        expect(postTasksBulkPinned).toHaveBeenCalledWith(ids, false),
      );
      unmount();
    }
  });

  // This one the view does fix: a todo list is all todos, so only one of the two can move them.
  it("offers the one status action the view leaves open", () => {
    const { unmount } = bar("todo");
    expect(screen.getByRole("button", { name: "Mark done" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Mark as todo" })).toBeNull();
    unmount();

    bar("done");
    expect(screen.getByRole("button", { name: "Mark as todo" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
  });

  it("sets one priority across the selection", async () => {
    bar();
    fireEvent.click(screen.getByRole("button", { name: "Priority" }));
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set" }));

    await waitFor(() =>
      expect(postTasksBulkPriority).toHaveBeenCalledWith(ids, -2),
    );
  });
});
