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

const at = (tags: string[]): Location => ({
  route: { name: "list" },
  filters: { tags, view: "todo", q: "" },
});

const lit = () =>
  screen
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-current") === "page")
    .map((b) => b.textContent);

describe("Nav", () => {
  it("lights All when nothing is filtered", async () => {
    mount(<Nav location={at([])} onGo={vi.fn()} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Errands" }));
    expect(lit()).toEqual(["All"]);
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
      filters: { tags: ["errands"], view: "todo", q: "" },
    });
  });

  it("offers a group no way to be renamed from the rail itself", async () => {
    mount(<Nav location={at([])} onGo={vi.fn()} />);
    await waitFor(() =>
      screen.getAllByRole("button", { name: "Edit Deep work" }),
    );
    // All is not stored, so there is nothing to edit about it.
    expect(screen.queryByRole("button", { name: "Edit All" })).toBeNull();
  });
});
