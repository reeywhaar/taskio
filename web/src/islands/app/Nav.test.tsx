import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Nav } from "@app/islands/app/Nav";
import type { Location } from "@app/islands/app/route";
import { mount } from "@app/test/harness";

vi.mock("@app/api/actions/groups", () => ({
  getGroups: () =>
    Promise.resolve({
      groups: [
        {
          id: "gr_1",
          name: "Deep work",
          tags: ["work", "proxio"],
          created_at: 1,
        },
        { id: "gr_2", name: "Errands", tags: ["errands"], created_at: 2 },
      ],
    }),
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
  putProjectsOrder: vi.fn(),
}));

const at = (tags: string[], project = ""): Location => ({
  route: { name: "list" },
  filters: { project, tags, view: "todo", q: "" },
});

const rail = () => screen.getAllByRole("navigation")[0]!;

const lit = () =>
  [...rail().querySelectorAll("button")]
    .filter((b) => b.getAttribute("aria-current") === "page")
    .map((b) => b.textContent);

describe("Nav", () => {
  /** The project row is the whole project, which is what All used to be. */
  it("lights the open project when nothing is filtered", async () => {
    mount(<Nav location={at([])} onGo={vi.fn()} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Errands" }));
    expect(lit()).toEqual(["Main"]);
  });

  it("opens a project with nothing of the last one's lit", async () => {
    const onGo = vi.fn();
    mount(<Nav location={at(["home"])} onGo={onGo} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Web" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Web" })[0]!);
    expect(onGo).toHaveBeenCalledWith({
      route: { name: "list" },
      filters: { project: "web", tags: [], view: "todo", q: "" },
    });
  });

  /** Only the open project's groups, a step in from it: a group is a view of one project. */
  it("draws the groups under the open project and no other", async () => {
    mount(<Nav location={at([], "web")} onGo={vi.fn()} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Errands" }));
    const rows = [...rail().querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    expect(rows.indexOf("Errands")).toBeGreaterThan(rows.indexOf("Web"));
    expect(rows.indexOf("Main")).toBeLessThan(rows.indexOf("Web"));
    expect(lit()).toEqual(["Web"]);
  });

  /** The tags are the state, so a group is lit by what the list is filtered by. */
  it("lights the group whose tags are the ones lit, whatever order they were lit in", async () => {
    mount(<Nav location={at(["proxio", "work"])} onGo={vi.fn()} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Deep work" }));
    expect(lit()).toEqual(["Deep work"]);
  });

  it("lights nothing when the filter is no group", async () => {
    mount(<Nav location={at(["work"])} onGo={vi.fn()} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Deep work" }));
    expect(lit()).toEqual([]);
  });

  it("pressing a group asks for its tags and nothing else", async () => {
    const onGo = vi.fn();
    mount(<Nav location={at(["home"])} onGo={onGo} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Errands" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Errands" })[0]!);
    expect(onGo).toHaveBeenCalledWith({
      route: { name: "list" },
      filters: { project: "", tags: ["errands"], view: "todo", q: "" },
    });
  });

  /**
   * The lit ground is the row's, not the name's. On the name it stopped short of the pencil,
   * which then sat outside the thing it edits with a strip of rail between them.
   */
  it("lights the whole row, pencil included", async () => {
    mount(<Nav location={at(["work", "proxio"])} onGo={vi.fn()} />);
    await screen.findAllByRole("button", { name: "Deep work" });
    // The rail's own, not the sheet's copy of it.
    const name = [...rail().querySelectorAll("button")].find(
      (b) => b.textContent === "Deep work",
    )!;
    const row = name.parentElement!;

    expect(row.className).toContain("bg-shade");
    expect(name.className).not.toContain("bg-shade");
    expect(
      row.querySelector('button[aria-label="Edit Deep work"]'),
    ).not.toBeNull();
  });

  it("gives projects a pencil, and has no All", async () => {
    mount(<Nav location={at([])} onGo={vi.fn()} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Edit Main" }));
    expect(screen.getAllByRole("button", { name: "Edit Web" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "All" })).toBeNull();
  });
});
