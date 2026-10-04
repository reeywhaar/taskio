import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Task } from "@app/api/types";
import { useHeldOrder } from "@app/islands/app/held";

const task = (id: string, pinned = false): Task =>
  ({
    id,
    title: id,
    description: "",
    tags: [],
    priority: 0,
    pinned,
    color: "",
    project: "main",
    status: "todo",
    created_at: 1,
    updated_at: 1,
    poked_at: 1,
    done_at: null,
    deleted_at: null,
  }) as Task;

const ids = (tasks: Task[]) => tasks.map((t) => t.id);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** The list as the hook sees it: a key and the server's order, which a test can change. */
function setup(first: Task[], key = "todo") {
  const onRelease = vi.fn();
  const hook = renderHook(
    ({ fresh, at }: { fresh: Task[]; at: string }) =>
      useHeldOrder(at, fresh, onRelease),
    { initialProps: { fresh: first, at: key } },
  );
  return { hook, onRelease };
}

describe("useHeldOrder", () => {
  it("keeps the order on screen for three seconds after a pin, then settles", () => {
    const { hook, onRelease } = setup([task("a"), task("b"), task("c")]);
    act(() => hook.result.current.press("c"));
    // The server's order, c pinned to the top, arrives at once.
    hook.rerender({
      fresh: [task("c", true), task("a"), task("b")],
      at: "todo",
    });

    expect(ids(hook.result.current.tasks)).toEqual(["a", "b", "c"]);
    expect(hook.result.current.tasks[2]!.pinned).toBe(true);

    act(() => vi.advanceTimersByTime(2999));
    expect(ids(hook.result.current.tasks)).toEqual(["a", "b", "c"]);
    act(() => vi.advanceTimersByTime(1));
    expect(ids(hook.result.current.tasks)).toEqual(["c", "a", "b"]);
    expect(onRelease).toHaveBeenCalledWith([{ id: "c", from: 2 }]);
  });

  it("waits again from each press", () => {
    const { hook, onRelease } = setup([task("a"), task("b"), task("c")]);
    act(() => hook.result.current.press("c"));
    act(() => vi.advanceTimersByTime(2000));
    act(() => hook.result.current.press("b"));
    act(() => vi.advanceTimersByTime(2000));
    expect(onRelease).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(onRelease).toHaveBeenCalledWith([
      { id: "c", from: 2 },
      { id: "b", from: 1 },
    ]);
  });

  it("keeps a row the list has dropped, as it now is, until it lets go", () => {
    const { hook } = setup([task("a", true), task("b", true)], "pinned");
    act(() => hook.result.current.press("a"));
    // Unpinned, it leaves the pinned view on the refetch.
    hook.rerender({ fresh: [task("b", true)], at: "pinned" });
    expect(ids(hook.result.current.tasks)).toEqual(["a", "b"]);
    expect(hook.result.current.tasks[0]!.pinned).toBe(false);
    act(() => vi.advanceTimersByTime(3000));
    expect(ids(hook.result.current.tasks)).toEqual(["b"]);
  });

  it("holds only the list it was taken on", () => {
    const { hook } = setup([task("a"), task("b")]);
    act(() => hook.result.current.press("b"));
    hook.rerender({ fresh: [task("x"), task("y")], at: "done" });
    expect(ids(hook.result.current.tasks)).toEqual(["x", "y"]);
  });

  it("draws the runs as they were while it holds", () => {
    const { hook } = setup([task("a"), task("b")]);
    act(() => hook.result.current.press("b"));
    hook.rerender({ fresh: [task("b", true), task("a")], at: "todo" });
    const [a, b] = hook.result.current.tasks;
    expect(hook.result.current.rankOf(a!)).toBe(hook.result.current.rankOf(b!));
  });
});
