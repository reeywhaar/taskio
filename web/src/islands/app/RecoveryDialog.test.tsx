import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@app/api/transport";
import { RecoveryDialog } from "@app/islands/app/RecoveryDialog";
import { mount } from "@app/test/harness";

const postAccountRecovery = vi.fn();
const postAccountRecoveryConfirm = vi.fn();
vi.mock("@app/api/actions/account", () => ({
  postAccountRecovery: (body: unknown) => postAccountRecovery(body),
  postAccountRecoveryConfirm: (body: unknown) =>
    postAccountRecoveryConfirm(body),
}));

/** The first step, which every test past the first one has to get through. */
const send = async (email: string) => {
  // By role, because the field's own question mark is named after the field too.
  fireEvent.change(screen.getByRole("textbox", { name: /address/i }), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send a code" }));
  await waitFor(() => screen.getByLabelText("The code from the mail"));
};

describe("RecoveryDialog", () => {
  beforeEach(() => {
    postAccountRecovery.mockReset().mockResolvedValue(undefined);
    postAccountRecoveryConfirm.mockReset().mockResolvedValue(undefined);
  });

  /**
   * An address nobody has proved they can read is worse than none, so nothing is saved until
   * the code comes back — the dialog reports success only from the second call.
   */
  it("does not finish on the first step alone", async () => {
    const onClose = vi.fn();
    mount(<RecoveryDialog open current="" onClose={onClose} />);
    await send("misha@example.com");

    expect(postAccountRecovery).toHaveBeenCalledWith({
      email: "misha@example.com",
    });
    expect(postAccountRecoveryConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes saying it saved once the code comes back", async () => {
    const onClose = vi.fn();
    mount(<RecoveryDialog open current="" onClose={onClose} />);
    await send("misha@example.com");

    fireEvent.change(screen.getByLabelText("The code from the mail"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(postAccountRecoveryConfirm).toHaveBeenCalledWith({
        code: "123456",
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  });

  // A wrong code must leave the account exactly as it was, and say so where it was typed.
  it("stays on the code step when the code is refused", async () => {
    const onClose = vi.fn();
    postAccountRecoveryConfirm.mockRejectedValue(
      new ApiError(400, "invalid", "That code is not right."),
    );
    mount(<RecoveryDialog open current="" onClose={onClose} />);
    await send("misha@example.com");

    fireEvent.change(screen.getByLabelText("The code from the mail"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(screen.getByText("That code is not right.")).toBeDefined(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("goes back to the address when told to start again", async () => {
    mount(<RecoveryDialog open current="" onClose={vi.fn()} />);
    await send("wrong@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    expect(screen.getByRole("button", { name: "Send a code" })).toBeDefined();
  });

  /** A different address, not a first one: the field says which errand this is. */
  it("asks for a different address when one is already on file", () => {
    mount(<RecoveryDialog open current="old@example.com" onClose={vi.fn()} />);
    expect(screen.getByLabelText("A different address")).toBeDefined();
  });
});
