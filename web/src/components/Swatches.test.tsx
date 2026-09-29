import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ColorSelect, COLOURS } from "@app/components/Swatches";

const field = (value = "", onChange = vi.fn()) => {
  render(
    <ColorSelect
      label="Color"
      value={value}
      onChange={onChange}
      none="No color"
    />,
  );
  return onChange;
};

describe("ColorSelect", () => {
  it("says what it holds, and shows the swatches only when pressed", () => {
    field(COLOURS[1]);
    const button = screen.getByRole("button", {
      name: `Color: ${COLOURS[1]}`,
    });
    expect(screen.queryByRole("button", { name: "No color" })).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "No color" })).toBeDefined();
  });

  it("closes on a choice, with the choice", () => {
    const onChange = field();
    fireEvent.click(screen.getByRole("button", { name: "Color: No color" }));
    fireEvent.click(screen.getByRole("button", { name: COLOURS[2] }));
    expect(onChange).toHaveBeenCalledWith(COLOURS[2]);
    expect(screen.queryByRole("button", { name: COLOURS[2] })).toBeNull();
  });

  it("closes on Escape, and keeps the Escape from the dialog around it", () => {
    field();
    const button = screen.getByRole("button", { name: "Color: No color" });
    fireEvent.click(button);
    expect(fireEvent.keyDown(button, { key: "Escape" })).toBe(false);
    expect(screen.queryByRole("button", { name: "No color" })).toBeNull();
  });

  it("closes on a press elsewhere", () => {
    field();
    fireEvent.click(screen.getByRole("button", { name: "Color: No color" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("button", { name: "No color" })).toBeNull();
  });
});
