import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Token } from "@app/api/types";
import { Tokens } from "@app/islands/app/Settings";
import { mount } from "@app/test/harness";

const revoke = vi.fn();
let tokens: Token[] = [];
vi.mock("@app/api/actions/tokens", () => ({
  getTokens: () => Promise.resolve({ tokens }),
  deleteTokensById: (id: string) => revoke(id),
  deleteTokensRevoked: vi.fn(),
  patchTokensById: vi.fn(),
  postTokens: vi.fn(),
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
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));

    const asked = screen.getByRole("dialog");
    expect(within(asked).getByText("the laptop")).toBeDefined();
    fireEvent.click(within(asked).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(revoke).not.toHaveBeenCalled();
  });

  it("revokes on a yes", async () => {
    mount(<Tokens />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Revoke",
      }),
    );
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("4b9933cf3430"));
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
