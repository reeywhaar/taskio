import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { postAccess } from "@app/api/actions/access";
import { patchTokensById } from "@app/api/actions/tokens";
import type { Group, Project } from "@app/api/types";
import { AgentAccess } from "@app/islands/app/AgentAccess";
import { mount } from "@app/test/harness";

vi.mock("@app/api/actions/access", () => ({
  postAccess: vi.fn(() =>
    Promise.resolve({
      url: "https://taskio.example.com/access/abc",
      token: "65a106afd2d3",
      expires_at: 1_800_000_300,
      token_expires_at: 1_800_001_800,
    }),
  ),
}));

vi.mock("@app/api/actions/tokens", () => ({
  patchTokensById: vi.fn(() => Promise.resolve({})),
}));
vi.mock("@app/api/actions/projects", () => ({
  getProjects: () => Promise.resolve({ projects: [main, side] }),
}));
vi.mock("@app/api/actions/tags", () => ({
  getTags: () =>
    Promise.resolve({
      tags: [
        { id: "tg_1", slug: "garden" },
        { id: "tg_2", slug: "home" },
      ],
    }),
}));

const main: Project = {
  id: "pj_1",
  name: "Main",
  slug: "main",
  default: true,
  created_at: 1,
};
const side: Project = {
  ...main,
  id: "pj_2",
  name: "Side",
  slug: "side",
  default: false,
};
const garden: Group = {
  id: "gr_1",
  name: "Garden",
  tags: ["garden"],
  color: "",
  created_at: 1,
};

const open = () =>
  fireEvent.click(screen.getByRole("button", { name: "Agent access" }));

describe("AgentAccess", () => {
  /** A link for the project on screen, asking the agent to keep to the group on screen. */
  it("makes a link for the project and group on screen when it opens", async () => {
    mount(
      <AgentAccess
        project={side}
        group={garden}
        trigger={(show) => <button onClick={show}>Agent access</button>}
      />,
    );
    expect(postAccess).not.toHaveBeenCalled();
    open();
    await waitFor(() =>
      expect(screen.getByLabelText("Link").textContent).toBe(
        "https://taskio.example.com/access/abc",
      ),
    );
    expect(postAccess).toHaveBeenCalledWith("side", "gr_1");
    // A link, to look at the page before handing it over.
    expect(screen.getByLabelText("Link").getAttribute("href")).toBe(
      "https://taskio.example.com/access/abc",
    );
    // Beside the link, not at the foot of the dialog.
    expect(
      screen.getByRole("button", { name: "Copy link" }).parentElement,
    ).toBe(screen.getByLabelText("Link").parentElement);
    expect(screen.getByText("Garden")).toBeDefined();
    expect(screen.getByText(/for five minutes/)).toBeDefined();
  });

  /** The default project is the one a request names by naming none. */
  it("names the default project as none, and no group as none", async () => {
    vi.mocked(postAccess).mockClear();
    mount(
      <AgentAccess
        project={main}
        group={undefined}
        trigger={(show) => <button onClick={show}>Agent access</button>}
      />,
    );
    open();
    await waitFor(() => expect(postAccess).toHaveBeenCalledWith("", ""));
    expect(await screen.findByText("The whole project.")).toBeDefined();
  });

  /** The token is already out: what it reaches is written as it is changed, with no Save. */
  it("narrows the token from the dialog, a moment after the change", async () => {
    mount(
      <AgentAccess
        project={side}
        group={undefined}
        trigger={(show) => <button onClick={show}>Agent access</button>}
      />,
    );
    open();
    fireEvent.click(await screen.findByRole("button", { name: "garden" }));
    expect(patchTokensById).not.toHaveBeenCalled();
    await waitFor(
      () =>
        expect(patchTokensById).toHaveBeenCalledWith("65a106afd2d3", {
          projects: [{ project: "side", scope: "and(garden)" }],
        }),
      { timeout: 2000 },
    );
  });
});
