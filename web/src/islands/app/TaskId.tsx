import { useState } from "react";

/**
 * An id is only worth showing if it can be got out of the screen and into a shell, a message or
 * a model's prompt without retyping.
 *
 * Its own control rather than decoration, and not the row's press target: the title opens the
 * task, the id copies. One control per intention.
 *
 * user-select:all is the half that keeps working when navigator.clipboard is missing — an
 * insecure context, an old browser — which is why the copy is an enhancement layered on
 * selectable text rather than the only way through.
 *
 * It holds the width of an id whatever it is showing. The confirmation is shorter than the
 * eight characters it replaces, and in a monospace box that means the row reflows under the
 * pointer at the moment somebody has just clicked it — 8ch is exactly an id, because every
 * glyph in a monospace face is one ch wide.
 */
export function TaskId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Selecting it still works, which is the point of the class below.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy this id"
      className="inline-block w-[8ch] text-left font-mono text-xs tabular-nums select-all text-faint hover:text-muted"
    >
      {copied ? "copied" : id}
    </button>
  );
}
