import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { postTasks } from "@app/api/actions/tasks";
import { ApiError } from "@app/api/transport";
import { qk } from "@app/api/keys";
import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import { emptyDraft, TaskForm, type Draft } from "@app/islands/app/TaskForm";

/**
 * Writing a task down.
 *
 * The same fields as the editor, because they are the same fields — see TaskForm. What is
 * different is that there is nothing to fetch, nothing to delete, and no mentions until the
 * task exists to be mentioned.
 *
 * It opens with whatever tags are lit on the list. Somebody filtered to `home` and pressing
 * new task means a home task, and typing the word again to say so is work the screen already
 * knows the answer to.
 */
export function NewTaskDialog({
  open,
  tags,
  onClose,
}: {
  open: boolean;
  /** The lit pills, which a new task starts with. */
  tags: string[];
  onClose: (made?: string) => void;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft(tags));
  const [error, setError] = useState("");

  // Emptied when it opens, not when it closes: a dialog cleared on the way out shows what was
  // typed for as long as it takes to close.
  useEffect(() => {
    if (!open) return;
    setDraft(emptyDraft(tags));
    setError("");
  }, [open, tags]);

  const create = useMutation({
    mutationFn: () =>
      postTasks({
        title: draft.title.trim(),
        description: draft.description,
        tags: draft.tags,
        priority: Number(draft.priority) || 0,
      }),
    onSuccess: (task) => {
      client.invalidateQueries({ queryKey: qk.tasks });
      client.invalidateQueries({ queryKey: qk.tags });
      onClose(task.id);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  const usable = draft.title.trim() !== "" && !create.isPending;

  return (
    <Dialog
      open={open}
      onClose={() => onClose()}
      title="New task"
      wide
      footer={
        <>
          <Button onClick={() => onClose()} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            variant="solid"
            disabled={!usable}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Adding…" : "Add"}
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <TaskForm
          draft={draft}
          onChange={setDraft}
          titlePlaceholder="What needs doing?"
        />
        {error ? <p className="text-sm text-accent">{error}</p> : null}
      </div>
    </Dialog>
  );
}
