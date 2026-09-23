import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NewTaskDialog } from "@app/islands/app/NewTaskDialog";
import { mount } from "@app/test/harness";

const postTasks = vi.fn();
vi.mock("@app/api/actions/tasks", () => ({
  postTasks: (project: string, body: unknown) => postTasks(project, body),
}));
vi.mock("@app/api/actions/tags", () => ({
  getTags: () => Promise.resolve({ tags: [] }),
}));

beforeEach(() => {
  postTasks.mockReset().mockResolvedValue({ id: "8qw4tz9k" });
});

describe("NewTaskDialog", () => {
  /**
   * A search that matched nothing is usually a task somebody has written into the wrong box, so
   * the words come with them rather than being typed twice.
   */
  it("opens with the title it was handed, and the lit tags", () => {
    mount(
      <NewTaskDialog
        project=""
        open
        tags={["home"]}
        title="Renew the passport"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Renew the passport")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "home" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  /**
   * onCreated is not onClose: the search it came from is cleared when a task was actually
   * written, so somebody who changes their mind and shuts the dialog has their words back.
   */
  it("reports a task written, and not a dialog closed", async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    mount(
      <NewTaskDialog
        project=""
        open
        tags={[]}
        title="Renew the passport"
        onClose={onClose}
        onCreated={onCreated}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(postTasks).toHaveBeenCalledWith(
      "",
      expect.objectContaining({ title: "Renew the passport" }),
    );

    onCreated.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
