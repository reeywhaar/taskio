import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TokenDialog } from "@app/islands/app/TokenDialog";
import { mount } from "@app/test/harness";

const postTokens = vi.fn();
vi.mock("@app/api/actions/tokens", () => ({
  postTokens: (body: unknown) => postTokens(body),
}));
vi.mock("@app/api/actions/tags", () => ({
  getTags: () =>
    Promise.resolve({
      tags: [
        { id: "a", slug: "home" },
        { id: "b", slug: "work" },
      ],
    }),
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
}));

/** The project is chosen first, and then written on the row rather than offered as a field. */
const add = async (name: string) => {
  fireEvent.click(
    await screen.findByRole("button", { name: "+ Add project…" }),
  );
  fireEvent.click(await screen.findByRole("button", { name }));
};

describe("TokenDialog", () => {
  beforeEach(() => {
    postTokens.mockReset();
    postTokens.mockResolvedValue({ token: { id: "t1" }, secret: "tkc_sekrit" });
  });

  it("will not mint one with nothing to say what it is for", () => {
    mount(<TokenDialog open onClose={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Mint" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  /** A new token operates on every project until it is given rows. */
  it("mints one for every project when none is added", async () => {
    mount(<TokenDialog open onClose={vi.fn()} />);
    expect(
      screen.getByText("Every project, and everything in each."),
    ).toBeDefined();
    fireEvent.change(screen.getByLabelText("What is it for"), {
      target: { value: "claude" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mint" }));

    await waitFor(() =>
      expect(postTokens).toHaveBeenCalledWith({
        label: "claude",
        projects: [],
        idle_seconds: 0,
      }),
    );
  });

  /**
   * Several pills mean any of them: garden and reading is a token for both, not only for the
   * tasks that happen to be in both. Written by pressing pills, not typing grammar.
   */
  it("writes the lit pills as an or() scope", async () => {
    mount(<TokenDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("What is it for"), {
      target: { value: "claude" },
    });
    await add("Main");
    // Its name, as text: there is no picker left on the row to change it with.
    expect(screen.getByText("Main").tagName).toBe("SPAN");

    fireEvent.click(await screen.findByRole("button", { name: "home" }));
    fireEvent.click(screen.getByRole("button", { name: "work" }));
    fireEvent.click(screen.getByRole("button", { name: "Mint" }));

    await waitFor(() =>
      expect(postTokens).toHaveBeenCalledWith({
        label: "claude",
        projects: [{ project: "main", scope: "or(home,work)" }],
        idle_seconds: 0,
      }),
    );
  });

  it("mints one reaching two projects, and has nothing left to add", async () => {
    mount(<TokenDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("What is it for"), {
      target: { value: "claude" },
    });
    await add("Main");
    await add("Garden");
    // Every project is on a row now, so there is nothing left to add.
    expect(screen.queryByRole("button", { name: "+ Add project…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mint" }));

    await waitFor(() =>
      expect(postTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          projects: [
            { project: "main", scope: "" },
            { project: "garden", scope: "" },
          ],
        }),
      ),
    );
  });

  /** The last row can go too: no rows is every project, not a token that reaches nothing. */
  it("takes a row away, the last one included", async () => {
    mount(<TokenDialog open onClose={vi.fn()} />);
    await add("Garden");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove this project" }),
    );
    expect(
      screen.getByText("Every project, and everything in each."),
    ).toBeDefined();
  });

  // A credential nobody has used for a month is one still open on a machine nobody remembers.
  it("mints one that retires itself if it is left alone", async () => {
    mount(<TokenDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("What is it for"), {
      target: { value: "claude" },
    });
    fireEvent.change(screen.getByLabelText("Retire it if unused for"), {
      target: { value: "604800" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mint" }));

    await waitFor(() =>
      expect(postTokens).toHaveBeenCalledWith(
        expect.objectContaining({ idle_seconds: 604800 }),
      ),
    );
  });

  /**
   * The secret is in that one response and nowhere else, ever. Closing on success and putting
   * it behind would be revealing it somewhere nobody was looking.
   */
  it("stays open to show the secret, and closes only when told", async () => {
    const onClose = vi.fn();
    mount(<TokenDialog open onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("What is it for"), {
      target: { value: "claude" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mint" }));

    await waitFor(() => expect(screen.getByText("tkc_sekrit")).toBeDefined());
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "I have copied it" }));
    expect(onClose).toHaveBeenCalled();
  });

  // Reopened, it is a form again: a secret still on screen is one from a token minted before.
  it("does not show the last secret when it opens again", async () => {
    const { rerender } = mount(<TokenDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("What is it for"), {
      target: { value: "claude" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mint" }));
    await waitFor(() => screen.getByText("tkc_sekrit"));

    rerender(<TokenDialog open={false} onClose={vi.fn()} />);
    rerender(<TokenDialog open onClose={vi.fn()} />);

    expect(screen.queryByText("tkc_sekrit")).toBeNull();
  });

  /** Copied with a press, and said so: dragging across it is where a token loses a character. */
  it("copies the new secret, and says so", async () => {
    const written: string[] = [];
    Object.assign(navigator, {
      clipboard: {
        writeText: (text: string) => {
          written.push(text);
          return Promise.resolve();
        },
      },
    });
    mount(<TokenDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("What is it for"), {
      target: { value: "claude" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mint" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy" }));

    await waitFor(() => expect(written).toEqual(["tkc_sekrit"]));
    await screen.findByRole("button", { name: "Copied" });
  });
});
