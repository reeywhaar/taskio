import { fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskId } from "@app/islands/app/TaskId";

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

describe("TaskId", () => {
  it("copies the whole id, never a prefix", async () => {
    render(<TaskId id="8qw4tz9k" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("8qw4tz9k"));
  });

  it("says so afterwards", async () => {
    render(<TaskId id="8qw4tz9k" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toBe("copied"),
    );
  });

  /**
   * The confirmation is shorter than the id it replaces, so a box sized by its content reflows
   * the row under the pointer at the moment somebody has just clicked it.
   *
   * jsdom has no layout, so this pins the width the box is given rather than the width it ends
   * up with. The widths themselves were measured in a browser: without this the control goes
   * from 57.8px to 43.4px and the title beside it moves 14.4px left.
   */
  it("is given a fixed width, and keeps it while it says copied", async () => {
    render(<TaskId id="8qw4tz9k" />);
    const button = screen.getByRole("button");
    expect(button.className).toContain("w-[8ch]");

    fireEvent.click(button);
    await waitFor(() => expect(button.textContent).toBe("copied"));
    expect(button.className).toContain("w-[8ch]");
  });

  // Selecting it still works, which is why the copy is an enhancement rather than the way.
  it("does not fall over where there is no clipboard", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    render(<TaskId id="8qw4tz9k" />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    await waitFor(() => expect(button.textContent).toBe("8qw4tz9k"));
  });
});
