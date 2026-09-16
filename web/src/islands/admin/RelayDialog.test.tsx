import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@app/api/transport";
import { RelayDialog, TestMailDialog } from "@app/islands/admin/RelayDialog";
import { mount, settle } from "@app/test/harness";

const getAdminRelay = vi.fn();
const putAdminRelay = vi.fn();
const postAdminRelayTest = vi.fn();
vi.mock("@app/api/actions/admin", () => ({
  getAdminRelay: () => getAdminRelay(),
  putAdminRelay: (body: unknown) => putAdminRelay(body),
  postAdminRelayTest: (body: unknown) => postAdminRelayTest(body),
}));

const onRecord = {
  configured: true,
  host: "smtp.example.com",
  port: 587,
  security: "starttls",
  username: "postmaster",
  password_set: true,
  from_address: "taskio@example.com",
  from_name: "taskio",
};

/** The record has landed when the form is showing it, not when the field exists. */
const loaded = () =>
  waitFor(() =>
    expect((screen.getByLabelText("Host") as HTMLInputElement).value).toBe(
      "smtp.example.com",
    ),
  );

describe("RelayDialog", () => {
  beforeEach(() => {
    getAdminRelay.mockReset().mockResolvedValue(onRecord);
    putAdminRelay.mockReset().mockResolvedValue(onRecord);
  });

  it("opens on what is on record rather than empty", async () => {
    mount(<RelayDialog open onClose={vi.fn()} />);
    await waitFor(() =>
      expect((screen.getByLabelText("Host") as HTMLInputElement).value).toBe(
        "smtp.example.com",
      ),
    );
    expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
      "587",
    );
  });

  /**
   * The stored password never comes back out, so the field is blank on a relay that has one.
   * Sending that blank is what keeps it: it is how a port gets corrected without retyping a
   * credential the form was never given.
   */
  it("leaves the password blank, and sends it blank to keep the stored one", async () => {
    mount(<RelayDialog open onClose={vi.fn()} />);
    await loaded();
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      "",
    );

    fireEvent.change(screen.getByLabelText("Port"), {
      target: { value: "465" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(putAdminRelay).toHaveBeenCalledWith(
        expect.objectContaining({ port: 465, password: "" }),
      ),
    );
  });

  it("will not save a relay with no host to send through", async () => {
    getAdminRelay.mockResolvedValue({
      ...onRecord,
      configured: false,
      host: "",
    });
    mount(<RelayDialog open onClose={vi.fn()} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
      ).toBe(true),
    );
  });

  it("closes saying it saved", async () => {
    const onClose = vi.fn();
    mount(<RelayDialog open onClose={onClose} />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  });

  // An abandoned edit is abandoned: reopening shows the record, not what was typed last time.
  it("reloads from the record when it opens again", async () => {
    const { rerender } = mount(<RelayDialog open onClose={vi.fn()} />);
    await loaded();
    await settle();
    fireEvent.change(screen.getByLabelText("Host"), {
      target: { value: "typed.and.abandoned" },
    });

    rerender(<RelayDialog open={false} onClose={vi.fn()} />);
    rerender(<RelayDialog open onClose={vi.fn()} />);

    await waitFor(() =>
      expect((screen.getByLabelText("Host") as HTMLInputElement).value).toBe(
        "smtp.example.com",
      ),
    );
  });
});

describe("TestMailDialog", () => {
  beforeEach(() => {
    postAdminRelayTest.mockReset().mockResolvedValue(undefined);
  });

  it("sends to the address given", async () => {
    mount(<TestMailDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "you@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send it" }));

    await waitFor(() =>
      expect(postAdminRelayTest).toHaveBeenCalledWith({
        to: "you@example.com",
      }),
    );
    await waitFor(() => expect(screen.getByText("Sent.")).toBeDefined());
  });

  /**
   * The relay's own words: "the host was wrong", "the credentials were rejected" and "the
   * certificate did not verify" are three different afternoons.
   */
  it("shows the relay's own refusal rather than a shrug", async () => {
    postAdminRelayTest.mockRejectedValue(
      new ApiError(502, "relay", "The credentials were rejected."),
    );
    mount(<TestMailDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "you@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send it" }));

    await waitFor(() =>
      expect(screen.getByText("The credentials were rejected.")).toBeDefined(),
    );
  });
});
