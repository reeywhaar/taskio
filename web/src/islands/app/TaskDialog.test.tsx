import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@app/api/transport";
import type { TaskDetail } from "@app/api/types";
import { TaskDialog } from "@app/islands/app/TaskDialog";
import { mount, settle } from "@app/test/harness";

const done = vi.fn();
const todo = vi.fn();
const patch = vi.fn();
const remove = vi.fn();
/** The order things reached the server in, which is the point of several of these. */
let calls: string[] = [];
let task: TaskDetail;

vi.mock("@app/api/actions/tasks", () => ({
  getTasksById: () => Promise.resolve(task),
  patchTasksById: (id: string, body: unknown) => {
    calls.push("patch");
    return patch(id, body);
  },
  postTasksByIdDone: (id: string) => {
    calls.push("done");
    return done(id);
  },
  postTasksByIdTodo: (id: string) => todo(id),
  deleteTasksById: (id: string) => {
    calls.push("delete");
    return remove(id);
  },
}));
vi.mock("@app/api/actions/tags", () => ({
  getTags: () => Promise.resolve({ tags: [] }),
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
        { id: "pj_2", name: "Web", slug: "web", default: false, created_at: 2 },
      ],
    }),
}));

const detail = (status: "todo" | "done"): TaskDetail =>
  ({
    id: "8qw4tz9k",
    project: "main",
    title: "Fix the tap",
    description: "",
    tags: [],
    priority: 0,
    pinned: false,
    color: "",
    status,
    created_at: 1789343452,
    updated_at: 1789343452,
    done_at: status === "done" ? 1789343452 : null,
    deleted_at: null,
    mentions: [],
    mentioned_by: [],
  }) as TaskDetail;

beforeEach(() => {
  // Finished on the server, and handed back as a new object the way a refetch does.
  done.mockReset().mockImplementation(() => {
    task = { ...task, status: "done", done_at: 1789343500 };
    return Promise.resolve();
  });
  todo.mockReset().mockResolvedValue(undefined);
  patch.mockReset().mockResolvedValue(undefined);
  remove.mockReset().mockResolvedValue(undefined);
  calls = [];
  task = detail("todo");
});

const description = () =>
  screen.getByPlaceholderText(/Markdown\. Paste a file/) as HTMLTextAreaElement;

/** Opened, loaded, and a verdict typed into the description. */
async function withVerdict(onClose = vi.fn()) {
  mount(<TaskDialog id="8qw4tz9k" onClose={onClose} onOpen={vi.fn()} />);
  // The field, not the button: the footer is drawn while the task is still on its way.
  await screen.findByPlaceholderText(/Markdown\. Paste a file/);
  await settle();
  fireEvent.change(description(), {
    target: { value: "Verdict: not worth it" },
  });
}

/**
 * The button used to read "Finish", in the place a dialog's dismiss button lives, and it was
 * read as finishing the editing — which is the one thing it does not do.
 */
describe("the task dialog's status button", () => {
  it("says what it does, and does it", async () => {
    mount(<TaskDialog id="8qw4tz9k" onClose={vi.fn()} onOpen={vi.fn()} />);
    const button = await screen.findByRole("button", { name: "Mark done" });
    fireEvent.click(button);
    await waitFor(() => expect(done).toHaveBeenCalledWith("8qw4tz9k"));
    expect(todo).not.toHaveBeenCalled();
  });

  it("says the other thing on a task that is already done", async () => {
    task = detail("done");
    mount(<TaskDialog id="8qw4tz9k" onClose={vi.fn()} onOpen={vi.fn()} />);
    const button = await screen.findByRole("button", { name: "Mark as todo" });
    fireEvent.click(button);
    await waitFor(() => expect(todo).toHaveBeenCalledWith("8qw4tz9k"));
  });

  /** It changes the status and nothing else: nothing typed, nothing written, still open. */
  it("writes nothing it was not given, and does not close the dialog", async () => {
    const onClose = vi.fn();
    mount(<TaskDialog id="8qw4tz9k" onClose={onClose} onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark done" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(patch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * A verdict is often the last thing written on a task, and the next press is Mark done or
 * Delete. Both used to leave it in the fields — and Mark done then refetched the task and
 * seeded the fields over it, so it was gone before Save could have been pressed at all.
 */
describe("a verdict written and then acted on", () => {
  it("is saved before the task is marked done, and stays on screen", async () => {
    await withVerdict();
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));

    await screen.findByRole("button", { name: "Mark as todo" });
    expect(calls).toEqual(["patch", "done"]);
    expect(patch.mock.calls[0]![1]).toMatchObject({
      description: "Verdict: not worth it",
    });
    expect(description().value).toBe("Verdict: not worth it");
  });

  it("is saved before the task is deleted", async () => {
    const onClose = vi.fn();
    await withVerdict(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls).toEqual(["patch", "delete"]);
    expect(patch.mock.calls[0]![1]).toMatchObject({
      description: "Verdict: not worth it",
    });
  });

  it("is not written again when nothing was typed", async () => {
    mount(<TaskDialog id="8qw4tz9k" onClose={vi.fn()} onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(remove).toHaveBeenCalled());
    expect(calls).toEqual(["delete"]);
  });

  /** Refused, it stops there and says why, rather than losing the words a second way. */
  it("stops the delete when the save is refused", async () => {
    patch.mockRejectedValue(
      new ApiError(400, "invalid", "A task needs a title."),
    );
    await withVerdict();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await screen.findByText("A task needs a title.");
    expect(remove).not.toHaveBeenCalled();
  });
});

/** A move is a field like any other, saved with the rest — and only sent when it changed. */
describe("moving a task", () => {
  it("sends the project it was moved to", async () => {
    const onClose = vi.fn();
    mount(<TaskDialog id="8qw4tz9k" onClose={onClose} onOpen={vi.fn()} />);
    await screen.findByPlaceholderText(/Markdown\. Paste a file/);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Main" }));
    fireEvent.click(await screen.findByRole("button", { name: "Web" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patch.mock.calls[0]![1]).toMatchObject({ project: "web" });
  });

  it("does not so much as ask to move a task saved where it is", async () => {
    await withVerdict();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![1]).not.toHaveProperty("project");
  });
});
