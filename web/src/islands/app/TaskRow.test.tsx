import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Task } from "@app/api/types";
import { TaskRow } from "@app/islands/app/TaskRow";

const task = (over: Partial<Task> = {}): Task => ({
  id: "8qw4tz9k",
  project: "main",
  title: "Fix the tap",
  description: "",
  tags: [],
  status: "todo",
  priority: 0,
  pinned: false,
  color: "",
  created_at: 0,
  updated_at: 0,
  poked_at: 0,
  done_at: null,
  deleted_at: null,
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

  // A nought keeps out of the way until the row is pointed at, where it stands beside the pin.
  it("keeps a nought out of the way until the row is pointed at", () => {
    row();
    const zero = screen.getByTitle("Priority 0");
    expect(zero.textContent).toBe("0");
    expect(zero.className).toContain("opacity-0");
    expect(zero.className).toContain("group-hover:opacity-100");
  });

  /** The pin leads, since it is what the list sorts by first, and the number follows it. */
  it("puts the pin before the number", () => {
    row({ pinned: true, priority: 2 }, { onTogglePinned: vi.fn() });
    const pin = screen.getByRole("button", { name: "Unpin" });
    const number = screen.getByTitle("Priority 2");
    expect(
      pin.compareDocumentPosition(number) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  /**
   * An unpinned row with a number keeps its pin half there, so the number starts where it does
   * on the rows around it. At nought there is nothing beside it, so both wait for a pointer.
   */
  it("keeps a faint pin on an unpinned row with a number, and none at nought", () => {
    const set = row({ priority: 1 }, { onTogglePinned: vi.fn() });
    expect(screen.getByRole("button", { name: "Pin" }).className).toContain(
      "opacity-40",
    );
    set.unmount();

    row({}, { onTogglePinned: vi.fn() });
    const pin = screen.getByRole("button", { name: "Pin" });
    expect(pin.className).toContain("opacity-0");
    expect(screen.getByTitle("Priority 0").className).toContain("opacity-0");
  });

  it("does not hide one that is set", () => {
    row({ priority: 3 });
    expect(screen.getByTitle("Priority 3").className).not.toContain(
      "opacity-0",
    );
  });

  it("shows a negative one, which sorts below the rest", () => {
    row({ priority: -2 });
    expect(screen.getByTitle("Priority -2").textContent).toBe("-2");
  });

  /**
   * The point of printing the date: a week is where a task starts looking neglected and a month
   * is where it starts looking abandoned. Between them it is grey, which is the row saying there
   * is nothing to see.
   */
  it("colors the age at a week and again at a month", () => {
    const now = Math.floor(Date.now() / 1000);
    const day = 24 * 60 * 60;

    const fresh = row({ poked_at: now - 3 * day });
    expect(screen.getByText("3 days ago").className).toContain("text-faint");
    fresh.unmount();

    const stale = row({ poked_at: now - 14 * day });
    expect(screen.getByText("2 weeks ago").className).toContain("text-warn");
    stale.unmount();

    row({ poked_at: now - 70 * day });
    expect(screen.getByText("2 months ago").className).toContain("text-accent");
  });

  /**
   * A task in the bin says so where a live one says how long it has been sitting there: the
   * number is what a live task is judged by, and a deleted one is not waiting for anybody.
   */
  it("says deleted in place of the age, and offers the way back", () => {
    const now = Math.floor(Date.now() / 1000);
    row({
      status: "deleted",
      updated_at: now - 60 * 24 * 60 * 60,
      poked_at: now - 60 * 24 * 60 * 60,
      done_at: now,
      deleted_at: now,
    });

    const label = screen.getByText("deleted");
    expect(label.className).toContain("text-accent");
    expect(screen.queryByText(/months ago/)).toBeNull();
    expect(screen.getByRole("button", { name: "Restore" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
  });

  /** A write that is not a poke says nothing about whether anybody still wants the task. */
  it("counts a todo's age from its last poke, not its last write", () => {
    const now = Math.floor(Date.now() / 1000);
    const day = 24 * 60 * 60;
    row({ updated_at: now - day, poked_at: now - 40 * day });
    const age = screen.getByText("1 month ago");
    expect(age.className).toContain("text-accent");
    expect(age.getAttribute("title")).toMatch(/^Last poked /);
  });

  // A finished task is never late, however long ago it was finished.
  it("leaves a done task grey however old it is", () => {
    const now = Math.floor(Date.now() / 1000);
    row({ status: "done", updated_at: now - 400 * 24 * 60 * 60 });
    expect(screen.getByText("1 year ago").className).toContain("text-faint");
  });

  it("offers to pin an unpinned task and unpin a pinned one", () => {
    const onTogglePinned = vi.fn();
    const { unmount } = row({}, { onTogglePinned });
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect(onTogglePinned).toHaveBeenCalled();
    unmount();

    row({ pinned: true });
    expect(
      screen
        .getByRole("button", { name: "Unpin" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  /**
   * The bug: ticking a row opened it. Picking and opening are two halves of a mode, and the
   * box is a small target to have to hit.
   */
  it("picks rather than opens while a selection is being made", () => {
    const onOpen = vi.fn();
    const onSelect = vi.fn();
    row({}, { selectable: true, onOpen, onSelect });

    fireEvent.click(screen.getByText("Fix the tap"));
    expect(onSelect).toHaveBeenCalledWith("8qw4tz9k");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens when nothing is being picked", () => {
    const onOpen = vi.fn();
    const onSelect = vi.fn();
    row({}, { onOpen, onSelect });

    fireEvent.click(screen.getByText("Fix the tap"));
    expect(onOpen).toHaveBeenCalledWith("8qw4tz9k");
    expect(onSelect).not.toHaveBeenCalled();
  });

  /**
   * The bug: the box was a column added on the left, so every row's contents jumped sideways
   * the moment somebody pressed Select.
   */
  it("puts the box where the mark stands, so picking moves nothing", () => {
    const { container } = row({}, { selectable: true });
    const card = container.querySelector("li")!;
    expect(
      card.lastElementChild!.querySelector('input[type="checkbox"]'),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
  });

  // The box itself must not count twice: once from the input, once from the card behind it.
  it("counts a click on the box once", () => {
    const onSelect = vi.fn();
    row({}, { selectable: true, onSelect });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  // Every control in the card stops the click from reaching the card behind it.
  it("does not open the task when the pin is pressed", () => {
    const onOpen = vi.fn();
    row({}, { onOpen });
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
