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
 * knows the answer to. The title arrives the same way when there is one — a search that matched
 * nothing is usually a task somebody has just written into the wrong box.
 */
export function NewTaskDialog({
  open,
  project,
  tags,
  title = "",
  onClose,
  onCreated,
}: {
  open: boolean;
  /** The project on screen, which is where it is written unless somebody says otherwise. */
  project: string;
  /** The lit pills, which a new task starts with. */
  tags: string[];
  /** What it opens with in the title, where somebody has already typed it somewhere else. */
  title?: string;
  onClose: () => void;
  /** Only when a task was actually written, which is not the same as the dialog closing. */
  onCreated?: () => void;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft(tags, title, project));
  const [error, setError] = useState("");

  // Emptied when it opens, not when it closes: a dialog cleared on the way out shows what was
  // typed for as long as it takes to close.
  useEffect(() => {
    if (!open) return;
    setDraft(emptyDraft(tags, title, project));
    setError("");
  }, [open, tags, title, project]);

  const create = useMutation({
    mutationFn: () =>
      postTasks(draft.project, {
        title: draft.title.trim(),
        description: draft.description,
        tags: draft.tags,
        priority: Number(draft.priority) || 0,
        color: draft.color,
      }),
    // Written and gone. Opening the task that was just written puts a second modal where the
    // first one was, and two wide dialogs with the same fields in the same place read as one
    // dialog that would not close.
    onSuccess: () => {
      client.invalidateQueries({ queryKey: qk.tasks });
      client.invalidateQueries({ queryKey: qk.tags });
      onCreated?.();
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  const usable = draft.title.trim() !== "" && !create.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New task"
      wide
      footer={
        <>
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
      <div className="flex flex-1 flex-col gap-4">
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
