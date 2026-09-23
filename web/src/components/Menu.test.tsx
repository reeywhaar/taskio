import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Menu, MenuItem } from "@app/components/Menu";

const menu = (onMove = vi.fn()) =>
  render(
    <div>
      <p>elsewhere</p>
      <Menu label="More">
        {(close) => (
          <MenuItem
            onClick={() => {
              close();
              onMove();
            }}
          >
            Move…
          </MenuItem>
        )}
      </Menu>
    </div>,
  );

describe("Menu", () => {
  it("opens on its button and closes on a choice", () => {
    const onMove = vi.fn();
    menu(onMove);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move…" }));
    expect(onMove).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape and on a press anywhere else", () => {
    menu();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.pointerDown(screen.getByText("elsewhere"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
