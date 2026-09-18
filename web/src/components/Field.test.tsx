import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Field, Group } from "@app/components/Field";

describe("Field", () => {
  /**
   * The trap: a label names the first labelable thing inside it, and a button is one. Drawn
   * where it looks like it belongs — between the caption and the field — the question mark
   * takes the caption for itself and the field is left with no name at all.
   */
  it("names the control, not the question mark beside it", () => {
    render(
      <Field label="Priority" hint="Higher sorts higher.">
        <input type="number" />
      </Field>,
    );
    expect(screen.getByLabelText("Priority").tagName).toBe("INPUT");
  });

  it("keeps what the field means one press away", () => {
    render(
      <Field label="Priority" hint="Higher sorts higher.">
        <input type="number" />
      </Field>,
    );
    expect(screen.queryByText("Higher sorts higher.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "About priority" }));
    expect(screen.getByText("Higher sorts higher.")).toBeDefined();
  });

  it("draws no mark where there is nothing to explain", () => {
    render(
      <Field label="Title">
        <input />
      </Field>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  // The caption form, for a set of controls rather than one.
  it("explains a group the same way", () => {
    render(
      <Group label="Color" hint="Down the left of the row.">
        <button type="button">red</button>
      </Group>,
    );
    fireEvent.click(screen.getByRole("button", { name: "About color" }));
    expect(screen.getByText("Down the left of the row.")).toBeDefined();
  });
});
