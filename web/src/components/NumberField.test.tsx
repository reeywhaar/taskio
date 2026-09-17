import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NumberField } from "@app/components/NumberField";

const field = (value: string) => {
  const onChange = vi.fn();
  const { unmount } = render(
    <NumberField label="Priority" value={value} onChange={onChange} />,
  );
  return Object.assign(onChange, { unmount });
};

describe("NumberField", () => {
  /**
   * Why this exists: no browser on a phone draws the spinner on a number input, so without
   * these two buttons the only way to change a priority on iOS is to type it.
   */
  it("steps up and down from what is there", () => {
    const onChange = field("3");
    fireEvent.click(screen.getByRole("button", { name: "Increase Priority" }));
    expect(onChange).toHaveBeenCalledWith("4");

    fireEvent.click(screen.getByRole("button", { name: "Decrease Priority" }));
    expect(onChange).toHaveBeenCalledWith("2");
  });

  it("steps below nought, because a priority sorts both ways", () => {
    const onChange = field("-1");
    fireEvent.click(screen.getByRole("button", { name: "Decrease Priority" }));
    expect(onChange).toHaveBeenCalledWith("-2");
  });

  // "" and "-" are both things somebody passes through on the way to typing -1.
  it("counts a half-typed field as nought", () => {
    for (const half of ["", "-"]) {
      const onChange = field(half);
      fireEvent.click(
        screen.getByRole("button", { name: "Increase Priority" }),
      );
      expect(onChange).toHaveBeenCalledWith("1");
      onChange.unmount();
    }
  });

  it("still takes what is typed into it", () => {
    const onChange = field("0");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Priority" }), {
      target: { value: "12" },
    });
    expect(onChange).toHaveBeenCalledWith("12");
  });
});
