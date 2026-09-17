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
import { TextField } from "@app/components/TextField";

/**
 * A sticky bar, one request per action.
 *
 * Delete asks for confirmation and nothing else does: the others are visible and reversible in
 * one tap, and delete is neither.
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
    <div className="mx-auto mb-4 flex w-full max-w-3xl shrink-0 flex-wrap items-center gap-2 raised rounded-lg bg-bg px-3 py-2 md:px-6">
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
          <TextField
            autoFocus
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-24"
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
                  `Delete ${ids.length} tasks? This cannot be undone.`,
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
  );
}
