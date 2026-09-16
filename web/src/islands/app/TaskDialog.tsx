import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getTags } from "@app/api/actions/tags";
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
import { TextField } from "@app/components/TextField";
import { Dialog } from "@app/components/Dialog";
import { Editor } from "@app/islands/app/Editor";
import { TagCloud } from "@app/islands/app/TagCloud";
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
  const tags = useQuery({ queryKey: qk.tags, queryFn: getTags });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!task.data) return;
    setTitle(task.data.title);
    setDescription(task.data.description);
    setSelected(task.data.tags);
  }, [task.data]);

  const invalidate = () => {
    client.invalidateQueries({ queryKey: qk.tasks });
    client.invalidateQueries({ queryKey: qk.tags });
  };

  const save = useMutation({
    mutationFn: () =>
      patchTasksById(id, { title, description, tags: selected }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  const toggleDone = useMutation({
    mutationFn: () =>
      task.data?.status === "done"
        ? postTasksByIdTodo(id)
        : postTasksByIdDone(id),
    onSuccess: () => invalidate(),
  });

  const remove = useMutation({
    mutationFn: () => deleteTasksById(id),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const done = task.data?.status === "done";

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={task.data ? "Task" : "Loading"}
      footer={
        <>
          <Button variant="danger" onClick={() => remove.mutate()}>
            Delete
          </Button>
          <span className="flex-1" />
          <Button onClick={() => toggleDone.mutate()}>
            {done ? "Reopen" : "Finish"}
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

      {task.data ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <TaskId id={task.data.id} />
            {done ? <span className="text-xs text-muted">finished</span> : null}
          </div>

          <TextField value={title} onChange={(e) => setTitle(e.target.value)} />

          <Editor
            value={description}
            onChange={setDescription}
            limits={{ assetMax: 10 << 20 }}
          />

          <TagCloud
            tags={tags.data?.tags ?? []}
            selected={selected}
            onToggle={(slug) =>
              setSelected((current) =>
                current.includes(slug)
                  ? current.filter((s) => s !== slug)
                  : [...current, slug],
              )
            }
            onCreate={(slug) =>
              setSelected((current) =>
                current.includes(slug) ? current : [...current, slug],
              )
            }
          />

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
      <h3 className="text-xs font-medium tracking-wide text-faint uppercase">
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
