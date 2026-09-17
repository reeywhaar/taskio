import { useRef, useState } from "react";

import { PlusIcon } from "@app/components/icons/Icon";
import type { Tag } from "@app/api/types";

/** How long a press has to last to mean "only this one". */
const HOLD = 450;

/** How far it has to move first to mean "somewhere else" instead. */
const SLOP = 6;

type At = { x: number; y: number };

/** The bar that says where a carried pill would land. */
const MARKER =
  "before:absolute before:top-0 before:h-full before:w-0.5 before:rounded-full before:bg-fg before:content-['']";

/**
 * A pill, and the three things a press on it can mean.
 *
 * Tap toggles. Hold narrows to this tag alone. Move first and it is a drag, which cancels the
 * hold — three intentions on one target, told apart by what the pointer does rather than by
 * three separate controls.
 *
 * Pointer events rather than mouse or touch ones, so all of it is written once and a finger, a
 * pen and a mouse reach it. touch-action:none says this is not a place to start a scroll or a
 * zoom from, which is what lets a finger hold or drag here at all; select-none keeps a held
 * pill from becoming highlighted text, and the context menu is what a long press means on
 * Android otherwise.
 *
 * The pointer is captured for the whole drag, which is why nothing moves until it is let go: a
 * captured pointer is released the moment its element is moved in the DOM, and a cloud that
 * rearranges under the finger does that on the first swap — silently, halfway through.
 *
 * The click that follows a hold or a drag is dropped. A press is one intention, and a finger
 * lifting off should not also toggle the tag it has just narrowed to or moved.
 */
function Pill({
  slug,
  on,
  carried,
  mark,
  onToggle,
  onHold,
  onDrag,
  onDrop,
}: {
  slug: string;
  on: boolean;
  /** The pill being carried, drawn as one that has left its place. */
  carried: boolean;
  /** Which side of this pill the carried one would land on, if either. */
  mark: "before" | "after" | null;
  onToggle: () => void;
  onHold?: () => void;
  /** Where the pointer is, once the press has travelled far enough to be a drag. */
  onDrag?: (at: At) => void;
  onDrop?: () => void;
}) {
  const timer = useRef(0);
  const spent = useRef(false);
  const from = useRef<At | null>(null);
  const moving = useRef(false);
  const [holding, setHolding] = useState(false);

  const endHold = () => {
    window.clearTimeout(timer.current);
    setHolding(false);
  };

  const finish = (dropped: boolean) => {
    endHold();
    from.current = null;
    if (moving.current && dropped) onDrop?.();
    moving.current = false;
  };

  return (
    <button
      type="button"
      data-slug={slug}
      aria-pressed={on}
      onPointerDown={(e) => {
        spent.current = false;
        moving.current = false;
        from.current = { x: e.clientX, y: e.clientY };
        // Without it the pointer leaves this 60px target on its first move and the rest of the
        // drag is reported to whatever it passes over.
        if (onDrag) e.currentTarget.setPointerCapture(e.pointerId);
        if (!onHold) return;
        setHolding(true);
        timer.current = window.setTimeout(() => {
          spent.current = true;
          setHolding(false);
          onHold();
        }, HOLD);
      }}
      onPointerMove={(e) => {
        const start = from.current;
        if (!start || !onDrag) return;
        if (!moving.current) {
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < SLOP)
            return;
          moving.current = true;
          spent.current = true;
          endHold();
        }
        onDrag({ x: e.clientX, y: e.clientY });
      }}
      onPointerUp={() => finish(true)}
      onPointerCancel={() => finish(false)}
      onContextMenu={(e) => (onHold || onDrag) && e.preventDefault()}
      onClick={() => {
        if (spent.current) {
          spent.current = false;
          return;
        }
        onToggle();
      }}
      className={`relative rounded-full px-2.5 py-1 text-xs transition select-none motion-reduce:transition-none ${
        onDrag ? "touch-none" : "touch-manipulation"
      } ${holding ? "scale-90" : ""} ${carried ? "opacity-40" : ""} ${
        // A bar in the gap beside the pill rather than a ring around it: what is being chosen
        // is a place between two tags, not a tag. Drawn as a pseudo-element, so the pills do
        // not shift to make room for it and the place under the finger stays the place under
        // the finger.
        mark ? MARKER : ""
      } ${mark === "before" ? "before:-left-1" : ""} ${
        mark === "after" ? "before:-right-1" : ""
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
  onReorder,
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
  /** Only the filter's cloud offers this: the arrangement belongs to the account, and the
   *  editor's cloud is a set of checkboxes that happens to be drawn the same way. */
  onReorder?: (slugs: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  /** The pill being carried, and the one it would be dropped in front of. */
  const [carrying, setCarrying] = useState<string | null>(null);
  const [onto, setOnto] = useState<string | null>(null);

  const known = new Set(tags.map((t) => t.slug));
  // A tag lit but carried by nothing still shows, or the filter would have a pill missing.
  const shown = [
    ...tags.map((t) => t.slug),
    ...selected.filter((s) => !known.has(s)),
  ];

  const over = (slug: string) => (at: At) => {
    setCarrying(slug);
    const under = document.elementFromPoint(at.x, at.y)?.closest("[data-slug]");
    const it = under instanceof HTMLElement ? under.dataset.slug : undefined;
    setOnto(it && it !== slug ? it : null);
  };

  /**
   * Which side of the pill under the finger the bar goes.
   *
   * A pill dragged rightwards lands after the one it was dropped on and a pill dragged left
   * lands before it, which is what makes both ends of the row reachable — so the bar is drawn
   * on the side it would actually land.
   */
  const markFor = (slug: string): "before" | "after" | null => {
    if (!carrying || onto !== slug) return null;
    return shown.indexOf(carrying) < shown.indexOf(slug) ? "after" : "before";
  };

  /** The order it would be in, which is only drawn once the pill is let go of. */
  const drop = () => {
    const from = carrying ? shown.indexOf(carrying) : -1;
    const to = onto ? shown.indexOf(onto) : -1;
    setCarrying(null);
    setOnto(null);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...shown];
    next.splice(from, 1);
    next.splice(to, 0, shown[from]!);
    onReorder?.(next);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((slug) => (
        <Pill
          key={slug}
          slug={slug}
          on={selected.includes(slug)}
          carried={carrying === slug}
          mark={markFor(slug)}
          onToggle={() => onToggle(slug)}
          onHold={onOnly && (() => onOnly(slug))}
          onDrag={onReorder && over(slug)}
          onDrop={onReorder && drop}
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
