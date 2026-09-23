import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deleteTasksById,
  getTasksById,
  patchTasksById,
  postTasksByIdDone,
  postTasksByIdPoke,
  postTasksByIdTodo,
} from "@app/api/actions/tasks";
import { ApiError } from "@app/api/transport";
import { getProjects } from "@app/api/actions/projects";
import type { Project, Task, TaskDetail, TaskStub } from "@app/api/types";
import { qk } from "@app/api/keys";
import { ago, MONTH, WEEK } from "@app/ago";
import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import { PinIcon } from "@app/components/icons/Icon";
import { Dummy } from "@app/components/Dummy";
import { emptyDraft, TaskForm, type Draft } from "@app/islands/app/TaskForm";
import { projectNamed } from "@app/islands/app/ProjectPicker";
import { TaskId } from "@app/islands/app/TaskId";

/** The fields as the server has them. */
function seed(task: TaskDetail): Draft {
  return {
    title: task.title,
    description: task.description,
    priority: String(task.priority),
    tags: task.tags,
    color: task.color,
    project: task.project,
  };
}

/** Whether the fields say something the server copy does not. Tags as a set: a pill pressed
 *  off and on again has moved to the end of the list, which is not a change to the task. */
function differs(draft: Draft, task: TaskDetail): boolean {
  return (
    draft.title !== task.title ||
    draft.description !== task.description ||
    (Number(draft.priority) || 0) !== task.priority ||
    draft.color !== task.color ||
    draft.project !== task.project ||
    draft.tags.length !== task.tags.length ||
    draft.tags.some((tag) => !task.tags.includes(tag))
  );
}

/**
 * A modal at every size. The editor is a route, so the system back gesture closes it rather
 * than the whole application — which on a phone is the difference between a working app and
 * one that feels broken.
 */
