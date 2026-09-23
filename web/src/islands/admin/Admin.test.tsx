import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Admin } from "@app/islands/admin/Admin";
import { mount } from "@app/test/harness";

const recoveryURL = "http://taskio.example/recover/abc";
const inviteURL = "http://taskio.example/invite/xyz";
vi.mock("@app/api/actions/admin", () => ({
  getAdminUsers: () =>
    Promise.resolve({
      users: [{ id: "p_1", username: "robin", role: "user", created_at: 1 }],
    }),
  postAdminUsersByIdRecovery: () =>
    Promise.resolve({ url: recoveryURL, expires_at: 2, username: "robin" }),
  postAdminInvites: () =>
    Promise.resolve({ link: inviteURL, role: "user", expires_at: 2 }),
  getAdminRelay: () => Promise.resolve({ configured: false }),
  deleteAdminRelay: vi.fn(),
  getAdminLimits: () =>
    Promise.resolve({ asset_max_bytes: 1 << 20, account_quota_bytes: 1 << 20 }),
}));

describe("Admin", () => {
  /** Over the row it was asked from, not under the invitations where it read as one of them. */
  it("shows a recovery link in a dialog of its own, with a copy", async () => {
    mount(<Admin />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Recovery link" }),
    );

    const dialog = (
      await screen.findByRole("heading", { name: "Recovery link" })
    ).closest("dialog")!;
    expect(within(dialog).getByText(recoveryURL)).toBeDefined();
    expect(within(dialog).getByText("robin")).toBeDefined();
    expect(within(dialog).getByRole("button", { name: "Copy" })).toBeDefined();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "I have copied it" }),
    );
    await waitFor(() => expect(screen.queryByText(recoveryURL)).toBeNull());
  });

  it("shows an invitation under the button that made it, with a copy", async () => {
    mount(<Admin />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Make an invitation" }),
    );
    expect(await screen.findByText(inviteURL)).toBeDefined();
    expect(screen.getByRole("button", { name: "Copy" })).toBeDefined();
  });
});
