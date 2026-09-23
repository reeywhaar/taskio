import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "@app/api/types";
import { ProjectDialog, slugOf } from "@app/islands/app/ProjectDialog";
import { mount } from "@app/test/harness";

const post = vi.fn();
const patch = vi.fn();
const remove = vi.fn();
vi.mock("@app/api/actions/projects", () => ({
  postProjects: (body: unknown) => post(body),
  patchProjectsById: (id: string, body: unknown) => patch(id, body),
  deleteProjectsById: (id: string) => remove(id),
}));

const garden: Project = {
  id: "pj_2",
  name: "Garden",
  slug: "garden",
  default: false,
  created_at: 1,
};
const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

beforeEach(() => {
  post.mockReset().mockResolvedValue({ ...garden, id: "pj_3" });
  patch.mockReset().mockResolvedValue(garden);
  remove.mockReset().mockResolvedValue(undefined);
});

describe("a project's slug", () => {
  it("follows the server's rule: letters and digits, anything else a hyphen", () => {
    expect(slugOf("Side Project 2")).toBe("side-project-2");
    expect(slugOf("  Café & Bar!! ")).toBe("caf-bar");
  });

  it("follows the name while a project is made, until it is typed into", () => {
    mount(
      <ProjectDialog
        editing="new"
        onClose={vi.fn()}
        onGo={vi.fn()}
        onGone={vi.fn()}
      />,
    );
    fireEvent.change(field("Name"), { target: { value: "Side Project" } });
    expect(field("Slug").value).toBe("side-project");

    fireEvent.change(field("Slug"), { target: { value: "kw" } });
    fireEvent.change(field("Name"), { target: { value: "Side Project 2" } });
    expect(field("Slug").value).toBe("kw");
  });

  /** A rename keeps every link naming the project working, so it does not send the slug. */
  it("is left out of a rename", async () => {
    mount(
      <ProjectDialog
        editing={garden}
        onClose={vi.fn()}
        onGo={vi.fn()}
        onGone={vi.fn()}
      />,
    );
    fireEvent.change(field("Name"), { target: { value: "Side Project" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("pj_2", { name: "Side Project" }),
    );
  });
});

describe("deleting a project", () => {
  it("asks for the name typed out, not a yes", async () => {
    const onGone = vi.fn();
    mount(
      <ProjectDialog
        editing={garden}
        onClose={vi.fn()}
        onGo={vi.fn()}
        onGone={onGone}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));

    const go = screen.getByRole("button", { name: "Delete project" });
    expect(go.hasAttribute("disabled")).toBe(true);
    fireEvent.change(field("Type Garden to confirm"), {
      target: { value: "garden" },
    });
    expect(go.hasAttribute("disabled")).toBe(true);

    fireEvent.change(field("Type Garden to confirm"), {
      target: { value: "Garden" },
    });
    fireEvent.click(go);
    await waitFor(() => expect(remove).toHaveBeenCalledWith("pj_2"));
    await waitFor(() => expect(onGone).toHaveBeenCalled());
  });

  it("is not offered for the default project", () => {
    mount(
      <ProjectDialog
        editing={{ ...garden, default: true }}
        onClose={vi.fn()}
        onGo={vi.fn()}
        onGone={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Delete…" })).toBeNull();
  });
});
