import { useRef, type PointerEvent as Press } from "react";

/** How far a press has to travel to be a drag rather than a press that wobbled. */
const SLOP = 6;

/**
 * Press, carry, drop — the gesture the tag cloud and the rail both have.
 *
 * Pointer events rather than mouse or touch ones, so a finger, a pen and a mouse all reach it
 * once. The element being dragged captures the pointer, because it is a small target among
 * others and the pointer leaves it on the first move; what is under the pointer is then asked
 * for by hit-testing rather than by listening, which is the same question asked of the position
 * the capture still reports.
 *
 * Callers keep their own state for what is being carried and where it would land. This owns the
 * part that is fiddly and identical: when a press becomes a drag, what it is over, and whether
 * the click that follows should be swallowed — a press is one intention, and a finger lifting
 * off should not also toggle the thing it has just moved.
 */
export function useCarry({
  find,
  onStart,
  onOver,
  onDrop,
  enabled = true,
}: {
  /** What counts as somewhere to land: a selector its targets match. */
  find: string;
  /** The press has travelled far enough to be a drag. */
  onStart?: () => void;
  /** What the pointer is over now, or nothing. */
  onOver: (target: HTMLElement | null) => void;
  /** Let go of, after a drag. */
  onDrop: () => void;
  /** Off where there is nothing to arrange, so a press is only ever a press. */
  enabled?: boolean;
}) {
  const from = useRef<{ x: number; y: number } | null>(null);
  const moving = useRef(false);
  /** This press has already meant something, so the click after it means nothing. */
  const spent = useRef(false);

  const end = (dropped: boolean) => {
    from.current = null;
    if (moving.current && dropped) onDrop();
    moving.current = false;
  };

  return {
    spent,
    press: (e: Press<HTMLElement>) => {
      spent.current = false;
      moving.current = false;
      from.current = { x: e.clientX, y: e.clientY };
      if (enabled) e.currentTarget.setPointerCapture(e.pointerId);
    },
    move: (e: Press<HTMLElement>) => {
      const start = from.current;
      if (!start || !enabled) return;
      if (!moving.current) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < SLOP) return;
        moving.current = true;
        spent.current = true;
        onStart?.();
      }
      const under = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest(find);
      onOver(under instanceof HTMLElement ? under : null);
    },
    release: () => end(true),
    cancel: () => end(false),
  };
}
