import { useState } from "react";

/**
 * An id is only worth showing if it can be got out of the screen and into a shell, a message or
 * a model's prompt without retyping.
 *
 * Its own control rather than decoration, and not the row's press target: the title opens the
 * task, the id copies. One control per intention.
 *
 * It holds the width of an id whatever it is showing. The confirmation is shorter than the
 * eight characters it replaces, and in a monospace box that means the row reflows under the
 * pointer at the moment somebody has just clicked it — 8ch is exactly an id, because every
 * glyph in a monospace face is one ch wide.
 */
export function TaskId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!(await write(id))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy this id"
      className="inline-block w-[8ch] text-left font-mono text-xs tabular-nums text-faint hover:text-muted"
    >
      {copied ? "copied" : id}
    </button>
  );
}

/**
 * Both ways of putting something on the clipboard, in the order they should be tried.
 *
 * The control used to carry user-select:all, so a press that could not copy at least left the id
 * highlighted to press ⌘C on. That is the wrong default: it fires on every press, so the ordinary
 * successful copy also leaves eight characters selected, which reads as a mis-click. The fallback
 * copies instead of offering something to copy, and leaves nothing behind either way.
 *
 * navigator.clipboard is absent outside a secure context and rejects where the permission is
 * refused, which is neither rare nor something this screen can fix. execCommand is deprecated and
 * every browser still runs it.
 */
async function write(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacy(text);
  }
}

function legacy(text: string): boolean {
  // Off-screen rather than hidden: a control that is not displayed cannot hold a selection, and
  // the selection is what execCommand copies.
  const box = document.createElement("textarea");
  box.value = text;
  box.readOnly = true;
  box.style.cssText =
    "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.append(box);
  box.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    box.remove();
  }
}
