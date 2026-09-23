import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Group, Project } from "@app/api/types";
import { GroupDialog } from "@app/islands/app/GroupDialog";
import { mount } from "@app/test/harness";

const patch = vi.fn();
vi.mock("@app/api/actions/groups", () => ({
  postGroups: vi.fn(),
  patchGroupsById: (id: string, body: unknown) => patch(id, body),
  deleteGroupsById: vi.fn(),
}));
vi.mock("@app/api/actions/tags", () => ({
  getTags: () => Promise.resolve({ tags: [{ id: "a", slug: "home" }] }),
}));

const main: Project = {
  id: "pj_1",
  name: "Main",
  slug: "main",
  default: true,
  created_at: 1,
};
const garden: Project = {
  id: "pj_2",
  name: "Garden",
  slug: "garden",
  default: false,
  created_at: 2,
};
let projects: Project[] = [];
vi.mock("@app/api/actions/projects", () => ({
  getProjects: () => Promise.resolve({ projects }),
}));

const group: Group = {
  id: "gr_1",
  name: "Plumbing",
  tags: ["home"],
  color: "#2563eb",
  created_at: 1,
};

beforeEach(() => {
  projects = [main, garden];
  patch
    .mockReset()
    .mockImplementation((_id: string, body: object) =>
      Promise.resolve({ ...group, ...body }),
    );
});

describe("moving a group", () => {
  /** Saved as it stands on the way, as Mark done saves a task. */
  it("moves it, as it stands, to the project pressed", async () => {
    const onMoved = vi.fn();
    const onClose = vi.fn();
    mount(
      <GroupDialog
        editing={group}
        project=""
        onClose={onClose}
        onMoved={onMoved}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("What is this set called?"), {
      target: { value: "Pipes" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Move…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Garden" }));

    await waitFor(() =>
      expect(onMoved).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Pipes" }),
        garden,
      ),
    );
    expect(patch).toHaveBeenCalledWith("gr_1", {
      name: "Pipes",
      tags: ["home"],
      color: "#2563eb",
      project: "garden",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("does nothing for the project it is in", async () => {
    mount(<GroupDialog editing={group} project="" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Move…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Main" }));
    expect(patch).not.toHaveBeenCalled();
  });

  it("is not offered with nowhere to go", async () => {
    projects = [main];
    mount(<GroupDialog editing={group} project="" onClose={vi.fn()} />);
    // The projects answer on a timer, not at once.
    await act(() => new Promise((r) => setTimeout(r, 10)));
    expect(screen.queryByRole("button", { name: "Move…" })).toBeNull();
  });

  it("is not offered for a group not yet written", async () => {
    mount(<GroupDialog editing="new" project="" onClose={vi.fn()} />);
    await act(() => new Promise((r) => setTimeout(r, 10)));
    expect(screen.queryByRole("button", { name: "Move…" })).toBeNull();
  });
});
