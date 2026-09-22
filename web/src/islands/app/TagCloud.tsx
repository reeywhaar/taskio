import { useRef, useState } from "react";

import { useCarry } from "@app/islands/app/carry";

import { PlusIcon } from "@app/components/icons/Icon";
import type { Tag } from "@app/api/types";

/** How long a press has to last to mean "only this one". */
const HOLD = 450;

/**
 * What a pill says about its tag.
 *
 * A union rather than a boolean because one cloud answers several questions. On a task a tag is
 * carried or it is not; across a selection it can be carried by some of it; and a filter or a
 * token scope will want to say a tag is shut out rather than merely unlit. One tone each, below,
 * so a fourth state is one entry and one rule.
 */
export type TagState = "off" | "some" | "on";

/**
 * The ink and ground for each.
 *
 * `some` is the brand mixed half and half into the ground a pill already had, so it reads as
 * between the two rather than as a third color. It carries the page's own ink rather than
 * brand-ink, which a half-strength ground is too light for in one theme and too dark for in the
 * other — see main.css.
 */
const TONE: Record<TagState, string> = {
  off: "bg-bg text-muted hover:text-fg",
  some: "wash-some",
  on: "wash",
};

const PRESSED: Record<TagState, "true" | "false" | "mixed"> = {
  off: "false",
  some: "mixed",
  on: "true",
};

/** The bar that says where a carried pill would land. */
const MARKER =
  "before:absolute before:top-0 before:h-full before:w-0.5 before:rounded-full before:bg-fg before:content-['']";

/**
 * A pill, and the three things a press on it can mean.
 *
 * Tap toggles. Hold narrows to this tag alone. Move first and it is a drag, which cancels the
 * hold — three intentions on one target, told apart by what the pointer does rather than by
 * three separate controls. The carrying is useCarry's; the hold is this pill's, because it is
 * the only place that has one.
 *
 * touch-action:none says this is not a place to start a scroll or a zoom from, which is what
 * lets a finger hold or drag here at all; select-none keeps a held pill from becoming
 * highlighted text, and the context menu is what a long press means on Android otherwise.
 *
 * Nothing moves until the pill is let go: a captured pointer is released the moment its element
 * is moved in the DOM, and a cloud that rearranges under the finger does that on the first swap.
 */
function Pill({
  slug,
  state,
  carried,
  mark,
  onToggle,
  onHold,
  onOver,
  onDrop,
}: {
  slug: string;
  state: TagState;
  /** The pill being carried, drawn as one that has left its place. */
  carried: boolean;
  /** Which side of this pill the carried one would land on, if either. */
  mark: "before" | "after" | null;
  onToggle: () => void;
  onHold?: () => void;
  onOver?: (slug: string | null) => void;
  onDrop?: () => void;
}) {
  const timer = useRef(0);
  const [holding, setHolding] = useState(false);

  const endHold = () => {
    window.clearTimeout(timer.current);
    setHolding(false);
  };

  const carry = useCarry({
    find: "[data-slug]",
    enabled: !!onOver,
    onStart: endHold,
    onOver: (el) => onOver?.(el?.dataset.slug ?? null),
    onDrop: () => onDrop?.(),
  });

  return (
    <button
      type="button"
      data-slug={slug}
      aria-pressed={PRESSED[state]}
      onPointerDown={(e) => {
        carry.press(e);
        if (!onHold) return;
        setHolding(true);
        timer.current = window.setTimeout(() => {
          carry.spent.current = true;
          setHolding(false);
          onHold();
        }, HOLD);
      }}
      onPointerMove={carry.move}
      onPointerUp={() => {
        endHold();
        carry.release();
      }}
      onPointerCancel={() => {
        endHold();
        carry.cancel();
      }}
      onContextMenu={(e) => (onHold || onOver) && e.preventDefault()}
      onClick={() => {
        if (carry.spent.current) {
          carry.spent.current = false;
          return;
        }
        onToggle();
      }}
      className={`relative rounded-full px-2.5 py-1 text-xs transition select-none motion-reduce:transition-none ${
        onOver ? "touch-none" : "touch-manipulation"
      } ${holding ? "scale-90" : ""} ${carried ? "opacity-40" : ""} ${
        // A bar in the gap beside the pill rather than a ring around it: what is being chosen
        // is a place between two tags, not a tag. Drawn as a pseudo-element, so the pills do
        // not shift to make room for it and the place under the finger stays the place under
        // the finger.
        mark ? MARKER : ""
      } ${mark === "before" ? "before:-left-1" : ""} ${
        mark === "after" ? "before:-right-1" : ""
      } raised ${TONE[state]}`}
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
  partial,
  onToggle,
  onCreate,
  onOnly,
  onReorder,
}: {
  tags: Tag[];
  selected: string[];
  /** Carried by some of what this stands for and not the rest — a selection of tasks, where
   *  the one answer the cloud can give is that there is no one answer. */
  partial?: string[];
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
    ...[...selected, ...(partial ?? [])].filter((s) => !known.has(s)),
  ];

  const stateOf = (slug: string): TagState =>
    selected.includes(slug) ? "on" : partial?.includes(slug) ? "some" : "off";

  const over = (slug: string) => (it: string | null) => {
    setCarrying(slug);
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
          state={stateOf(slug)}
          carried={carrying === slug}
          mark={markFor(slug)}
          onToggle={() => onToggle(slug)}
          onHold={onOnly && (() => onOnly(slug))}
          onOver={onReorder && over(slug)}
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
            className="sunken w-28 rounded-full border-0 bg-bg px-2.5 py-1 text-xs focus:outline-none"
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
