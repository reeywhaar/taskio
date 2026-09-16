import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@app/api/transport";
import { PasswordDialog } from "@app/islands/app/PasswordDialog";
import { mount } from "@app/test/harness";

const postAccountPassword = vi.fn();
vi.mock("@app/api/actions/account", () => ({
  postAccountPassword: (body: unknown) => postAccountPassword(body),
}));

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const submit = () => screen.getByRole("button", { name: "Change it" });

describe("PasswordDialog", () => {
  beforeEach(() => {
    postAccountPassword.mockReset();
    postAccountPassword.mockResolvedValue(undefined);
  });

  /**
   * Being signed in is not the same as knowing the password, and the difference is what stops
   * a borrowed session becoming a taken account.
   */
  it("will not submit without the current one", () => {
    mount(<PasswordDialog open onClose={vi.fn()} />);
    type("New password", "a good password");
    type("New password again", "a good password");
    expect(submit().hasAttribute("disabled")).toBe(true);
  });

  // The server receives one new password and cannot know it was meant to be typed twice.
  it("will not submit two that differ, and says so", () => {
    mount(<PasswordDialog open onClose={vi.fn()} />);
    type("Current password", "the old one");
    type("New password", "a good password");
    type("New password again", "a good passwrod");

    expect(screen.getByText("These two do not match.")).toBeDefined();
    expect(submit().hasAttribute("disabled")).toBe(true);
  });

  it("will not submit one the server would refuse for being short", () => {
    mount(<PasswordDialog open onClose={vi.fn()} />);
    type("Current password", "the old one");
    type("New password", "short");
    type("New password again", "short");
    expect(submit().hasAttribute("disabled")).toBe(true);
  });

  it("sends both and closes saying it changed", async () => {
    const onClose = vi.fn();
    mount(<PasswordDialog open onClose={onClose} />);
    type("Current password", "the old one");
    type("New password", "a good password");
    type("New password again", "a good password");
    fireEvent.click(submit());

    await waitFor(() =>
      expect(postAccountPassword).toHaveBeenCalledWith({
        current: "the old one",
        new: "a good password",
      }),
    );
    // true, so the page can say so. A bare close would leave nothing to report.
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  });

  it("stays open and shows the refusal when the current one was wrong", async () => {
    const onClose = vi.fn();
    postAccountPassword.mockRejectedValue(
      new ApiError(401, "unauthenticated", "That is not the current password."),
    );
    mount(<PasswordDialog open onClose={onClose} />);
    type("Current password", "not it");
    type("New password", "a good password");
    type("New password again", "a good password");
    fireEvent.click(submit());

    await waitFor(() =>
      expect(
        screen.getByText("That is not the current password."),
      ).toBeDefined(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  // Emptied on the way in, not on the way out: a dialog cleared as it closes shows what was
  // typed for as long as it takes to close.
  it("opens empty after a previous attempt", () => {
    const { rerender } = mount(<PasswordDialog open onClose={vi.fn()} />);
    type("Current password", "typed and abandoned");

    rerender(<PasswordDialog open={false} onClose={vi.fn()} />);
    rerender(<PasswordDialog open onClose={vi.fn()} />);

    expect(
      (screen.getByLabelText("Current password") as HTMLInputElement).value,
    ).toBe("");
  });
});
