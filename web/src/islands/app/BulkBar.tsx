import { useEffect, useRef, useState } from "react";

import {
  postTasksBulkDelete,
  postTasksBulkDone,
  postTasksBulkPinned,
  postTasksBulkTodo,
} from "@app/api/actions/tasks";
import type { Filters } from "@app/islands/app/route";
import type { Tag, Task } from "@app/api/types";
import { Button } from "@app/components/Button";
import { CrossIcon } from "@app/components/icons/Icon";
import { copy } from "@app/clipboard";
import { BulkPriorityDialog } from "@app/islands/app/BulkPriorityDialog";
import { BulkTagDialog } from "@app/islands/app/BulkTagDialog";

/**
 * A sticky bar, one request per action.
 *
 * Delete asks for confirmation and nothing else does. It is reversible now — a deleted task
 * goes to the finished list and can be put back from there — but it is still the one action
 * here that takes a row off the screen, and a whole selection disappearing on a mis-tap is
 * worth one question.
 *
 * The status button follows the view, which fixes the status every selected task has, so it is
 * always the one that moves them — the pinned view is todos, so it finishes them. Pinning gets
 * both buttons, because no view fixes that. See docs/interface.md.
 */
export function BulkBar({
  ids,
  chosen,
  tags,
  view,
  onDone,
  onCancel,
  leaving = false,
  onLeft,
  onHeight,
}: {
  ids: string[];
  /** The selected tasks the list can actually show, which is what the tag cloud counts. One
   *  picked and then filtered away is still acted on; it just has no tags to report. */
  chosen: Task[];
  tags: Tag[];
  view: Filters["view"];
  onDone: () => void;
  /** Done picking, having done nothing. */
  onCancel: () => void;
  /** Sliding back out. The bar cannot delay its own unmount, so the list keeps it while this
   *  is set and takes it away when onLeft says the animation is over. */
  leaving?: boolean;
  onLeft?: () => void;
  /** How tall it is, so the list can leave room to scroll its last row clear of it. Measured
   *  rather than assumed: it wraps to two rows on a phone, and back again on a turn. */
  onHeight?: (px: number) => void;
}) {
  // One prompt at a time, and both of them are dialogs. See the note on the bar below.
  const [asking, setAsking] = useState<"tag" | "priority" | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  /**
   * The ids, comma separated, for pasting somewhere that is not this application.
   *
   * Which is the point of a selection somebody made by eye: eleven ids picked out of ninety
   * rows is a filter nothing can express, and reading them off the screen one at a time is how
   * it gets done otherwise. It says so for a moment afterwards, because a copy that reports
   * nothing is a copy nobody trusts — the same answer the id on a row gives.
   */
  const copyIds = async () => {
    if (!(await copy(ids.join(", ")))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  /**
   * What the list has to make room for.
   *
   * Reported rather than known: the bar wraps at narrow widths, and a number written down here
   * would be the height it happened to have on the day somebody measured it.
   *
   * Nothing, once it is leaving. The bar still measures its full height all the way out — it is
   * sliding, not shrinking — so the room kept for it stayed behind as a band of empty ground
   * under the last row until the unmount took it away in one step.
   */
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || !onHeight) return;
    const tell = () =>
      onHeight(leaving ? 0 : el.getBoundingClientRect().height);
    tell();
    const watch = new ResizeObserver(tell);
    watch.observe(el);
    return () => {
      watch.disconnect();
      // Gone, so the room it needed goes with it.
      onHeight(0);
    };
  }, [onHeight, leaving]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    // bar-sized buttons, because this is a row of controls and not a row beside a field: at the
    // field size they are 44px slabs with an 80px floor under the width, and six of those is a
    // wall.
    //
    // Nothing is asked for in here any more. A prompt that stood in the bar's own row — a field
    // and the two buttons answering it — was taller than the buttons it replaced, so opening one
    // grew the bar and shuffled the list underneath it. Both prompts are dialogs, and the bar is
    // one height for as long as it is on screen.
    //
    // It casts further than a card does, because it is in front of the list rather than part
    // of it: rows slide under this, and at the same height as the things it is covering it read
    // as one more row that happened to be last.
    //
    // Stuck to the foot of the screen below the breakpoint, where the window is what scrolls:
    // the bar was the last thing in the document, so picking a task at the top of a long list
    // meant scrolling to the bottom of it to do anything with the task. Sticky rather than
    // fixed — at the end of the list it comes to rest in its own place, so it never sits on top
    // of the last row, and nothing has to reserve space for it. Above the breakpoint the list
    // has its own scrolling box and the bar is already outside it, in view the whole time.
    //
    // Flush with the bottom edge at either width, and square where it meets it. A rounded
    // corner floating twelve pixels above the foot of the screen is a card that has been left
    // there; a bar that runs into the edge is something docked, which is what this is.
    //
    // Two elements, because the bar has to line up with the cards above it and they are inside
    // the list's padding. One element carrying both the width and the ground drew a bar hanging
    // six pixels past the rows on either side — the outer one is the list's box, the inner one
    // is the bar, and they are the same width now by construction rather than by arithmetic.
    <div
      ref={box}
      // Its own animation, not one of a child's — the pills inside have transitions of their
      // own, and any of them ending would otherwise be read as the bar having gone.
      onAnimationEnd={(e) => {
        if (leaving && e.target === e.currentTarget) onLeft?.();
      }}
      className={`${
        leaving ? "undock" : "dock"
      } sticky bottom-0 z-30 mx-auto w-full max-w-3xl shrink-0 px-3 md:static md:px-6`}
    >
      <div className="aloft flex flex-wrap items-center gap-2 rounded-t-lg bg-bg px-3 py-2">
        {/* Leading the count rather than trailing the row: it is the one control here that
            does nothing to the selection, and the far end of that row is Delete. */}
        <button
          type="button"
          aria-label="Stop selecting"
          title="Stop selecting"
          onClick={onCancel}
          className="-ml-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-line hover:text-fg"
        >
          <CrossIcon />
        </button>

        {/* It counts what is in front of somebody, which is a different thing from a workload
          number pinned to a tab. */}
        <span className="text-sm text-muted">{ids.length} selected</span>
        <span className="flex-1" />

        <Button
          size="bar"
          disabled={busy || ids.length === 0}
          onClick={() =>
            run(() =>
              view === "done" ? postTasksBulkTodo(ids) : postTasksBulkDone(ids),
            )
          }
        >
          {view === "done" ? "Mark as todo" : "Mark done"}
        </Button>
        {/* Both, always. The view fixes the status every selected task has — a todo list is
              all todos — but it fixes nothing about pinning: a todo list holds pinned and
              unpinned tasks side by side, and a selection spanning both needs to say which. */}
        <Button
          size="bar"
          disabled={busy || ids.length === 0}
          onClick={() => run(() => postTasksBulkPinned(ids, true))}
        >
          Pin
        </Button>
        <Button
          size="bar"
          disabled={busy || ids.length === 0}
          onClick={() => run(() => postTasksBulkPinned(ids, false))}
        >
          Unpin
        </Button>
        <Button
          size="bar"
          disabled={ids.length === 0}
          onClick={() => setAsking("priority")}
        >
          Priority
        </Button>
        <Button
          size="bar"
          disabled={busy || ids.length === 0}
          onClick={() => setAsking("tag")}
        >
          Tag
        </Button>
        <Button
          size="bar"
          disabled={ids.length === 0}
          onClick={() => void copyIds()}
        >
          {copied ? "Copied" : "Copy ids"}
        </Button>
        <Button
          variant="danger"
          size="bar"
          disabled={busy || ids.length === 0}
          onClick={() => {
            if (
              window.confirm(
                `Delete ${ids.length} tasks? They go to the finished list, where you can put them back.`,
              )
            ) {
              void run(() => postTasksBulkDelete(ids));
            }
          }}
        >
          Delete
        </Button>
      </div>

      <BulkPriorityDialog
        open={asking === "priority"}
        ids={ids}
        onClose={() => setAsking(null)}
        onSaved={onDone}
      />

      <BulkTagDialog
        open={asking === "tag"}
        ids={ids}
        chosen={chosen}
        tags={tags}
        onClose={() => setAsking(null)}
        onSaved={onDone}
      />
    </div>
  );
}
