import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Login } from "@app/islands/login/Login";

const getAuthInstance = vi.fn();
const postAuthRecoveries = vi.fn();
const getAuthRecoveriesByToken = vi.fn();
const postAuthRecoveriesByTokenAccept = vi.fn();

vi.mock("@app/api/actions/auth", () => ({
  getAuthInstance: () => getAuthInstance(),
  postAuthRecoveries: (body: { email: string }) => postAuthRecoveries(body),
  getAuthRecoveriesByToken: (token: string) => getAuthRecoveriesByToken(token),
  postAuthRecoveriesByTokenAccept: (token: string, body: unknown) =>
    postAuthRecoveriesByTokenAccept(token, body),
  postAuthLogin: vi.fn(),
  getAuthInvitesByToken: vi.fn(),
  postAuthInvitesByTokenAccept: vi.fn(),
}));

const fresh = {
  username: "misha",
  expires_at: 0,
  usable: true,
  used: false,
  voided: false,
  expired: false,
};

beforeEach(() => {
  getAuthInstance.mockResolvedValue({ recovery: true });
  postAuthRecoveries.mockResolvedValue(undefined);
  getAuthRecoveriesByToken.mockResolvedValue(fresh);
  postAuthRecoveriesByTokenAccept.mockResolvedValue(undefined);
});

afterEach(() => {
  window.history.pushState({}, "", "/login");
  vi.clearAllMocks();
});

describe("the login page", () => {
  /**
   * An instance with no relay offering to mail a link is a form that says "check your inbox"
   * and is lying. Where it cannot, it offers nothing and somebody locked out asks whoever runs
   * the instance — which is the only path there was.
   */
  it("offers a way out only where mail can be sent", async () => {
    getAuthInstance.mockResolvedValue({ recovery: false });
    const { unmount } = render(<Login />);
    await waitFor(() => expect(getAuthInstance).toHaveBeenCalled());
    expect(screen.queryByText(/forgotten my password/i)).toBeNull();
    unmount();

    getAuthInstance.mockResolvedValue({ recovery: true });
    render(<Login />);
    await screen.findByText(/forgotten my password/i);
  });

  // The same sentence either way: anything else is a way to ask this instance who has an
  // account here and what address they use.
  it("says the same thing whatever address was typed", async () => {
    render(<Login />);
    fireEvent.click(await screen.findByText(/forgotten my password/i));

    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "nobody@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send a link" }));

    await screen.findByText(/is on an account here/i);
    expect(postAuthRecoveries).toHaveBeenCalledWith({
      email: "nobody@example.com",
    });
  });
});

/** A recovery link is a path, so the page is opened by putting one in the address bar. */
const open = (token = "a-token") => {
  window.history.pushState({}, "", `/recover/${token}`);
  return render(<Login />);
};

describe("a recovery link", () => {
  it("names the account it opens, so a link for somebody else is obvious", async () => {
    open();
    await screen.findByText(/for misha/i);
  });

  /**
   * It does not sign anybody in. The account existed before this, the link may have reached the
   * wrong person, and typing the new password at the login form once is the cheapest
   * confirmation that the right one has it.
   */
  it("sets the password and then asks for it", async () => {
    open();
    await screen.findByText(/for misha/i);

    fireEvent.change(screen.getByPlaceholderText("New password"), {
      target: { value: "a good password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set it" }));

    await screen.findByText(/sign in with the new one/i);
    expect(postAuthRecoveriesByTokenAccept).toHaveBeenCalledWith("a-token", {
      password: "a good password",
    });
  });

  // Four states somebody acts on differently, and one refusal for all four leaves every one of
  // them doing the same useless thing.
  it("says which kind of dead a dead link is", async () => {
    for (const [state, said] of [
      [{ used: true }, /already been used/i],
      [{ voided: true }, /newer link replaced/i],
      [{ expired: true }, /has expired/i],
    ] as const) {
      getAuthRecoveriesByToken.mockResolvedValue({
        ...fresh,
        usable: false,
        ...state,
      });
      const { unmount } = open();
      await screen.findByText(said);
      unmount();
    }

    getAuthRecoveriesByToken.mockRejectedValue(new Error("no"));
    open();
    await screen.findByText(/not one of ours/i);
  });
});
