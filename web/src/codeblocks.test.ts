import { beforeEach, describe, expect, it, vi } from "vitest";

import { addCopyButtons } from "@app/codeblocks";

const writeText = vi.fn();

function rendered(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

beforeEach(() => {
  document.body.innerHTML = "";
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

describe("addCopyButtons", () => {
  it("copies the block, without the newline marked left on the end", async () => {
    const root = rendered(
      "<pre><code>curl -H 'x: y' /api/tasks\n</code></pre>",
    );
    addCopyButtons(root);

    const button = root.querySelector("button");
    button?.click();
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("curl -H 'x: y' /api/tasks"),
    );
    await vi.waitFor(() => expect(button?.textContent).toBe("Copied"));
  });

  it("puts one on each block and none on anything else", () => {
    const root = rendered(
      "<p>words <code>inline</code></p><pre><code>one</code></pre><pre><code>two</code></pre>",
    );
    addCopyButtons(root);
    expect(root.querySelectorAll("button")).toHaveLength(2);
  });

  /** It runs after every render of the preview, over blocks it has mostly already done. */
  it("does not add a second button to a block it has already done", () => {
    const root = rendered("<pre><code>one</code></pre>");
    addCopyButtons(root);
    addCopyButtons(root);
    expect(root.querySelectorAll("button")).toHaveLength(1);
  });

  /**
   * A <pre> scrolls sideways, so a button inside one slides out of the corner with the content.
   * It goes on a wrapper that does not scroll.
   */
  it("hangs the button beside the block rather than inside it", () => {
    const root = rendered("<pre><code>one</code></pre>");
    addCopyButtons(root);
    const button = root.querySelector("button");
    expect(button?.closest("pre")).toBeNull();
    expect(button?.previousElementSibling?.tagName).toBe("PRE");
  });

  it("says nothing where it could not copy at all", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(document, "execCommand", {
      value: () => false,
      configurable: true,
    });
    const root = rendered("<pre><code>one</code></pre>");
    addCopyButtons(root);
    const button = root.querySelector("button");
    button?.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(button?.textContent).toBe("Copy");
  });
});
