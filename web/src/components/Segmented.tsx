import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * One of several, with the lit backdrop travelling between them.
 *
 * The backdrop is one element behind the row rather than a class on whichever segment is on.
 * A class cannot animate from one element to another — the old pill stops existing and a new
 * one appears somewhere else, which is a cut rather than a move, and a cut is the thing that
 * makes a segmented control read as three buttons that happen to touch.
 *
 * Its place is measured rather than computed. Segments here are as wide as their words, so
 * there is no fraction of the track to translate by, and making them equal instead would pad
 * "Todo" out to the width of "Pinned" for the sake of the arithmetic.
 */
export function Segmented<T extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: T;
  options: readonly T[];
  /** What the group is choosing, for a reader who arrives at it out of context. */
  label: string;
  onChange: (next: T) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);

  // Before paint, so the backdrop is never drawn at the wrong place and then corrected — and
  // so its first appearance is not an animation from the left edge.
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => {
      const on = [...el.querySelectorAll<HTMLElement>("[data-value]")].find(
        (button) => button.dataset.value === value,
      );
      if (on) setBox({ left: on.offsetLeft, width: on.offsetWidth });
    };
    measure();
    // The words are fixed, but the room they take is not: a font arriving late and the coarse
    // pointer's taller track both move the segments without anything here changing.
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [value, options]);

  return (
    <div
      ref={track}
      role="group"
      aria-label={label}
      className="sunken relative inline-flex min-h-9 gap-1 rounded-md p-1 text-sm pointer-coarse:min-h-10"
    >
      {box ? (
        <span
          aria-hidden="true"
          className="raised wash absolute top-1 bottom-1 left-0 rounded-md transition-[transform,width] duration-200 ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(${box.left}px)`, width: box.width }}
        />
      ) : null}

      {options.map((option) => (
        <Segment
          key={option}
          value={option}
          on={value === option}
          onClick={() => onChange(option)}
        >
          {option}
        </Segment>
      ))}
    </div>
  );
}

/**
 * Transparent, because the ground it is read on is the backdrop behind the row.
 *
 * Which is also why the ink waits. The word turns to the color that can be read on the brand at
 * the moment it is pressed, and the brand is still under the word somebody pressed a moment ago
 * — so for the length of the journey the new label is white on a bare track, which is to say
 * gone. The delay is on the pressed one only: leaving is immediate, because the backdrop leaves
 * immediately too.
 */
function Segment({
  value,
  on,
  onClick,
  children,
}: {
  value: string;
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-value={value}
      aria-pressed={on}
      onClick={onClick}
      className={`relative flex items-center rounded-md px-2 capitalize transition-colors duration-150 aria-pressed:delay-150 motion-reduce:transition-none sm:px-3 ${
        on ? "text-brand-ink" : "text-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
