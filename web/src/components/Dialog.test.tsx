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

  /**
   * The title stays put and the body scrolls under it. It used to be the first thing inside the
   * scroller, so a long description scrolled its own name off the top and left a page of prose
   * with nothing saying what it belonged to.
   */
  it("keeps the title out of the part that scrolls", () => {
    const { container } = mount(
      <Dialog open onClose={vi.fn()} title="Task">
        <p>Something long</p>
      </Dialog>,
    );
    const scroller = container.querySelector(".overflow-y-auto")!;
    const heading = screen.getByRole("heading", { name: "Task" });
    expect(scroller).not.toBeNull();
    expect(scroller.contains(heading)).toBe(false);
    expect(scroller.textContent).toBe("Something long");
  });

  /**
   * What the title is about goes on the title's line. On a row of its own underneath it cost a
   * row and a gap off the top of every task, which on a phone is a twentieth of the screen
   * before the writing starts.
   */
  it("puts the aside beside the title, out of the scrolling part", () => {
    const { container } = mount(
      <Dialog open onClose={vi.fn()} title="Task" aside={<span>8qw4tz9k</span>}>
        <p>Something</p>
      </Dialog>,
    );
    const id = screen.getByText("8qw4tz9k");
    const heading = screen.getByRole("heading", { name: "Task" });
    expect(heading.parentElement!.contains(id)).toBe(true);
    expect(container.querySelector(".overflow-y-auto")!.contains(id)).toBe(
      false,
    );
  });

  // data-autofocus, because React's autoFocus is a call that runs while this is still hidden.
  it("gives focus back to a field that asked for it", () => {
    mount(
      <Dialog
        open
        onClose={vi.fn()}
        title="Change your password"
        footer={<button type="button">Cancel</button>}
      >
        <input data-autofocus aria-label="Current password" />
      </Dialog>,
    );
    expect(document.activeElement).toBe(
      screen.getByLabelText("Current password"),
    );
  });
});
