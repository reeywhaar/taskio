import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "@app/components/Dialog";
import { mount } from "@app/test/harness";

describe("Dialog", () => {
  /**
   * showModal focuses the first control it finds whether or not that control wanted it, and in
   * the task editor that is Delete — a ring on a destructive action reads as armed.
   *
   * jsdom's showModal is the stand-in in test/setup.ts and steals nothing, so what this pins is
   * where focus ends up rather than the taking back. A browser was what showed the ring.
   */
  it("leaves nothing lit when no field asked for focus", () => {
    mount(
      <Dialog
        open
        onClose={vi.fn()}
        title="Task"
        footer={<button type="button">Delete</button>}
      >
        <input aria-label="Title" />
      </Dialog>,
    );
    expect(document.activeElement?.tagName).toBe("DIALOG");
  });

  // React's autoFocus is a call rather than an attribute, and it has already run by then.
  it("gives focus back to a field that asked for it", () => {
    mount(
      <Dialog
        open
        onClose={vi.fn()}
        title="Change your password"
        footer={<button type="button">Cancel</button>}
      >
        <input autoFocus aria-label="Current password" />
      </Dialog>,
    );
    expect(document.activeElement).toBe(
      screen.getByLabelText("Current password"),
    );
  });
});
