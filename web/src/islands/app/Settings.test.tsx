import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Token } from "@app/api/types";
import { Account, Pins, SignedIn, Tokens } from "@app/islands/app/Settings";
import { mount } from "@app/test/harness";

const account = {
  recovery_email: "",
  relay_configured: false,
  assets: { used: 0, quota: 1, max: 1 },
  pin_hours: 8,
};
const setAccount = vi.fn((body: { pin_hours: number }) =>
  Promise.resolve({ ...account, ...body }),
);
vi.mock("@app/api/actions/account", () => ({
  getAccount: () => Promise.resolve(account),
  patchAccount: (body: { pin_hours: number }) => setAccount(body),
  deleteAccountRecovery: vi.fn(),
}));

vi.mock("@app/api/actions/auth", () => ({
  getAuthMe: () =>
    Promise.resolve({
      id: "pr_1",
      username: "robin",
      role: "user",
      created_at: 1,
    }),
  postAuthLogout: vi.fn(() => Promise.resolve()),
}));

const revoke = vi.fn();
const rotate = vi.fn();
let tokens: Token[] = [];
vi.mock("@app/api/actions/tokens", () => ({
  getTokens: () => Promise.resolve({ tokens }),
  deleteTokensById: (id: string) => revoke(id),
  deleteTokensRevoked: vi.fn(),
  patchTokensById: vi.fn(),
  postTokens: vi.fn(),
  postTokensByIdRotate: (id: string) => rotate(id),
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
vi.mock("@app/api/actions/tags", () => ({
  getTags: () => Promise.resolve({ tags: [] }),
}));

const token = (extra: Partial<Token> = {}): Token =>
  ({
    id: "4b9933cf3430",
    label: "the laptop",
    hint: "abcd1234",
    scope: "",
    projects: [{ project: "main", name: "Main", scope: "" }],
    created_at: 1789343452,
    expires_at: null,
    last_used_at: null,
    revoked_at: null,
    rotated_at: null,
    last_ip: "",
    last_agent: "",
    idle_seconds: 0,
    ...extra,
  }) as Token;

describe("a token's row", () => {
  beforeEach(() => {
    revoke.mockReset().mockResolvedValue(undefined);
    tokens = [token()];
  });
  afterEach(() => vi.restoreAllMocks());

  /** The one thing on the row that cannot be taken back, so it is asked first. */
  it("asks before revoking, and a no does nothing", async () => {
    mount(<Tokens />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke…" }));

    const asked = screen.getByRole("dialog");
    expect(within(asked).getByText("the laptop")).toBeDefined();
    fireEvent.click(within(asked).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(revoke).not.toHaveBeenCalled();
  });

  it("revokes on a yes", async () => {
    mount(<Tokens />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke…" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Revoke",
      }),
    );
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("4b9933cf3430"));
  });

  /** An agent's half-hour token: a date would say only "today". */
  it("says how long is left for a token ending within the day", async () => {
    tokens = [
      token({ expires_at: Math.floor(Date.now() / 1000) + 10 * 60 + 30 }),
    ];
    mount(<Tokens />);
    expect(await screen.findByText("stops in 10 mins")).toBeDefined();
  });

  /** Edit, Rotate… and Revoke… wrap as one rather than one at a time. */
  it("keeps a row's actions together", async () => {
    tokens = [token()];
    mount(<Tokens />);
    const edit = await screen.findByRole("button", { name: "Edit" });
    expect(edit.parentElement).toBe(
      screen.getByRole("button", { name: "Revoke…" }).parentElement,
    );
  });

  /** A limit no preset matches is said as it is, the way the edit dialog says it. */
  it("names an idle limit exactly, and says when it stops", async () => {
    const at = Math.floor(Date.now() / 1000) + 10 * 86400;
    tokens = [token({ idle_seconds: 2 * 86400, expires_at: at })];
    mount(<Tokens />);
    await screen.findByText("retires after 2 days unused");
    expect(
      screen.getByText(`stops on ${new Date(at * 1000).toLocaleDateString()}`),
    ).toBeDefined();
  });
});

/** A new secret and the rest kept: asked first, since the old secret stops at once. */
describe("rotating a token", () => {
  beforeEach(() => {
    tokens = [token()];
    rotate.mockReset().mockResolvedValue({
      token: token({ id: "9d0c1a2b3e4f" }),
      secret: "tk_newsecretvalue",
    });
  });

  it("asks, and a no does nothing", async () => {
    mount(<Tokens />);
    fireEvent.click(await screen.findByRole("button", { name: "Rotate…" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(rotate).not.toHaveBeenCalled();
  });

  it("shows the new secret once on a yes", async () => {
    mount(<Tokens />);
    fireEvent.click(await screen.findByRole("button", { name: "Rotate…" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Rotate",
      }),
    );
    expect(await screen.findByText("tk_newsecretvalue")).toBeDefined();
    expect(rotate).toHaveBeenCalledWith("4b9933cf3430");
    expect(screen.getByRole("button", { name: "Copy" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "I have copied it" }));
    await waitFor(() =>
      expect(screen.queryByText("tk_newsecretvalue")).toBeNull(),
    );
  });
});

describe("pins", () => {
  it("says how long a pin holds, and changes it as it is chosen", async () => {
    mount(<Pins />);
    const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
    expect(select.value).toBe("8");
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Never",
      "2 hours",
      "4 hours",
      "8 hours",
      "12 hours",
      "24 hours",
    ]);
    fireEvent.change(select, { target: { value: "0" } });
    await waitFor(() =>
      expect(setAccount).toHaveBeenCalledWith({ pin_hours: 0 }),
    );
    await waitFor(() => expect(select.value).toBe("0"));
  });
});

/** Who is signed in is at the top right, not a section of its own. */
describe("who is signed in", () => {
  it("names the account, with no Sign out beside it", async () => {
    mount(<SignedIn />);
    expect(await screen.findByText("robin")).toBeDefined();
    // The sessions have it for this browser; once is enough.
    expect(screen.queryByRole("button", { name: /Sign out/ })).toBeNull();
  });
});

/** Sections of one button each were a column of slabs: the account is one, a row each. */
describe("the account", () => {
  it("is one section, its actions words at the row's end", async () => {
    mount(<Account />);
    expect(
      await screen.findByRole("button", { name: "Change…" }),
    ).toBeDefined();
    // No relay and no address: nothing to say about recovery.
    expect(screen.queryByText("Recovery address")).toBeNull();
  });
});
