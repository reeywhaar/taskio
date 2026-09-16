import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Boundary } from "@app/components/Boundary";

function Breaks({ when }: { when: boolean }) {
  if (when) throw new Error("the data was not what it claimed");
  return <p>the real thing</p>;
}

// React logs a caught error itself; these tests are about what the page shows, not the console.
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

describe("Boundary", () => {
  it("shows what it is holding rather than the page going blank", () => {
    quiet();
    render(
      <Boundary what="Tokens">
        <Breaks when />
      </Boundary>,
    );
    expect(screen.getByText(/Tokens could not be shown/)).toBeDefined();
  });

  it("leaves a working section alone", () => {
    render(
      <Boundary what="Tokens">
        <Breaks when={false} />
      </Boundary>,
    );
    expect(screen.getByText("the real thing")).toBeDefined();
  });

  /**
   * It latches: once a section has failed, new props alone do not put it back. Somebody says
   * when to try, because a boundary that retries on every render of a component that throws
   * during render is a loop.
   */
  it("stays failed until it is told to try again", () => {
    quiet();
    const onReset = vi.fn();
    const { rerender } = render(
      <Boundary what="Tokens" onReset={onReset}>
        <Breaks when />
      </Boundary>,
    );
    expect(screen.getByText(/could not be shown/)).toBeDefined();

    // The answer has landed and the child would render now — the boundary does not know that.
    rerender(
      <Boundary what="Tokens" onReset={onReset}>
        <Breaks when={false} />
      </Boundary>,
    );
    expect(screen.getByText(/could not be shown/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onReset).toHaveBeenCalled();
    expect(screen.getByText("the real thing")).toBeDefined();
  });
});
