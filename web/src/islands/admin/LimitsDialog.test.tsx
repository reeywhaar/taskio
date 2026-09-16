import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LimitsDialog } from "@app/islands/admin/LimitsDialog";
import { mount, settle } from "@app/test/harness";

const getAdminLimits = vi.fn();
const putAdminLimits = vi.fn();
vi.mock("@app/api/actions/admin", () => ({
  getAdminLimits: () => getAdminLimits(),
  putAdminLimits: (body: unknown) => putAdminLimits(body),
}));

const MB = 1 << 20;

/** A promise the test resolves itself, to hold the record back and type into the gap. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const largest = () =>
  screen.getByLabelText("Largest attachment (MB)") as HTMLInputElement;
const perAccount = () =>
  screen.getByLabelText("Per account (MB)") as HTMLInputElement;

describe("LimitsDialog", () => {
  beforeEach(() => {
    getAdminLimits.mockReset().mockResolvedValue({
      asset_max_bytes: 10 * MB,
      account_quota_bytes: 1024 * MB,
    });
    putAdminLimits.mockReset().mockResolvedValue(undefined);
  });

  /** Bytes on the wire, megabytes on a screen: nobody sets a quota in bytes. */
  it("shows megabytes for what the API keeps in bytes", async () => {
    mount(<LimitsDialog open onClose={vi.fn()} />);
    await waitFor(() => expect(largest().value).toBe("10"));
    expect(perAccount().value).toBe("1024");
  });

  it("sends bytes back for the megabytes typed", async () => {
    mount(<LimitsDialog open onClose={vi.fn()} />);
    await waitFor(() => expect(largest().value).toBe("10"));

    await settle();

    fireEvent.change(largest(), { target: { value: "25" } });
    fireEvent.change(perAccount(), { target: { value: "2048" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(putAdminLimits).toHaveBeenCalledWith({
        asset_max_bytes: 25 * MB,
        account_quota_bytes: 2048 * MB,
      }),
    );
  });

  // Somebody typing while the record is still on its way must not have it typed over.
  it("does not overwrite what is being typed when the record lands", async () => {
    const record = deferred<unknown>();
    getAdminLimits.mockReturnValue(record.promise);
    mount(<LimitsDialog open onClose={vi.fn()} />);

    fireEvent.change(largest(), { target: { value: "99" } });
    record.resolve({
      asset_max_bytes: 10 * MB,
      account_quota_bytes: 1024 * MB,
    });
    await waitFor(() => expect(getAdminLimits).toHaveBeenCalled());

    expect(largest().value).toBe("99");
  });

  it("closes saying it saved", async () => {
    const onClose = vi.fn();
    mount(<LimitsDialog open onClose={onClose} />);
    await waitFor(() => expect(largest().value).toBe("10"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  });
});
