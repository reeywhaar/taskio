import { useEffect, useRef, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { getTags } from "@app/api/actions/tags";
import {
  getTasks,
  patchTasksById,
  postTasks,
  postTasksByIdDone,
  postTasksByIdTodo,
} from "@app/api/actions/tasks";
import { ApiError } from "@app/api/transport";
import type { Task } from "@app/api/types";
import { qk } from "@app/api/keys";
import { useLive } from "@app/api/live";
import { Button } from "@app/components/Button";
import { SearchIcon } from "@app/components/icons/Icon";
import { TextField } from "@app/components/TextField";
import { Nav } from "@app/islands/app/Nav";
import { TagCloud } from "@app/islands/app/TagCloud";
import { TaskRow } from "@app/islands/app/TaskRow";
import { TaskDialog } from "@app/islands/app/TaskDialog";
import { BulkBar } from "@app/islands/app/BulkBar";
import { Settings } from "@app/islands/app/Settings";
import {
  printAnd,
  scrollToOffset,
  setScroller,
  storedScroll,
  useLocation,
  type Location,
} from "@app/islands/app/route";

export function App() {
  const { location, go, replace, close } = useLocation();
  useLive();

  // A tags value the pills cannot represent can only have come from outside. It is dropped and
  // the URL rewritten, so the address bar never shows a filter that is not in effect.
  useEffect(() => {
    const raw = new URL(window.location.href).searchParams.get("tags");
    if (raw && raw !== printAnd(location.filters.tags)) replace(location);
    // Once, against the URL as it arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (location.route.name === "settings") {
    return (
      <Shell location={location} onGo={go}>
        <Settings />
      </Shell>
    );
  }

  return (
    <Shell location={location} onGo={go}>
      <List location={location} onGo={go} onReplace={replace} onClose={close} />
    </Shell>
  );
}

function Shell({
  location,
  onGo,
  children,
}: {
  location: Location;
  onGo: (next: Location) => void;
  children: React.ReactNode;
}) {
  // Two columns that scroll on their own above the breakpoint: the page itself does not move,
  // so the rail stays beside whatever the list is doing. Below it the page scrolls as one, which
  // is what a phone expects and what leaves room for a list at all.
  return (
    <div className="flex min-h-dvh flex-col md:h-dvh md:min-h-0 md:flex-row md:overflow-hidden">
      <Nav location={location} onGo={onGo} />
      <main className="flex min-w-0 flex-1 flex-col md:overflow-hidden">
        {children}
      </main>
    </div>
  );
}

function List({
  location,
  onGo,
  onReplace,
  onClose,
}: {
  location: Location;
  onGo: (next: Location) => void;
  onReplace: (next: Location) => void;
  onClose: (fallback: Location) => void;
}) {
  const client = useQueryClient();
  const { filters, route } = location;
  const [selection, setSelection] = useState<string[] | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  // The screen's three choices are two questions to the API: pinned is a property of a todo,
  // so the pinned view is the todo list narrowed rather than a third status.
  const params = {
    tags: printAnd(filters.tags),
    status: filters.view === "done" ? "done" : "todo",
    pinned: filters.view === "pinned" ? "true" : undefined,
    q: filters.q,
  };
  // The answer to the last question stays on screen while the next one is fetched. Without
  // this, lighting a tag empties the list for as long as the round trip takes — and an empty
  // list is not "wait", it is "there is nothing", which is a different sentence.
  const list = useQuery({
    queryKey: qk.taskList(JSON.stringify(params)),
    queryFn: () => getTasks(params),
    placeholderData: keepPreviousData,
  });
  const tags = useQuery({ queryKey: qk.tags, queryFn: getTags });

  // The browser restores scroll on a real navigation and not at all on a pushState one, so
  // closing a task on a long list would otherwise drop somebody at the top of it.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setScroller(scroller.current);
    return () => setScroller(null);
  }, []);
  useEffect(() => {
    if (route.name === "list" && list.data) {
      const offset = storedScroll();
      if (offset) scrollToOffset(offset);
    }
  }, [route.name, list.data]);

  const create = useMutation({
    mutationFn: (name: string) =>
      // Pressing "new task" with pills lit means the tags come with it.
      postTasks({ title: name, tags: filters.tags }),
    onSuccess: () => {
      setTitle("");
      setError("");
      client.invalidateQueries({ queryKey: qk.tasks });
      client.invalidateQueries({ queryKey: qk.tags });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  const toggleDone = useMutation({
    mutationFn: (task: Task) =>
      task.status === "done"
        ? postTasksByIdTodo(task.id)
        : postTasksByIdDone(task.id),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.tasks }),
  });

  const togglePinned = useMutation({
    mutationFn: (task: Task) =>
      patchTasksById(task.id, { pinned: !task.pinned }),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.tasks }),
  });

  const toggleTag = (slug: string) => {
    const next = filters.tags.includes(slug)
      ? filters.tags.filter((s) => s !== slug)
      : [...filters.tags, slug];
    onGo({ ...location, filters: { ...filters, tags: next } });
  };

  const tasks = list.data?.tasks ?? [];
  const filtered = filters.tags.length > 0 || filters.q !== "";
  // Showing one question's answer while another is in flight. A background refetch of the same
  // question is not this: the rows do not change, and a bar that blinks on every one of those
  // is noise rather than news.
  const stale = list.isPlaceholderData || list.isLoading;

  return (
    <div className="flex flex-col md:min-h-0 md:flex-1">
      {/*
        What asks the question stays put and what answers it scrolls. The head is short and is
        needed at any point in a long list — it is the query that produced what is under it.

        Full width with the column inside, rather than a scrolling column, so the scrollbar is
        at the edge of the window where a scrollbar belongs.
      */}
      <div className="mx-auto w-full max-w-3xl shrink-0 px-3 py-4 md:px-6">
        {/* Search, status, tags, list: it narrows from the widest instrument to the narrowest,
            so reading down the screen is reading the query that produced what is under it. */}
        {/* The icon says what the box is for without spending the placeholder on it, and stays
          there once somebody has typed and the placeholder is gone. */}
        <span className="relative flex items-center">
          <SearchIcon className="pointer-events-none absolute left-3 text-faint" />
          <TextField
            type="search"
            placeholder="Search"
            className="w-full pl-9"
            value={filters.q}
            // Replaces rather than pushes, so a five-letter query is one entry to press back
            // through rather than five.
            onChange={(e) =>
              onReplace({
                ...location,
                filters: { ...filters, q: e.target.value },
              })
            }
          />
        </span>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex min-h-11 overflow-hidden rounded-md border-[1.5px] border-line text-sm">
            {(["pinned", "todo", "done"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filters.view === value}
                onClick={() =>
                  onGo({ ...location, filters: { ...filters, view: value } })
                }
                className={`flex items-center px-3 capitalize ${
                  filters.view === value
                    ? "bg-brand text-brand-ink"
                    : "text-muted hover:bg-surface"
                }`}
              >
                {value}
              </button>
            ))}
          </div>

          <Button
            onClick={() => setSelection(selection ? null : [])}
            aria-pressed={selection !== null}
          >
            {selection ? "Cancel" : "Select"}
          </Button>
        </div>

        <div className="mt-3">
          <TagCloud
            tags={tags.data?.tags ?? []}
            selected={filters.tags}
            onToggle={toggleTag}
          />
        </div>

        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate(title);
          }}
        >
          <TextField
            placeholder="New task"
            className="min-w-0 flex-1"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Button
            type="submit"
            variant="solid"
            disabled={create.isPending || !title.trim()}
          >
            Add
          </Button>
        </form>
        {error ? <p className="mt-2 text-sm text-accent">{error}</p> : null}
      </div>

      {/* Its own row rather than an overlay: it is the same two pixels whatever is under it,
          and it moves nothing on the way in or out. */}
      <div className="h-0.5 shrink-0 overflow-hidden" aria-hidden="true">
        {stale ? (
          <div className="h-full w-full animate-pulse bg-brand" />
        ) : null}
      </div>

      <div
        ref={scroller}
        className="md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain"
      >
        <div
          className={`mx-auto w-full max-w-3xl px-3 pb-4 md:px-6 ${
            stale ? "opacity-60" : ""
          }`}
          aria-busy={stale}
        >
          {tasks.length === 0 && !stale ? (
            // Two states, because they mean two different things: one is about the account and is
            // true exactly once; the other is about the filter sitting above it.
            <p className="mt-8 text-center text-sm text-muted">
              {filtered ? "Nothing matched" : "No tasks yet"}
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  selectable={selection !== null}
                  selected={selection?.includes(task.id) ?? false}
                  onSelect={(id) =>
                    setSelection((current) =>
                      current?.includes(id)
                        ? current.filter((x) => x !== id)
                        : [...(current ?? []), id],
                    )
                  }
                  onOpen={(id) =>
                    onGo({ ...location, route: { name: "task", id } })
                  }
                  onToggleDone={(t) => toggleDone.mutate(t)}
                  onTogglePinned={(t) => togglePinned.mutate(t)}
                />
              ))}
            </ul>
          )}

          {/* A search turns pagination off, so the button is not drawn while the box has
          something in it. */}
          {list.data?.next_cursor && !filters.q ? (
            <div className="mt-4 flex justify-center">
              <Button
                onClick={() =>
                  getTasks({ ...params, cursor: list.data.next_cursor }).then(
                    () => client.invalidateQueries({ queryKey: qk.tasks }),
                  )
                }
              >
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {selection ? (
        <BulkBar
          ids={selection}
          view={filters.view}
          onDone={() => {
            setSelection(null);
            client.invalidateQueries({ queryKey: qk.tasks });
            client.invalidateQueries({ queryKey: qk.tags });
          }}
        />
      ) : null}

      {route.name === "task" ? (
        <TaskDialog
          id={route.id}
          onClose={() => onClose({ ...location, route: { name: "list" } })}
          onOpen={(id) => onGo({ ...location, route: { name: "task", id } })}
        />
      ) : null}
    </div>
  );
}
