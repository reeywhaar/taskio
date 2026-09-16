import { copy } from "@app/clipboard";

/**
 * A copy button on every code block in rendered markdown.
 *
 * The blocks arrive as HTML from marked rather than as elements somebody wrote, so there is no
 * component to hang a button off: it is built here and put beside the block it copies. Called
 * again after each render, and it skips the blocks it has already done.
 *
 * The button sits on a wrapper rather than inside the <pre>, because a <pre> scrolls sideways
 * and anything absolutely positioned inside one slides out of the corner with the content.
 *
 * Kept, deliberately, beside a second copy of the same idea in scripts/docs.mjs: that page is
 * static HTML built without the bundle, and the two have nothing they can share but the shape.
 */
const DONE = "data-copyable";

export function addCopyButtons(root: HTMLElement) {
  for (const pre of root.querySelectorAll("pre")) {
    if (pre.parentElement?.hasAttribute(DONE)) continue;
    const box = document.createElement("div");
    box.setAttribute(DONE, "");
    box.className = "group relative";
    pre.replaceWith(box);
    box.append(pre, buttonFor(pre));
  }
}

function buttonFor(pre: HTMLPreElement): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.title = "Copy this block";
  button.textContent = "Copy";
  button.className =
    "absolute top-1.5 right-1.5 rounded-md border border-line bg-bg px-2 py-1 text-xs " +
    "text-muted opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 " +
    "group-hover:opacity-100 pointer-coarse:opacity-100";

  button.addEventListener("click", async () => {
    if (!(await copy(text(pre)))) return;
    button.textContent = "Copied";
    window.setTimeout(() => (button.textContent = "Copy"), 1200);
  });
  return button;
}

/**
 * What the block says, without the newline marked puts at the end of it: pasted into a shell,
 * a trailing newline is the Return key, and the command runs before it has been read.
 */
function text(pre: HTMLPreElement): string {
  return (pre.textContent ?? "").replace(/\n$/, "");
}
