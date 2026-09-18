import { useState } from "react";

import {
  postTasksBulkDelete,
  postTasksBulkDone,
  postTasksBulkPinned,
  postTasksBulkPriority,
  postTasksBulkTags,
  postTasksBulkTodo,
} from "@app/api/actions/tasks";
import type { Filters } from "@app/islands/app/route";
import { Button } from "@app/components/Button";
import { copy } from "@app/clipboard";
import { NumberField } from "@app/components/NumberField";
import { TextField } from "@app/components/TextField";

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
  view,
  onDone,
}: {
  ids: string[];
  view: Filters["view"];
  onDone: () => void;
}) {
  // One prompt at a time: tagging and setting a number both ask for something typed, and two
  // fields in a bar this size is a bar nobody can find the buttons in.
  const [asking, setAsking] = useState<"tag" | "priority" | null>(null);
  const [slug, setSlug] = useState("");
  const [priority, setPriority] = useState("0");
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
    // wall. The two that answer a prompt keep the field size, since by then there is a field
    // beside them to match.
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
    <div className="sticky bottom-0 z-30 mx-auto w-full max-w-3xl shrink-0 px-3 md:static md:px-6">
      <div className="aloft flex flex-wrap items-center gap-2 rounded-t-lg bg-bg px-3 py-2">
        {/* It counts what is in front of somebody, which is a different thing from a workload
          number pinned to a tab. */}
        <span className="text-sm text-muted">{ids.length} selected</span>
        <span className="flex-1" />

        {asking === "tag" ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (slug.trim())
                void run(() => postTasksBulkTags(ids, [slug.trim()], []));
            }}
          >
            <TextField
              autoFocus
              placeholder="tag"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="w-32"
            />
            <Button type="submit" variant="solid" disabled={busy}>
              Add
            </Button>
            <Button onClick={() => setAsking(null)}>Cancel</Button>
          </form>
        ) : asking === "priority" ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => postTasksBulkPriority(ids, Number(priority) || 0));
            }}
          >
            <NumberField
              autoFocus
              label="Priority"
              value={priority}
              onChange={setPriority}
            />
            <Button type="submit" variant="solid" disabled={busy}>
              Set
            </Button>
            <Button onClick={() => setAsking(null)}>Cancel</Button>
          </form>
        ) : (
          <>
            <Button
              size="bar"
              disabled={busy || ids.length === 0}
              onClick={() =>
                run(() =>
                  view === "done"
                    ? postTasksBulkTodo(ids)
                    : postTasksBulkDone(ids),
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
              disabled={busy || ids.length === 0}
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
          </>
        )}
      </div>
    </div>
  );
}
