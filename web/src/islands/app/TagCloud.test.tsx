import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TagCloud } from "@app/islands/app/TagCloud";

const tags = [
  { id: "a", slug: "home" },
  { id: "b", slug: "work" },
];

const pressed = (slug: string) =>
  screen.getByRole("button", { name: slug }).getAttribute("aria-pressed");

describe("TagCloud", () => {
  it("shows the slug itself, so the pill is what goes in the URL", () => {
    render(<TagCloud tags={tags} selected={[]} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "home" })).toBeDefined();
  });

  it("marks the selected ones pressed", () => {
    render(<TagCloud tags={tags} selected={["work"]} onToggle={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "work" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "home" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  /**
   * A tag exists once a task carries it, so inventing one on the filter screen would narrow the
   * list to nothing. The editor's cloud is the one that offers it.
   */
  it("offers a new tag only where one can be created", () => {
    const { unmount } = render(
      <TagCloud tags={tags} selected={[]} onToggle={vi.fn()} />,
    );
    expect(screen.queryByText("New tag")).toBeNull();
    unmount();

    render(
      <TagCloud
        tags={tags}
        selected={[]}
        onToggle={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(screen.getByText("New tag")).toBeDefined();
  });

  /**
   * A cloud can stand for more than one task, and then a tag is carried by some of them and not
   * the rest. mixed is what a tri-state control says, and it is what keeps the pill out of the
   * pressed-in look a fully lit one wears.
   */
  it("says mixed where a tag is carried by only some of what the cloud stands for", () => {
    render(
      <TagCloud
        tags={tags}
        selected={["home"]}
        partial={["work"]}
        onToggle={vi.fn()}
      />,
    );
    expect(pressed("home")).toBe("true");
    expect(pressed("work")).toBe("mixed");
    expect(screen.getByRole("button", { name: "work" }).className).toContain(
      "wash-some",
    );
  });

  /** A tag chosen in the editor but not yet on any task still has to be drawn. */
  it("shows a selected tag the account does not have yet", () => {
    render(
      <TagCloud tags={tags} selected={["brand-new"]} onToggle={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "brand-new" })).toBeDefined();
  });
});

/**
 * jsdom has no layout, so which pill is under the pointer has to be said rather than measured.
 * What is being pinned here is the order that comes out of a drag, not where the pixels are.
 */
function dragging(cloud: HTMLElement, over: string) {
  const under = [...cloud.querySelectorAll("[data-slug]")].find(
    (el) => (el as HTMLElement).dataset.slug === over,
  );
  document.elementFromPoint = () => under as Element;
}

const three = [
  { id: "a", slug: "alpha" },
  { id: "b", slug: "beta" },
  { id: "c", slug: "gamma" },
];

const press = (el: Element, x: number) =>
  fireEvent.pointerDown(el, { clientX: x, clientY: 0, pointerId: 1 });

describe("dragging a pill", () => {
  beforeEach(() => {
    // jsdom has neither of these, and the pill asks for the capture on every press.
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it("carries a pill past another and lands it after, moving right", () => {
    const onReorder = vi.fn();
    const { container } = render(
      <TagCloud
        tags={three}
        selected={[]}
        onToggle={vi.fn()}
        onReorder={onReorder}
      />,
    );
    const alpha = screen.getByRole("button", { name: "alpha" });
    press(alpha, 0);
    dragging(container, "gamma");
    fireEvent.pointerMove(alpha, { clientX: 40, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(alpha, { pointerId: 1 });

    expect(onReorder).toHaveBeenCalledWith(["beta", "gamma", "alpha"]);
  });

  it("lands it before, moving left", () => {
    const onReorder = vi.fn();
    const { container } = render(
      <TagCloud
        tags={three}
        selected={[]}
        onToggle={vi.fn()}
        onReorder={onReorder}
      />,
    );
    const gamma = screen.getByRole("button", { name: "gamma" });
    press(gamma, 80);
    dragging(container, "alpha");
    fireEvent.pointerMove(gamma, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(gamma, { pointerId: 1 });

    expect(onReorder).toHaveBeenCalledWith(["gamma", "alpha", "beta"]);
  });

  /** A press is one intention: the tag that was just moved must not also be lit. */
  it("does not toggle the tag it moved", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <TagCloud
        tags={three}
        selected={[]}
        onToggle={onToggle}
        onReorder={vi.fn()}
      />,
    );
    const alpha = screen.getByRole("button", { name: "alpha" });
    press(alpha, 0);
    dragging(container, "beta");
    fireEvent.pointerMove(alpha, { clientX: 40, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(alpha, { pointerId: 1 });
    fireEvent.click(alpha);

    expect(onToggle).not.toHaveBeenCalled();
  });

  /** Under the threshold it is a press that wobbled, not a drag. */
  it("is still a tap if the pointer barely moved", () => {
    const onToggle = vi.fn();
    const onReorder = vi.fn();
    render(
      <TagCloud
        tags={three}
        selected={[]}
        onToggle={onToggle}
        onReorder={onReorder}
      />,
    );
    const alpha = screen.getByRole("button", { name: "alpha" });
    press(alpha, 0);
    fireEvent.pointerMove(alpha, { clientX: 3, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(alpha, { pointerId: 1 });
    fireEvent.click(alpha);

    expect(onReorder).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledWith("alpha");
  });

  it("is not offered where there is nothing to arrange", () => {
    render(<TagCloud tags={three} selected={[]} onToggle={vi.fn()} />);
    // The editor's cloud must keep its pills scrollable under a finger.
    expect(screen.getByRole("button", { name: "alpha" }).className).toContain(
      "touch-manipulation",
    );
  });
});
