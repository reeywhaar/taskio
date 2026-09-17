import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskDetail } from "@app/api/types";
import { TaskDialog } from "@app/islands/app/TaskDialog";
import { mount } from "@app/test/harness";

const done = vi.fn();
const todo = vi.fn();
const patch = vi.fn();
let task: TaskDetail;

vi.mock("@app/api/actions/tasks", () => ({
  getTasksById: () => Promise.resolve(task),
  patchTasksById: (id: string, body: unknown) => patch(id, body),
  postTasksByIdDone: (id: string) => done(id),
  postTasksByIdTodo: (id: string) => todo(id),
  deleteTasksById: () => Promise.resolve(),
}));
vi.mock("@app/api/actions/tags", () => ({
  getTags: () => Promise.resolve({ tags: [] }),
}));

const detail = (status: "todo" | "done"): TaskDetail =>
  ({
    id: "8qw4tz9k",
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
    mentions: [],
    mentioned_by: [],
  }) as TaskDetail;

beforeEach(() => {
  done.mockReset().mockResolvedValue(undefined);
  todo.mockReset().mockResolvedValue(undefined);
  patch.mockReset().mockResolvedValue(undefined);
  task = detail("todo");
});

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

  /** Save is the only thing in this dialog that writes what is in the fields. */
  it("is not Save, and does not close the dialog", async () => {
    const onClose = vi.fn();
    mount(<TaskDialog id="8qw4tz9k" onClose={onClose} onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark done" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(patch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
