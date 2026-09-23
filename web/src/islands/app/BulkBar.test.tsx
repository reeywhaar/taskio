import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BulkBar } from "@app/islands/app/BulkBar";
import type { Task } from "@app/api/types";
import { mount } from "@app/test/harness";

const postTasksBulkPinned = vi.fn();
const postTasksBulkPriority = vi.fn();
const postTasksBulkDone = vi.fn();
const postTasksBulkTodo = vi.fn();
const postTasksBulkTags = vi.fn();
const postTasksBulkProject = vi.fn();
const postTasksBulkDelete = vi.fn();
vi.mock("@app/api/actions/tasks", () => ({
  postTasksBulkPinned: (ids: string[], pinned: boolean) =>
    postTasksBulkPinned(ids, pinned),
  postTasksBulkPriority: (ids: string[], priority: number) =>
    postTasksBulkPriority(ids, priority),
  postTasksBulkDone: (ids: string[]) => postTasksBulkDone(ids),
  postTasksBulkTodo: (ids: string[]) => postTasksBulkTodo(ids),
  postTasksBulkTags: (ids: string[], add: string[], remove: string[]) =>
    postTasksBulkTags(ids, add, remove),
  postTasksBulkDelete: (ids: string[]) => postTasksBulkDelete(ids),
  postTasksBulkProject: (ids: string[], project: string) =>
    postTasksBulkProject(ids, project),
}));
vi.mock("@app/api/actions/projects", () => ({
  getProjects: () =>
    Promise.resolve({
      projects: [
        {
          id: "pj_1",
          name: "Main",
          slug: "main",
          default: true,
          created_at: 1,
        },
        {
          id: "pj_2",
          name: "Garden",
          slug: "garden",
          default: false,
          created_at: 2,
        },
      ],
    }),
}));

const ids = ["8qw4tz9k", "kr20fj8m"];
const tags = [
  { id: "a", slug: "home" },
  { id: "b", slug: "work" },
];

/** Two selected tasks, carrying whatever the test says they carry. */
const chosen = (first: string[], second: string[]) =>
  ids.map((id, i) => ({ id, tags: i === 0 ? first : second }) as Task);

