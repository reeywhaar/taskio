import { useState } from "react";

import {
  postTasksBulkDelete,
  postTasksBulkDone,
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
 * always the one that moves them — the pinned view is todos, so it finishes them. See
 * docs/interface.md.
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
  const [tagging, setTagging] = useState(false);
  const [slug, setSlug] = useState("");
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
    <div className="mx-auto mb-4 flex w-full max-w-3xl shrink-0 flex-wrap items-center gap-2 rounded-lg bg-surface px-3 py-2 md:px-6">
      {/* It counts what is in front of somebody, which is a different thing from a workload
          number pinned to a tab. */}
      <span className="text-sm text-muted">{ids.length} selected</span>
      <span className="flex-1" />

      {tagging ? (
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
          <Button onClick={() => setTagging(false)}>Cancel</Button>
        </form>
      ) : (
        <>
          <Button
            disabled={busy || ids.length === 0}
            onClick={() =>
              run(() =>
                view === "done"
                  ? postTasksBulkTodo(ids)
                  : postTasksBulkDone(ids),
              )
            }
          >
            {view === "done" ? "Reopen" : "Finish"}
          </Button>
          <Button
            disabled={busy || ids.length === 0}
            onClick={() => setTagging(true)}
          >
            Tag
          </Button>
          <Button
            variant="danger"
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
