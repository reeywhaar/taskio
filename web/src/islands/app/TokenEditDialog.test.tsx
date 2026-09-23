import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@app/api/transport";
import type { Token } from "@app/api/types";
import { TokenEditDialog } from "@app/islands/app/TokenEditDialog";
import { mount, settle } from "@app/test/harness";

const patchTokensById = vi.fn();
vi.mock("@app/api/actions/tokens", () => ({
  patchTokensById: (id: string, body: unknown) => patchTokensById(id, body),
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

/** A token reaching the default project alone, confined by scope — every token before rows. */
const token = (scope: string, extra: Partial<Token> = {}): Token =>
  ({
    id: "abc123",
    label: "claude",
    scope,
    projects: [{ project: "main", name: "Main", scope }],
    idle_seconds: 0,
    expires_at: null,
    ...extra,
  }) as Token;

const row = (scope: string) => ({ projects: [{ project: "main", scope }] });

const save = () => screen.getByRole("button", { name: "Save" });
const field = (name: string) =>
  screen.getByLabelText(name) as HTMLInputElement | HTMLSelectElement;

/** Opened, with the tags arrived and the seeding finished. */
async function open(t: Token, onClose = vi.fn()) {
  const view = mount(<TokenEditDialog token={t} onClose={onClose} />);
  await waitFor(() => screen.getByRole("button", { name: "work" }));
  await settle();
  return view;
}

describe("TokenEditDialog", () => {
  beforeEach(() => {
    patchTokensById.mockReset().mockResolvedValue(token("work"));
  });

  it("opens with the scope the token already has lit", async () => {
    await open(token("and(home,work)"));
    for (const slug of ["home", "work"]) {
      expect(
        screen.getByRole("button", { name: slug }).getAttribute("aria-pressed"),
      ).toBe("true");
    }
  });

  it("sends the lit pills as the scope grammar, and nothing else", async () => {
    await open(token(""));
    fireEvent.click(screen.getByRole("button", { name: "work" }));
    fireEvent.click(save());

    await waitFor(() =>
      expect(patchTokensById).toHaveBeenCalledWith("abc123", row("and(work)")),
    );
  });

  /** Nothing lit is not "no change": it is the token reaching the whole account. */
  it("sends an empty scope when every pill is put out", async () => {
    await open(token("and(work)"));
    fireEvent.click(screen.getByRole("button", { name: "work" }));
    fireEvent.click(save());

    await waitFor(() =>
      expect(patchTokensById).toHaveBeenCalledWith("abc123", row("")),
    );
  });

  it("renames it", async () => {
    await open(token(""));
    fireEvent.change(field("What is it for"), {
      target: { value: "  the laptop " },
    });
    fireEvent.click(save());

    await waitFor(() =>
      expect(patchTokensById).toHaveBeenCalledWith("abc123", {
        label: "the laptop",
      }),
    );
  });

  it("gives it an end date, counted from the save", async () => {
    await open(token(""));
    fireEvent.change(field("Stop working"), { target: { value: "604800" } });
    const before = Math.floor(Date.now() / 1000);
    fireEvent.click(save());

    await waitFor(() => expect(patchTokensById).toHaveBeenCalled());
    const sent = patchTokensById.mock.calls[0]![1].expires_at as number;
    expect(sent - before).toBeGreaterThanOrEqual(604800);
    expect(sent - before).toBeLessThan(604800 + 5);
  });

  /**
   * An end date already set is offered as itself and left alone by a save that is about
   * something else — or every rename would push it a week further out.
   */
  it("keeps an end date nobody touched, and takes it away on never", async () => {
    const at = Math.floor(Date.now() / 1000) + 3 * 86400;
    await open(token("", { expires_at: at }));
    expect(field("Stop working").value).toBe("keep");

    fireEvent.change(field("What is it for"), { target: { value: "other" } });
    fireEvent.click(save());
    await waitFor(() =>
      expect(patchTokensById).toHaveBeenCalledWith("abc123", {
        label: "other",
      }),
    );

    patchTokensById.mockClear();
    fireEvent.change(field("Stop working"), { target: { value: "0" } });
    fireEvent.click(save());
    await waitFor(() =>
      expect(patchTokensById).toHaveBeenCalledWith("abc123", {
        label: "other",
        expires_at: 0,
      }),
    );
  });

  /** A token minted from the command line can have any length, and it is still its own. */
  it("offers an idle length no preset matches, and keeps it", async () => {
    await open(token("", { idle_seconds: 2 * 86400 }));
    const idle = field("Retire it if unused for") as HTMLSelectElement;
    expect(idle.value).toBe(String(2 * 86400));
    expect(idle.selectedOptions[0]!.textContent).toBe("2 days");
    expect(save().hasAttribute("disabled")).toBe(true);
  });

  it("cannot be saved unchanged", async () => {
    await open(token("and(work)"));
    expect(save().hasAttribute("disabled")).toBe(true);
  });

  it("closes saying it saved", async () => {
    const onClose = vi.fn();
    await open(token(""), onClose);
    fireEvent.change(field("What is it for"), { target: { value: "x" } });
    fireEvent.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  });

  it("stays open and shows the refusal", async () => {
    const onClose = vi.fn();
    patchTokensById.mockRejectedValue(
      new ApiError(
        400,
        "invalid",
        "It has already gone unused for longer than that.",
      ),
    );
    await open(token(""), onClose);
    fireEvent.change(field("Retire it if unused for"), {
      target: { value: "86400" },
    });
    fireEvent.click(save());

    await waitFor(() =>
      expect(
        screen.getByText("It has already gone unused for longer than that."),
      ).toBeDefined(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  // Reopened on another token, it must not still be showing the first one's scope.
  it("reseeds when a different token is opened", async () => {
    const { rerender } = await open(token("and(work)"));
    expect(
      screen.getByRole("button", { name: "work" }).getAttribute("aria-pressed"),
    ).toBe("true");

    rerender(<TokenEditDialog token={null} onClose={vi.fn()} />);
    rerender(
      <TokenEditDialog
        token={token("and(home)", { label: "second" })}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "work" })
          .getAttribute("aria-pressed"),
      ).toBe("false"),
    );
    expect(field("What is it for").value).toBe("second");
  });

  it("reaches any of several pills", async () => {
    await open(token(""));
    fireEvent.click(screen.getByRole("button", { name: "home" }));
    fireEvent.click(screen.getByRole("button", { name: "work" }));
    fireEvent.click(save());
    await waitFor(() =>
      expect(patchTokensById).toHaveBeenCalledWith(
        "abc123",
        row("or(home,work)"),
      ),
    );
  });

  /**
   * A token minted before any was the default needs every one of its tags, and nothing about
   * its pills says so. The row says it, and changing a pill keeps it that way — only the switch
   * widens it, so no other edit can do that on the quiet.
   */
  it("keeps an old all-of row all-of until it is switched", async () => {
    await open(token("and(home,work)"));
    expect(screen.getByText(/Only tasks carrying all of/)).toBeDefined();

    fireEvent.change(field("What is it for"), { target: { value: "x" } });
    fireEvent.click(save());
    await waitFor(() =>
      expect(patchTokensById).toHaveBeenCalledWith("abc123", { label: "x" }),
    );

    patchTokensById.mockClear();
    fireEvent.click(
      screen.getByRole("button", { name: "Reach any of them instead" }),
    );
    fireEvent.click(save());
    await waitFor(() =>
      expect(patchTokensById).toHaveBeenCalledWith("abc123", {
        label: "x",
        ...row("or(home,work)"),
      }),
    );
  });

  /** A deleted project's row is said, and dropped when the projects are next written. */
  it("drops a deleted project's row when the rows are saved", async () => {
    await open(
      token("", {
        projects: [
          { project: "main", name: "Main", scope: "" },
          { project: "gone", name: "Gone", scope: "", deleted: true },
        ],
      }),
    );
    expect(screen.getByText(/gone was deleted/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "work" }));
    fireEvent.click(save());
    await waitFor(() =>
      expect(patchTokensById).toHaveBeenCalledWith("abc123", row("and(work)")),
    );
  });
});
