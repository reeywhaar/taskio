import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deleteTasksById,
  getTasksById,
  patchTasksById,
  postTasksByIdDone,
  postTasksByIdTodo,
} from "@app/api/actions/tasks";
import { ApiError } from "@app/api/transport";
import type { TaskStub } from "@app/api/types";
import { qk } from "@app/api/keys";
import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import { Dummy } from "@app/components/Dummy";
import { emptyDraft, TaskForm, type Draft } from "@app/islands/app/TaskForm";
import { TaskId } from "@app/islands/app/TaskId";

/**
 * A modal at every size. The editor is a route, so the system back gesture closes it rather
 * than the whole application — which on a phone is the difference between a working app and
 * one that feels broken.
 */
export function TaskDialog({
  id,
  onClose,
  onOpen,
}: {
  id: string;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const client = useQueryClient();
  const task = useQuery({
    queryKey: qk.task(id),
    queryFn: () => getTasksById(id),
  });
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState("");

  useEffect(() => {
    if (!task.data) return;
    setDraft({
      title: task.data.title,
      description: task.data.description,
      priority: String(task.data.priority),
      tags: task.data.tags,
      color: task.data.color,
    });
  }, [task.data]);

  /**
   * One reading of the status, used by the button's word and by what the button does.
   *
   * Two readings is how they disagree: while the task is still loading the footer already draws
   * a button, and a label computed one way beside an action computed another way is a button
   * that says Mark done and marks it todo.
   */
  const status = task.data?.status ?? "todo";

  const invalidate = () => {
    client.invalidateQueries({ queryKey: qk.tasks });
    client.invalidateQueries({ queryKey: qk.tags });
  };

  const save = useMutation({
    mutationFn: () =>
      patchTasksById(id, {
        title: draft.title,
        description: draft.description,
        tags: draft.tags,
        priority: Number(draft.priority) || 0,
        color: draft.color,
      }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  // Only a todo goes forward; done and deleted both come back.
  const toggleDone = useMutation({
    mutationFn: () =>
      status === "todo" ? postTasksByIdDone(id) : postTasksByIdTodo(id),
    onSuccess: () => invalidate(),
  });

  const remove = useMutation({
    mutationFn: () => deleteTasksById(id),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={task.data ? "Task" : "Loading"}
      aside={
        task.data ? (
          <>
            <TaskId id={task.data.id} />
            {status === "done" ? (
              <span className="text-xs text-muted">finished</span>
            ) : null}
            {status === "deleted" ? (
              <span className="text-xs text-accent">deleted</span>
            ) : null}
          </>
        ) : null
      }
      footer={
        <>
          {/* Not shown on a task already in the bin: there is nothing further to do to it
              from here, and a Delete that does nothing is worse than no Delete. */}
          {status === "deleted" ? null : (
            <Button variant="danger" onClick={() => remove.mutate()}>
              Delete
            </Button>
          )}
          <span className="flex-1" />
          {/* What it does, rather than what it is called elsewhere. "Finish" sits where a
              dialog's dismiss button lives and reads as finishing the editing — which is the one
              thing it does not do. */}
          <Button onClick={() => toggleDone.mutate()}>
            {
              { todo: "Mark done", done: "Mark as todo", deleted: "Restore" }[
                status
              ]
            }
          </Button>
          <Button
            variant="solid"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            Save
          </Button>
        </>
      }
    >
      {task.isError ? (
        <p className="text-sm text-accent">
          {task.error instanceof ApiError
            ? task.error.message
            : "That task could not be read."}
        </p>
      ) : null}

      {/* The shape of the form, not an empty dialog: the fields arrive in place rather than
          appearing where nothing was. */}
      {!task.data && !task.isError ? (
        <div className="flex flex-col gap-4">
          <Dummy className="h-10 w-full sm:h-11" />
          <div className="flex flex-col gap-2">
            <Dummy className="h-4 w-14" />
            <Dummy className="h-40 w-full" />
          </div>
          <div className="flex items-start justify-between gap-6">
            <Dummy className="h-11 w-40" />
            <Dummy className="h-11 w-32" />
          </div>
          <Dummy className="h-7 w-52" />
        </div>
      ) : null}

      {task.data ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <TaskForm draft={draft} onChange={setDraft} />

          <Mentions
            heading="Mentions"
            list={task.data.mentions}
            onOpen={onOpen}
          />
          <Mentions
            heading="Mentioned by"
            list={task.data.mentioned_by}
            onOpen={onOpen}
          />

          {error ? <p className="text-sm text-accent">{error}</p> : null}
        </div>
      ) : null}
    </Dialog>
  );
}

/**
 * The titles come from the payload rather than a lookup, so the chips draw with no extra
 * request. A section with nothing in it is not shown.
 */
function Mentions({
  heading,
  list,
  onOpen,
}: {
  heading: string;
  list: TaskStub[];
  onOpen: (id: string) => void;
}) {
  if (list.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
        {heading}
      </h3>
      <ul className="mt-1 flex flex-col gap-1">
        {list.map((stub) => (
          <li key={stub.id}>
            <button
              type="button"
              onClick={() => onOpen(stub.id)}
              className="inline-flex items-center gap-2 text-sm hover:underline"
            >
              <span className="font-mono text-xs text-faint">{stub.id}</span>
              <span
                className={
                  stub.status === "done" ? "text-muted line-through" : ""
                }
              >
                {stub.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
