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

  // Unscoped is the default, and the hint has to say so rather than leave it to be guessed.
  it("mints without a scope when no pill is lit", async () => {
    mount(<TokenDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("What is it for"), {
      target: { value: "claude" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mint" }));

    await waitFor(() =>
      expect(postTokens).toHaveBeenCalledWith({
        label: "claude",
        scope: undefined,
      }),
    );
  });

  /** A scope is an unnested and() of tags, written by pressing pills rather than typing it. */
  it("writes the lit pills as the scope grammar", async () => {
    mount(<TokenDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("What is it for"), {
      target: { value: "claude" },
    });
    await waitFor(() => screen.getByRole("button", { name: "home" }));
    fireEvent.click(screen.getByRole("button", { name: "home" }));
    fireEvent.click(screen.getByRole("button", { name: "work" }));
    fireEvent.click(screen.getByRole("button", { name: "Mint" }));

    await waitFor(() =>
      expect(postTokens).toHaveBeenCalledWith({
        label: "claude",
        scope: "and(home,work)",
      }),
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
});