const bar = (
  view: "pinned" | "todo" | "done" = "todo",
  picked: Task[] = chosen([], []),
) =>
  mount(
    <BulkBar
      ids={ids}
      chosen={picked}
      tags={tags}
      view={view}
      project=""
      onDone={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

/** What the pill is saying, which for a scattered tag is neither of the two usual answers. */
const pill = (slug: string) =>
  screen.getByRole("button", { name: slug }).getAttribute("aria-pressed");

const press = (slug: string) =>
  fireEvent.click(screen.getByRole("button", { name: slug }));

describe("BulkBar", () => {
  beforeEach(() => {
    for (const fn of [
      postTasksBulkPinned,
      postTasksBulkPriority,
      postTasksBulkDone,
      postTasksBulkTodo,
      postTasksBulkTags,
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
  /** The one control here that does nothing to the selection. */
  it("stops selecting without touching anything", () => {
    const onCancel = vi.fn();
    mount(
      <BulkBar
        ids={ids}
        chosen={chosen([], [])}
        tags={tags}
        view="todo"
        project=""
        onDone={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop selecting" }));
    expect(onCancel).toHaveBeenCalled();
  });

  /**
   * The list runs the full height of the window and its rows pass under the bar, so the room it
   * asks for at the end is what lets the last of them be scrolled out from under it.
   *
   * None, once it is leaving: it slides rather than shrinks, so it measures its full height all
   * the way out, and the room stayed behind as a band of empty ground under the last row until
   * the unmount took it in one step.
   */
  it("asks for room at the end of the list, and for none once it is leaving", () => {
    const onHeight = vi.fn();
    const props = {
      ids,
      chosen: chosen([], []),
      tags,
      view: "todo" as const,
      project: "",
      onDone: vi.fn(),
      onCancel: vi.fn(),
      onHeight,
    };
    const { rerender } = mount(<BulkBar {...props} />);
    expect(onHeight).toHaveBeenCalled();
    onHeight.mockClear();

    rerender(<BulkBar {...props} leaving />);
    expect(onHeight).toHaveBeenLastCalledWith(0);
  });

  /**
   * Eleven ids picked out of ninety rows is a filter nothing can express, and reading them off
   * the screen one at a time is how that gets done otherwise.
   */
  it("copies the selection's ids, comma separated", async () => {
    const written: string[] = [];
    Object.assign(navigator, {
      clipboard: {
        writeText: (text: string) => {
          written.push(text);
          return Promise.resolve();
        },
      },
    });

    bar();
    fireEvent.click(screen.getByRole("button", { name: "Copy ids" }));
    await waitFor(() => expect(written).toEqual(["8qw4tz9k, kr20fj8m"]));
    // And says so, because a copy that reports nothing is a copy nobody trusts.
    await screen.findByRole("button", { name: "Copied" });
  });
});

/**
 * Tagging a selection is a question with three answers, and typing a slug into a box could only
 * give two of them. The third — that some of the selection carries it and the rest does not — is
 * the one a person is usually looking at.
 *
 * Nothing leaves until Save. A press is a note about what to do, so a mis-press is pressed back
 * rather than undone against the server, and the scattering it would have flattened is still
 * there to return to.
 */
describe("tagging a selection", () => {
  beforeEach(() => postTasksBulkTags.mockReset().mockResolvedValue(undefined));

  const open = (picked: Task[]) => {
    const rendered = bar("todo", picked);
    fireEvent.click(screen.getByRole("button", { name: "Tag" }));
    return rendered;
  };

  it("says which of the three a tag is", () => {
    const { unmount } = open(chosen(["home"], ["home", "work"]));
    expect(pill("home")).toBe("true");
    expect(pill("work")).toBe("mixed");
    unmount();

    // A tag the account has and nobody in the selection carries.
    open(chosen([], []));
    expect(pill("home")).toBe("false");
  });

  it("sends nothing until Save", async () => {
    open(chosen(["home"], []));
    press("work");
    expect(pill("work")).toBe("true");
    expect(postTasksBulkTags).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(postTasksBulkTags).toHaveBeenCalledWith(ids, ["work"], []),
    );
  });

  /** One request, however many pills were pressed. */
  it("saves everything asked for in one go", async () => {
    open(chosen(["home"], ["home"]));
    press("home");
    press("work");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(postTasksBulkTags).toHaveBeenCalledWith(ids, ["work"], ["home"]),
    );
    expect(postTasksBulkTags).toHaveBeenCalledTimes(1);
  });

  /**
   * The point of the third state: a scattered tag nobody pressed is named in neither list, so
   * the save leaves each task's own answer alone.
   */
  it("leaves a scattered tag scattered", async () => {
    open(chosen(["work"], []));
    press("home");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(postTasksBulkTags).toHaveBeenCalledWith(ids, ["home"], []),
    );
  });

  it("gives a scattered tag three stops and the rest two", () => {
    open(chosen(["work"], []));

    // Scattered: on, off, and back to the way it was.
    expect(pill("work")).toBe("mixed");
    press("work");
    expect(pill("work")).toBe("true");
    press("work");
    expect(pill("work")).toBe("false");
    press("work");
    expect(pill("work")).toBe("mixed");

    // Nobody has home, so it is the toggle it has always been.
    expect(pill("home")).toBe("false");
    press("home");
    expect(pill("home")).toBe("true");
    press("home");
    expect(pill("home")).toBe("false");
  });

  it("cannot be saved with nothing asked for, and Cancel asks for nothing", async () => {
    open(chosen(["home"], []));
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(true);

    press("work");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(postTasksBulkTags).not.toHaveBeenCalled();

    // And the presses go with it: opening again reads the selection afresh.
    fireEvent.click(screen.getByRole("button", { name: "Tag" }));
    expect(pill("work")).toBe("false");
  });
});

describe("moving a selection", () => {
  beforeEach(() =>
    postTasksBulkProject.mockReset().mockResolvedValue(undefined),
  );

  it("moves it to the project pressed, and nowhere for the one it is in", async () => {
    bar();
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    fireEvent.click(await screen.findByRole("button", { name: "Main" }));
    expect(postTasksBulkProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    fireEvent.click(await screen.findByRole("button", { name: "Garden" }));
    await waitFor(() =>
      expect(postTasksBulkProject).toHaveBeenCalledWith(ids, "garden"),
    );
  });
});

/** Delete asks first, in the application's own dialog, and only a yes deletes. */
describe("deleting a selection", () => {
  beforeEach(() =>
    postTasksBulkDelete.mockReset().mockResolvedValue(undefined),
  );

  it("asks, and deletes on a yes", async () => {
    bar();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const asked = screen.getByRole("dialog");
    expect(within(asked).getByText("Delete 2 tasks?")).toBeDefined();
    fireEvent.click(within(asked).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(postTasksBulkDelete).toHaveBeenCalledWith(ids));
  });

  it("deletes nothing on a no", async () => {
    bar();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(postTasksBulkDelete).not.toHaveBeenCalled();
  });
});

describe("selecting everything", () => {
  it("offers all, and none once all is what is selected", () => {
    const onSelectAll = vi.fn();
    const { rerender } = mount(
      <BulkBar
        ids={ids}
        chosen={chosen([], [])}
        tags={tags}
        view="todo"
        project=""
        onDone={vi.fn()}
        onCancel={vi.fn()}
        onSelectAll={onSelectAll}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(onSelectAll).toHaveBeenCalled();

    rerender(
      <BulkBar
        ids={ids}
        chosen={chosen([], [])}
        tags={tags}
        view="todo"
        project=""
        onDone={vi.fn()}
        onCancel={vi.fn()}
        onSelectAll={onSelectAll}
        everything
      />,
    );
    expect(screen.getByRole("button", { name: "Select none" })).toBeDefined();
  });
});
