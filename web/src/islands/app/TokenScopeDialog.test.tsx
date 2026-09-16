import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@app/api/transport";
import type { Token } from "@app/api/types";
import { TokenScopeDialog } from "@app/islands/app/TokenScopeDialog";
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

const token = (scope: string): Token =>
  ({ id: "abc123", label: "claude", scope }) as Token;

const save = () => screen.getByRole("button", { name: "Save" });

describe("TokenScopeDialog", () => {
  beforeEach(() => {
    patchTokensById.mockReset().mockResolvedValue(token("work"));
  });

  it("opens with the scope the token already has lit", async () => {
    mount(
      <TokenScopeDialog token={token("and(home,work)")} onClose={vi.fn()} />,
    );
    await waitFor(() => screen.getByRole("button", { name: "home" }));
    for (const slug of ["home", "work"]) {
      expect(
        screen.getByRole("button", { name: slug }).getAttribute("aria-pressed"),
      ).toBe("true");
    }
  });

  it("sends the lit pills as the scope grammar", async () => {
    mount(<TokenScopeDialog token={token("")} onClose={vi.fn()} />);
    await waitFor(() => screen.getByRole("button", { name: "work" }));
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "work" }));
    fireEvent.click(save());

    await waitFor(() =>
      expect(patchTokensById).toHaveBeenCalledWith("abc123", {
        scope: "and(work)",
      }),
    );
  });

  /** Nothing lit is not "no change": it is the token reaching the whole account. */
  it("sends an empty scope when every pill is put out", async () => {
    mount(<TokenScopeDialog token={token("and(work)")} onClose={vi.fn()} />);
    await waitFor(() => screen.getByRole("button", { name: "work" }));
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "work" }));
    fireEvent.click(save());

    await waitFor(() =>
      expect(patchTokensById).toHaveBeenCalledWith("abc123", { scope: "" }),
    );
  });

  it("closes saying it saved", async () => {
    const onClose = vi.fn();
    mount(<TokenScopeDialog token={token("")} onClose={onClose} />);
    fireEvent.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  });

  it("stays open and shows the refusal", async () => {
    const onClose = vi.fn();
    patchTokensById.mockRejectedValue(
      new ApiError(400, "invalid", "A scope is a flat and() of tags."),
    );
    mount(<TokenScopeDialog token={token("")} onClose={onClose} />);
    fireEvent.click(save());

    await waitFor(() =>
      expect(
        screen.getByText("A scope is a flat and() of tags."),
      ).toBeDefined(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  // Reopened on another token, it must not still be showing the first one's scope.
  it("reseeds when a different token is opened", async () => {
    const { rerender } = mount(
      <TokenScopeDialog token={token("and(work)")} onClose={vi.fn()} />,
    );
    await waitFor(() => screen.getByRole("button", { name: "work" }));
    expect(
      screen.getByRole("button", { name: "work" }).getAttribute("aria-pressed"),
    ).toBe("true");

    rerender(<TokenScopeDialog token={null} onClose={vi.fn()} />);
    rerender(<TokenScopeDialog token={token("and(home)")} onClose={vi.fn()} />);

    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "work" })
          .getAttribute("aria-pressed"),
      ).toBe("false"),
    );
  });
});
