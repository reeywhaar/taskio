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
  patchGroupsById: (id: string, body: object) =>
    Promise.resolve({ id, created_at: 2, ...body }),
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
        {
          id: "pj_2",
          name: "Garden",
          slug: "garden",
          default: false,
          created_at: 2,
        },
      ],
    }),
  putProjectsOrder: vi.fn(),
}));

const at = (tags: string[], project = ""): Location => ({
  route: { name: "list" },
  filters: { project, tags, view: "todo", q: "" },
});

const rail = () => screen.getAllByRole("navigation")[0]!;

/** The phone's bar, found by everything it says at once. */
const header = (text: string) =>
  screen.findByText(
    (_, el) => el?.tagName === "SPAN" && el.textContent === text,
  );

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
    await waitFor(() => screen.getAllByRole("button", { name: "Garden" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Garden" })[0]!);
    expect(onGo).toHaveBeenCalledWith({
      route: { name: "list" },
      filters: { project: "garden", tags: [], view: "todo", q: "" },
    });
  });

  /** Only the open project's groups, a step in from it: a group is a view of one project. */
  it("draws the groups under the open project and no other", async () => {
    mount(<Nav location={at([], "garden")} onGo={vi.fn()} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Errands" }));
    const rows = [...rail().querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    expect(rows.indexOf("Errands")).toBeGreaterThan(rows.indexOf("Garden"));
    expect(rows.indexOf("Main")).toBeLessThan(rows.indexOf("Garden"));
    expect(lit()).toEqual(["Garden"]);
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

  /** What it was showing went with it, so the list goes too; one not on screen moves alone. */
  it("follows a group moved while it is the one on screen", async () => {
    const move = async (tags: string[]) => {
      const onGo = vi.fn();
      const view = mount(<Nav location={at(tags)} onGo={onGo} />);
      fireEvent.click(
        (await screen.findAllByRole("button", { name: "Edit Errands" }))[0]!,
      );
      fireEvent.click(await screen.findByRole("button", { name: "Move…" }));
      // The picker's pill, not the rail's row of the same name.
      const pill = screen
        .getAllByRole("button", { name: "Garden" })
        .find((b) => b.hasAttribute("aria-pressed"))!;
      fireEvent.click(pill);
      // Moved, and the dialog shut behind it.
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Move…" })).toBeNull(),
      );
      view.unmount();
      return onGo;
    };

    expect(await move(["errands"])).toHaveBeenCalledWith({
      route: { name: "list" },
      filters: { project: "garden", tags: ["errands"], view: "todo", q: "" },
    });
    expect(await move([])).not.toHaveBeenCalled();
  });

  /** On a phone the rail is folded away, so the bar above the list says where it is. */
  it("names the project, and the group when one is lit, in the phone's bar", async () => {
    const first = mount(<Nav location={at(["errands"])} onGo={vi.fn()} />);
    expect(await header("Main • Errands")).toBeDefined();
    first.unmount();

    mount(<Nav location={at([], "garden")} onGo={vi.fn()} />);
    expect(await header("Garden")).toBeDefined();
  });

  it("gives projects a pencil, and has no All", async () => {
    mount(<Nav location={at([])} onGo={vi.fn()} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Edit Main" }));
    expect(
      screen.getAllByRole("button", { name: "Edit Garden" }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "All" })).toBeNull();
  });
});
