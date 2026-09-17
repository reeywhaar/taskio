import { useRef, useState } from "react";

import { PlusIcon } from "@app/components/icons/Icon";
import type { Tag } from "@app/api/types";

/** How long a press has to last to mean "only this one". */
const HOLD = 450;

/**
 * A pill, and the press that means the other thing.
 *
 * Pointer events rather than mouse or touch ones, so the hold is written once and a finger, a
 * pen and a mouse all reach it. touch-action tells the browser this element is not a place to
 * start a scroll or a double-tap zoom from, which is what makes a long press on a phone land
 * here instead of being swallowed as a gesture; select-none keeps a held pill from turning into
 * highlighted text, and the context menu is what a long press means on Android otherwise.
 *
 * The click that follows a hold is dropped. A press is one intention, and a finger lifting off
 * after half a second should not also toggle the tag that was just narrowed to.
 */
function Pill({
  slug,
  on,
  onToggle,
  onHold,
}: {
  slug: string;
  on: boolean;
  onToggle: () => void;
  onHold?: () => void;
}) {
  const timer = useRef(0);
  const held = useRef(false);
  const [holding, setHolding] = useState(false);

  const start = () => {
    if (!onHold) return;
    held.current = false;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      held.current = true;
      setHolding(false);
      onHold();
    }, HOLD);
  };

  const stop = () => {
    window.clearTimeout(timer.current);
    setHolding(false);
  };

  return (
    <button
      type="button"
      aria-pressed={on}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => onHold && e.preventDefault()}
      onClick={() => {
        if (held.current) {
          held.current = false;
          return;
        }
        onToggle();
      }}
      className={`touch-manipulation rounded-full px-2.5 py-1 text-xs transition-transform select-none motion-reduce:transition-none ${
        holding ? "scale-90" : ""
      } ${on ? "bg-brand text-brand-ink" : "bg-fill text-muted hover:text-fg"}`}
    >
      {slug}
    </button>
  );
}

/**
 * One component, used twice: on the list it filters, in the editor it assigns. The caller owns
 * what the change means.
 *
 * A pill shows the slug itself — there is no separate display name — so what is on the pill is
 * what goes in the URL and what an agent would type.
 */
export function TagCloud({
  tags,
  selected,
  onToggle,
  onCreate,
  onOnly,
}: {
  tags: Tag[];
  selected: string[];
  onToggle: (slug: string) => void;
  /** Only the editor's cloud offers this: a tag exists once a task carries it, so inventing
   *  one on the filter screen would narrow the list to nothing. */
  onCreate?: (slug: string) => void;
  /** Only the filter's cloud offers this: holding a pill on the list narrows to that one tag,
   *  where on a task it would quietly take every other tag off. */
  onOnly?: (slug: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const known = new Set(tags.map((t) => t.slug));
  const shown = [
    ...tags.map((t) => t.slug),
    ...selected.filter((s) => !known.has(s)),
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((slug) => (
        <Pill
          key={slug}
          slug={slug}
          on={selected.includes(slug)}
          onToggle={() => onToggle(slug)}
          onHold={onOnly && (() => onOnly(slug))}
        />
      ))}

      {onCreate ? (
        adding ? (
          <input
            autoFocus
            value={draft}
            placeholder="new tag"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setAdding(false);
              setDraft("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setAdding(false);
                setDraft("");
              }
              if (e.key !== "Enter") return;
              e.preventDefault();
              // Folded rather than refused: somebody typing "Home Repairs" means home-repairs.
              const slug = draft
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9_ -]/g, "")
                .replace(/\s+/g, "-")
                .replace(/^-+|-+$/g, "");
              if (slug) onCreate(slug);
              setAdding(false);
              setDraft("");
            }}
            className="w-28 rounded-full border-[1.5px] border-line bg-bg px-2.5 py-1 text-xs"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-dashed border-line px-2.5 py-1 text-xs text-muted hover:border-faint hover:text-fg"
          >
            <PlusIcon /> New tag
          </button>
        )
      ) : null}
    </div>
  );
}
