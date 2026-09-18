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
    // Stuck to the foot of the screen below the breakpoint, where the window is what scrolls:
    // the bar was the last thing in the document, so picking a task at the top of a long list
    // meant scrolling to the bottom of it to do anything with the task. Sticky rather than
    // fixed — at the end of the list it comes to rest in its own place, so it never sits on top
    // of the last row, and nothing has to reserve space for it. Above the breakpoint the list
    // has its own scrolling box and the bar is already outside it, in view the whole time.
    //
    // Two elements, because the bar has to line up with the cards above it and they are inside
    // the list's padding. One element carrying both the width and the ground drew a bar hanging
    // six pixels past the rows on either side — the outer one is the list's box, the inner one
    // is the bar, and they are the same width now by construction rather than by arithmetic.
    <div className="sticky bottom-3 z-30 mx-auto mb-4 w-full max-w-3xl shrink-0 px-3 md:static md:px-6">
      <div className="raised flex flex-wrap items-center gap-2 rounded-lg bg-bg px-3 py-2">
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
