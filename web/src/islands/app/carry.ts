import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as Click,
  type PointerEvent as Press,
} from "react";

/** How far a press has to travel to be a drag rather than a press that wobbled. */
const SLOP = 6;

/**
 * The click a drag's release sets off, wherever it lands. A phone sent it to the row under the
 * finger rather than the one carried, and that row's own flag knew nothing of the drag, so
 * dropping a group opened the one it was dropped on.
 */
function swallowClick() {
  // A release that sets off no click must not take the next real one: gone after a moment, or
  // at the next press.
  const done = () => {
    window.removeEventListener("click", stop, { capture: true });
    window.removeEventListener("pointerdown", done, { capture: true });
  };
  window.addEventListener("click", stop, { capture: true, once: true });
  window.addEventListener("pointerdown", done, { capture: true, once: true });
  window.setTimeout(done, 400);
}

function stop(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

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
  hold = 0,
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
  /**
   * For a finger or a pen: how long a press must stay put before it carries, in milliseconds.
   * Moving sooner is a scroll, and the browser has it. Without one, a list whose every row
   * carries is a list a finger cannot scroll. The element says touch-action: pan-y, and takes
   * the returned ref.
   */
  hold?: number;
}) {
  const from = useRef<{ x: number; y: number } | null>(null);
  const moving = useRef(false);
  /** This press has already meant something, so the click after it means nothing. */
  const spent = useRef(false);
  /** A finger's press, waiting out the hold. */
  const timer = useRef(0);
  const waiting = useRef(false);
  /** The last press was not a mouse's, whose long press is a menu that would take it. */
  const touched = useRef(false);

  // Gone mid-hold: the timer would carry a row that is no longer there.
  useEffect(() => () => window.clearTimeout(timer.current), []);

  /**
   * Holds the page still under a finger that is carrying, the way it is under a mouse.
   *
   * On the element, and there from the start. A phone decides when a touch begins whether
   * anything may stop it scrolling, by whether a listener that is not passive is under it, and
   * React's own touch listeners are passive. One added to the window once the hold was up was
   * asked too late: the rail scrolled under the carry, and the scroll cancelled it.
   */
  const still = useCallback((e: TouchEvent) => {
    if (moving.current && e.cancelable) e.preventDefault();
  }, []);
  const ref = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !hold) return;
      el.addEventListener("touchmove", still, { passive: false });
      return () => el.removeEventListener("touchmove", still);
    },
    [hold, still],
  );

  const end = (dropped: boolean) => {
    window.clearTimeout(timer.current);
    waiting.current = false;
    from.current = null;
    if (moving.current) swallowClick();
    if (moving.current && dropped) onDrop();
    moving.current = false;
  };

  return {
    spent,
    ref,
    press: (e: Press<HTMLElement>) => {
      spent.current = false;
      moving.current = false;
      from.current = { x: e.clientX, y: e.clientY };
      touched.current = e.pointerType === "touch" || e.pointerType === "pen";
      if (!enabled) return;
      if (hold && touched.current) {
        const { clientX, clientY, pointerId } = e;
        const el = e.currentTarget;
        waiting.current = true;
        timer.current = window.setTimeout(() => {
          waiting.current = false;
          moving.current = true;
          spent.current = true;
          try {
            el.setPointerCapture(pointerId);
          } catch {
            // Lifted in the same instant: the release ends it.
          }
          navigator.vibrate?.(10);
          onStart?.();
          const under = document
            .elementFromPoint(clientX, clientY)
            ?.closest(find);
          onOver(under instanceof HTMLElement ? under : null);
        }, hold);
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    move: (e: Press<HTMLElement>) => {
      const start = from.current;
      if (!start || !enabled) return;
      if (waiting.current) {
        // Moved before the hold was up: a scroll, and not this one's business.
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) >= SLOP)
          end(false);
        return;
      }
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
    /** A long press on Android is a menu otherwise, and it would take the hold. A mouse's
     *  right click is still the link's menu. */
    menu: (e: Click<HTMLElement>) => {
      if (enabled && hold && touched.current) e.preventDefault();
    },
  };
}
