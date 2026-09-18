import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Segmented } from "@app/components/Segmented";

const views = ["pinned", "todo", "done"] as const;

const control = (value: (typeof views)[number] = "todo") => {
  const onChange = vi.fn();
  render(
    <Segmented
      label="Which list"
      value={value}
      options={views}
      onChange={onChange}
    />,
  );
  return onChange;
};

describe("Segmented", () => {
  it("says which one is on", () => {
    control();
    expect(
      screen.getByRole("button", { name: "todo" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "done" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("reports the one pressed", () => {
    const onChange = control();
    fireEvent.click(screen.getByRole("button", { name: "done" }));
    expect(onChange).toHaveBeenCalledWith("done");
  });

  /**
   * One backdrop behind the row rather than a class on the segment that is on: a class cannot
   * animate from one element to another, and where it lands is measured in a browser, which
   * jsdom is not.
   */
  it("draws one backdrop, and does not announce it", () => {
    const { container } = render(
      <Segmented
        label="Which list"
        value="todo"
        options={views}
        onChange={vi.fn()}
      />,
    );
    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(hidden.length).toBe(1);
    expect(hidden[0]!.className).toContain("transition");
  });
});
