import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Task } from "@app/api/types";
import { Elsewhere } from "@app/islands/app/Elsewhere";

const task = (id: string, title: string, status: "todo" | "done"): Task => ({
  id,
  title,
  status,
  description: "",
  tags: [],
  priority: 0,
  pinned: false,
  created_at: 1789343452,
  updated_at: 1789343452,
  done_at: status === "done" ? 1789343452 : null,
});

const headings = () =>
  screen.queryAllByRole("heading").map((h) => h.textContent);

const rows = (heading: string) =>
  [
    ...(screen
      .getByRole("heading", { name: heading })
      .parentElement?.querySelectorAll("li[data-task]") ?? []),
  ].map((li) => li.getAttribute("data-task"));

describe("Elsewhere", () => {
  it("leaves out what the list above is already showing", () => {
    const shown = [task("aaaa1111", "Fix the tap", "todo")];
    render(
      <Elsewhere
        found={[...shown, task("bbbb2222", "Tap dancing", "todo")]}
        shown={shown}
        view="todo"
        waiting={false}
        onOpen={vi.fn()}
      />,
    );
    expect(rows("Across all tags")).toEqual(["bbbb2222"]);
  });

  it("splits what is left by whether it is finished", () => {
    render(
      <Elsewhere
        found={[
          task("aaaa1111", "One", "todo"),
          task("bbbb2222", "Two", "done"),
        ]}
        shown={[]}
        view="todo"
        waiting={false}
        onOpen={vi.fn()}
      />,
    );
    expect(headings()).toEqual(["Across all tags", "Done tasks"]);
    expect(rows("Across all tags")).toEqual(["aaaa1111"]);
    expect(rows("Done tasks")).toEqual(["bbbb2222"]);
  });

  /** On the done list the unfinished ones are not a matter of tags. */
  it("names the unfinished group for what it is on the done list", () => {
    render(
      <Elsewhere
        found={[task("aaaa1111", "One", "todo")]}
        shown={[]}
        view="done"
        waiting={false}
        onOpen={vi.fn()}
      />,
    );
    expect(headings()).toEqual(["Still to do"]);
  });

  it("draws no heading for a group with nothing in it", () => {
    render(
      <Elsewhere
        found={[task("bbbb2222", "Two", "done")]}
        shown={[]}
        view="todo"
        waiting={false}
        onOpen={vi.fn()}
      />,
    );
    expect(headings()).toEqual(["Done tasks"]);
  });

  it("draws nothing at all when the filter was hiding nothing", () => {
    const shown = [task("aaaa1111", "One", "todo")];
    const { container } = render(
      <Elsewhere
        found={shown}
        shown={shown}
        view="todo"
        waiting={false}
        onOpen={vi.fn()}
      />,
    );
    expect(container.textContent).toBe("");
  });

  /**
   * A tick here would finish a task the list above is not showing, which is a change nobody can
   * see the result of. The row still opens.
   */
  it("offers no tick and no pin", () => {
    render(
      <Elsewhere
        found={[task("aaaa1111", "One", "todo")]}
        shown={[]}
        view="todo"
        waiting={false}
        onOpen={vi.fn()}
      />,
    );
    for (const name of [/^Mark /, /^Pin /]) {
      const control = screen.queryByRole("button", { name });
      expect(control === null || control.hasAttribute("hidden")).toBe(true);
    }
  });

  it("holds the shape while the answer is coming", () => {
    const { container } = render(
      <Elsewhere found={[]} shown={[]} view="todo" waiting onOpen={vi.fn()} />,
    );
    expect(headings()).toEqual([]);
    expect(container.querySelector(".dummy")).not.toBeNull();
  });
});
