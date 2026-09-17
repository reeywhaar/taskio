import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  postTasksByIdDone,
  postTasksByIdTodo,
} from "@app/api/actions/tasks";
import type { Task } from "@app/api/types";
import { qk } from "@app/api/keys";
import { optimisticTask, restoreTasks } from "@app/api/optimistic";
import { useLive } from "@app/api/live";
import { Button } from "@app/components/Button";
import { SearchIcon } from "@app/components/icons/Icon";
import { TextField } from "@app/components/TextField";
import { Nav } from "@app/islands/app/Nav";
import { TagCloud } from "@app/islands/app/TagCloud";
import { rank, TaskRow } from "@app/islands/app/TaskRow";
import { NewTaskDialog } from "@app/islands/app/NewTaskDialog";
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
  const { view } = filters;
  const [selection, setSelection] = useState<string[] | null>(null);
  const [writing, setWriting] = useState(false);

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

  // Both draw the answer first and send it after: one bit, and a button that waits a round
  // trip to show it is a button somebody presses twice.
  const toggleDone = useMutation({
    mutationFn: (task: Task) =>
      task.status === "done"
        ? postTasksByIdTodo(task.id)
        : postTasksByIdDone(task.id),
    onMutate: (task) =>
      optimisticTask(client, task.id, (t) => ({
        ...t,
        status: t.status === "done" ? "todo" : "done",
      })),
    onError: (_err, _task, before) => before && restoreTasks(client, before),
    onSettled: () => client.invalidateQueries({ queryKey: qk.tasks }),
  });

  const togglePinned = useMutation({
    mutationFn: (task: Task) =>
      patchTasksById(task.id, { pinned: !task.pinned }),
    onMutate: (task) => {
      follow.current = { id: task.id, from: tasks.indexOf(task) };
      // The list on screen is put in its new order here, so the row travels on the press
      // rather than on the answer.
      return optimisticTask(
        client,
        task.id,
        (t) => ({ ...t, pinned: !t.pinned }),
        view === "done" ? undefined : qk.taskList(JSON.stringify(params)),
      );
    },
    onError: (_err, _task, before) => before && restoreTasks(client, before),
    onSettled: () => client.invalidateQueries({ queryKey: qk.tasks }),
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

  /*
   * A pinned task travels, and the view goes with it and says so.
   *
   * The row is already where it is going by the time this runs, because the press put it there
   * rather than the answer — so there is one rearrangement to watch and one place to scroll to,
   * on the render straight after the click.
   */
  const follow = useRef<{ id: string; from: number } | null>(null);
  useLayoutEffect(() => {
    const going = follow.current;
    if (!going) return;
    follow.current = null;

    const now = tasks.findIndex((task) => task.id === going.id);
    if (now === -1 || now === going.from) return;

    const row = scroller.current?.querySelector(`[data-task="${going.id}"]`);
    if (!(row instanceof HTMLElement)) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Legible rather than instant: the point is seeing where it went.
    row.scrollIntoView({
      block: "nearest",
      behavior: still ? "auto" : "smooth",
    });
    // And a flash on arrival, because a row that has moved looks like every other row.
    //
    // Taken off again as soon as it has played. A class left behind replays every time the row
    // is reordered — the browser restarts a CSS animation on an element that is taken out of
    // the DOM and put back, which reordering does — so rows pinned earlier flash along with
    // the one being pinned now. The timer is for reduced motion, where the animation is turned
    // off and animationend never comes.
    row.classList.remove("flash");
    void row.offsetWidth; // restart it, if the same row is pinned twice
    row.classList.add("flash");
    const done = () => row.classList.remove("flash");
    row.addEventListener("animationend", done, { once: true });
    window.setTimeout(done, 1200);
  }, [tasks]);

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

        {/* Apart rather than adjacent: the segments choose which list this is, and Select begins
          doing something to it. Side by side they read as four of a kind. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex min-h-9 overflow-hidden rounded-md border-[1.5px] border-line text-sm pointer-coarse:min-h-11">
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
              size="bar"
              onClick={() => setSelection(selection ? null : [])}
              aria-pressed={selection !== null}
            >
              {selection ? "Cancel" : "Select"}
            </Button>
          </div>

          <Button variant="solid" size="bar" onClick={() => setWriting(true)}>
            New task
          </Button>
        </div>

        <div className="mt-3">
          <TagCloud
            tags={tags.data?.tags ?? []}
            selected={filters.tags}
            onToggle={toggleTag}
            onOnly={(slug) =>
              onGo({ ...location, filters: { ...filters, tags: [slug] } })
            }
          />
        </div>
      </div>

      {/* Its own row rather than an overlay: it is the same two pixels whatever is under it,
          and it moves nothing on the way in or out. */}
      <div className="h-0.5 shrink-0 overflow-hidden" aria-hidden="true">
        {stale ? <div className="pulse h-full w-full" /> : null}
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
              {tasks.map((task, i) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  // A wider gap where the run changes, so the bands are something to see
                  // rather than something to work out by reading down the column.
                  apart={i > 0 && rank(tasks[i - 1]!) !== rank(task)}
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

      {/* Opened with whatever pills are lit: filtering to home and pressing new task means a
          home task, and typing the word again is work the screen knows the answer to. */}
      <NewTaskDialog
        open={writing}
        tags={filters.tags}
        onClose={() => setWriting(false)}
      />

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
