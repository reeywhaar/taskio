import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectSelectDialog } from "@app/islands/app/ProjectPicker";
import { mount } from "@app/test/harness";

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

describe("ProjectSelectDialog", () => {
  /** Empty is the default project, the URL's own rule. */
  it("lights where the task is, and a press is the choice", async () => {
    const onChoose = vi.fn();
    mount(
      <ProjectSelectDialog
        open
        title="Project"
        current=""
        onChoose={onChoose}
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("button", { name: "Web" });
    expect(
      screen.getByRole("button", { name: "Main" }).getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Web" }));
    await waitFor(() =>
      expect(onChoose).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "web" }),
      ),
    );
  });
});