export function TaskDialog({
  id,
  project,
  onClose,
  onOpen,
  onElsewhere,
}: {
  id: string;
  /** The project the list behind it is showing, by slug; empty is the default. */
  project: string;
  onClose: () => void;
  onOpen: (id: string) => void;
  /** The task turned out to be in another project, which the list should be showing. */
  onElsewhere?: (project: Project) => void;
}) {
  const client = useQueryClient();
  const projects = useQuery({ queryKey: qk.projects, queryFn: getProjects });
  const task = useQuery({
    queryKey: qk.task(id),
    queryFn: () => getTasksById(id),
  });
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState("");

  /**
   * Seeded from the server copy — but over a draft nobody has touched, and only that.
   *
   * The task is fetched again whenever anything invalidates it: marking it done does, and so
   * does an edit arriving from elsewhere. Seeding over the fields each time was the dialog
   * throwing away what somebody had typed since — a verdict written and then the task marked
   * done came back as an empty description, with Save still there to press and nothing left to
   * save.
   */
  const seededFrom = useRef<TaskDetail | undefined>(undefined);
  useEffect(() => {
    if (!task.data) return;
    const was = seededFrom.current;
    seededFrom.current = task.data;
    setDraft((current) =>
      was && differs(current, was) ? current : seed(task.data),
    );
  }, [task.data]);

  /**
   * The list behind a task is its own project's. Opened from a mention, or from a link, a task
   * can be in a project other than the one on screen — and a dialog over the wrong list is
   * a task somebody closes and then cannot find.
   */
  const lives = task.data?.project;
  useEffect(() => {
    const all = projects.data?.projects;
    if (!lives || !all || !onElsewhere) return;
    const here = projectNamed(all, project);
    const there = all.find((p) => p.slug === lives);
    if (here && there && here.id !== there.id) onElsewhere(there);
    // Asked when the task or the project on screen changes, not when a callback does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lives, project, projects.data]);

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

  const write = () =>
    patchTasksById(id, {
      title: draft.title,
      description: draft.description,
      tags: draft.tags,
      priority: Number(draft.priority) || 0,
      color: draft.color,
      // Only when it was changed: a task saved from where it is should not so much as ask to
      // move, and a token confined to its project would be refused for asking.
      ...(task.data && draft.project !== task.data.project
        ? { project: draft.project }
        : {}),
    });

  const save = useMutation({
    mutationFn: write,
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  /**
   * What is in the fields, written first if it says anything new — by every button that does
   * something to the task, not only by Save.
   *
   * A verdict is often the last thing written on a task, why it is done or why it is not worth
   * doing, and the next press is Mark done or Delete. Either one used to leave the verdict in
   * the fields, and the fields were then thrown away. A save the server refuses stops the rest
   * and says why, rather than losing the words a second way.
   */
  const flush = async () => {
    if (task.data && differs(draft, task.data)) await write();
  };

  // Only a todo goes forward; done and deleted both come back.
  const toggleDone = useMutation({
    mutationFn: async () => {
      await flush();
      await (status === "todo" ? postTasksByIdDone(id) : postTasksByIdTodo(id));
    },
    onSuccess: () => invalidate(),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  // A property rather than a status, so it stays open: the task is still the one being edited.
  const togglePinned = useMutation({
    mutationFn: async () => {
      await flush();
      await patchTasksById(id, { pinned: !task.data?.pinned });
    },
    onSuccess: () => invalidate(),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  // Says the task still stands, and the row's age starts again. Stays open, like the pin.
  const poke = useMutation({
    mutationFn: async () => {
      await flush();
      await postTasksByIdPoke(id);
    },
    onSuccess: () => invalidate(),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  const remove = useMutation({
    mutationFn: async () => {
      await flush();
      await deleteTasksById(id);
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong."),
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
            {/* The row's own control, beside the id: the same icon for the same thing. */}
            <button
              type="button"
              aria-label={task.data.pinned ? "Unpin" : "Pin"}
              title={task.data.pinned ? "Unpin" : "Pin"}
              aria-pressed={task.data.pinned}
              disabled={togglePinned.isPending}
              onClick={() => togglePinned.mutate()}
              className={`flex items-center rounded-md p-0.5 text-base hover:bg-line ${
                task.data.pinned ? "text-brand" : "text-faint hover:text-fg"
              }`}
            >
              <PinIcon />
            </button>
            <Age
              task={task.data}
              pending={poke.isPending}
              onPoke={() => poke.mutate()}
            />
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

/**
 * How old the task is, in the title bar with the other things said about it rather than written
 * in it — the same number the row shows, from the same moment.
 *
 * A todo counts from its last poke, and once it is stale, from a week, it offers the poke there:
 * the button on its own did not say what it did, and the age it resets is what tells somebody
 * whether to press it. A finished or deleted task says when that happened and offers nothing,
 * since a poke would move nothing anybody reads. Colored by the row's rules: grey, then amber from
 * a week and red from a month on a todo; grey however old on a finished one; red in the bin.
 */
function Age({
  task,
  pending,
  onPoke,
}: {
  task: Task;
  pending: boolean;
  onPoke: () => void;
}) {
  if (task.status === "deleted")
    return (
      <span className="text-xs whitespace-nowrap text-accent">
        deleted {ago(task.deleted_at ?? task.updated_at)}
      </span>
    );
  if (task.status === "done")
    return (
      <span className="text-xs whitespace-nowrap text-faint">
        finished {ago(task.done_at ?? task.updated_at)}
      </span>
    );

  const since = Date.now() / 1000 - task.poked_at;
  if (since < WEEK)
    return (
      <span className="text-xs whitespace-nowrap text-faint">
        {ago(task.poked_at)}
      </span>
    );
  return (
    <span
      className={`text-xs whitespace-nowrap ${since >= MONTH ? "text-accent" : "text-warn"}`}
    >
      Stale for {ago(task.poked_at).replace(/ ago$/, "")}
      {" · "}
      <button
        type="button"
        title="Say it still stands: its age starts again from now"
        disabled={pending}
        onClick={onPoke}
        className="underline underline-offset-2 hover:text-fg disabled:opacity-50"
      >
        poke?
      </button>
    </span>
  );
}
