import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Task } from "@app/api/types";
import { TaskRow } from "@app/islands/app/TaskRow";

const task = (over: Partial<Task> = {}): Task => ({
  id: "8qw4tz9k",
  title: "Fix the tap",
  description: "",
  tags: [],
  status: "todo",
  priority: 0,
  pinned: false,
  created_at: 0,
  updated_at: 0,
  done_at: null,
  ...over,
});

const row = (over: Partial<Task> = {}, props = {}) =>
  render(
    <TaskRow
      task={task(over)}
      selectable={false}
      selected={false}
      onSelect={vi.fn()}
      onOpen={vi.fn()}
      onToggleDone={vi.fn()}
      onTogglePinned={vi.fn()}
      {...props}
    />,
  );

describe("TaskRow", () => {
  /** A zero on every row is a column of noughts, and the number is there to be noticed. */
  it("shows a priority only when there is one", () => {
    row({ priority: 5 });
    expect(screen.getByTitle("Priority 5").textContent).toBe("5");
  });

  it("draws nothing for the ordinary case", () => {
    row();
    expect(screen.queryByTitle(/^Priority/)).toBeNull();
  });

  it("shows a negative one, which sorts below the rest", () => {
    row({ priority: -2 });
    expect(screen.getByTitle("Priority -2").textContent).toBe("-2");
  });

  it("offers to pin an unpinned task and unpin a pinned one", () => {
    const onTogglePinned = vi.fn();
    const { unmount } = row({}, { onTogglePinned });
    fireEvent.click(screen.getByRole("button", { name: "Pin Fix the tap" }));
    expect(onTogglePinned).toHaveBeenCalled();
    unmount();

    row({ pinned: true });
    expect(
      screen
        .getByRole("button", { name: "Unpin Fix the tap" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  // Every control in the card stops the click from reaching the card behind it.
  it("does not open the task when the pin is pressed", () => {
    const onOpen = vi.fn();
    row({}, { onOpen });
    fireEvent.click(screen.getByRole("button", { name: "Pin Fix the tap" }));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
