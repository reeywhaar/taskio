import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { getTags, putTagsOrder } from "@app/api/actions/tags";
import {
  getTasks,
  patchTasksById,
  postTasksByIdDone,
  postTasksByIdTodo,
} from "@app/api/actions/tasks";
import type { Tag, Task } from "@app/api/types";
import { qk } from "@app/api/keys";
import { optimisticTask, restoreTasks } from "@app/api/optimistic";
import { useLive } from "@app/api/live";
import { Button } from "@app/components/Button";
import { Segmented } from "@app/components/Segmented";
import { CrossIcon, SearchIcon } from "@app/components/icons/Icon";
import { TextField } from "@app/components/TextField";
import { Nav } from "@app/islands/app/Nav";
import { TagCloud } from "@app/islands/app/TagCloud";
import { rank, TaskRow } from "@app/islands/app/TaskRow";
import { NewTaskDialog } from "@app/islands/app/NewTaskDialog";
import { TaskDialog } from "@app/islands/app/TaskDialog";
import { BulkBar } from "@app/islands/app/BulkBar";
import { Elsewhere } from "@app/islands/app/Elsewhere";
import { Settings } from "@app/islands/app/Settings";
import {
  printAnd,
  scrollToOffset,
  setScroller,
  storedScroll,
  useLocation,
  type Filters,
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
  /**
   * The bar is on its way out.
   *
   * It cannot delay its own unmount, so the selection is held here until the bar reports its
   * animation over — otherwise the element is gone the frame after the press and there is
   * nothing left to slide anywhere.
   */
  const [leaving, setLeaving] = useState(false);
  /**
   * How much room the list keeps at the end of itself for the bar standing over it.
   *
   * The bar floats: the list runs the full height of the window and its rows pass under it, so
   * without this the last of them cannot be scrolled out from under it. Reported by the bar
   * rather than written down here, because it wraps at narrow widths.
   */
  const [barHeight, setBarHeight] = useState(0);
  const stopPicking = () => setLeaving(true);
  /** The new-task dialog: null when shut, and otherwise the title it opens with. */
  const [writing, setWriting] = useState<string | null>(null);

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

  /**
   * The same search with nothing narrowing it, for what the filter is hiding.
   *
   * One request rather than one per section: every match on the account comes back and the ids
   * already on screen are taken out of it, so the two groups below the list are two slices of
   * one answer rather than two more round trips.
   *
   * Only once the bottom of the list is in view. Somebody who found what they wanted in the
   * first three rows never asks the question, and the answer is a whole-account scan.
   */
  const [deep, setDeep] = useState(false);
  const wider = useQuery({
    queryKey: qk.taskList(JSON.stringify({ q: filters.q, everywhere: true })),
    queryFn: () => getTasks({ q: filters.q, status: "all" }),
    enabled: filters.q !== "" && deep,
    placeholderData: keepPreviousData,
  });

  // The browser restores scroll on a real navigation and not at all on a pushState one, so
  // closing a task on a long list would otherwise drop somebody at the top of it.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setScroller(scroller.current);
    return () => setScroller(null);
  }, []);

  // A new search is a new question, and the old answer is not an answer to it.
  useEffect(() => setDeep(false), [filters.q]);

  /**
   * The foot of the list, watched rather than measured: a scroll handler asking where it is on
   * every frame is the same question answered worse.
   *
   * Not while the list is still coming. An empty page has its foot at the top of the window, so
   * an observer attached then reports the bottom as reached before there is a list to reach the
   * bottom of — which is how a lazy request fires on every search, immediately, and lazily only
   * in the comment above it.
   *
   * Rebuilt per search rather than kept, because a new observer reports what it sees when it
   * starts. Without that, a search whose results are short enough to leave the foot in view
   * would wait for an intersection that has already happened and will not happen again.
   */
  const foot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = foot.current;
    if (!el || list.isPending) return;
    const eye = new IntersectionObserver(
      ([seen]) => seen?.isIntersecting && setDeep(true),
      // A little before it arrives, so the answer is usually there by the time it does.
      { root: scroller.current, rootMargin: "200px" },
    );
    eye.observe(el);
    return () => eye.disconnect();
  }, [filters.q, list.isPending]);
  useEffect(() => {
    if (route.name === "list" && list.data) {
      const offset = storedScroll();
      if (offset) scrollToOffset(offset);
    }
  }, [route.name, list.data]);

  // Both draw the answer first and send it after: one bit, and a button that waits a round
  // trip to show it is a button somebody presses twice.
  // Only a todo goes forward; done and deleted both come back. There is no verb for putting
  // a deleted task in the done pile, because nobody has ever wanted one.
  const toggleDone = useMutation({
    mutationFn: (task: Task) =>
      task.status === "todo"
        ? postTasksByIdDone(task.id)
        : postTasksByIdTodo(task.id),
    onMutate: (task) =>
      optimisticTask(client, task.id, (t) => ({
        ...t,
        status: t.status === "todo" ? "done" : "todo",
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

  /**
   * The arrangement is drawn before the server has it, because the pill is already where the
   * finger let go of it — putting it back for one round trip is the cloud arguing with what
   * somebody just did.
   */
  const arrange = useMutation({
    mutationFn: (slugs: string[]) => putTagsOrder({ slugs }),
    onMutate: (slugs) => {
      const before = client.getQueryData<{ tags: Tag[] }>(qk.tags);
      if (before) {
        const by = new Map(before.tags.map((tag) => [tag.slug, tag]));
        client.setQueryData(qk.tags, {
          tags: slugs.flatMap((slug) => by.get(slug) ?? []),
        });
      }
      return before;
    },
    onError: (_err, _slugs, before) =>
      before && client.setQueryData(qk.tags, before),
    onSettled: () => client.invalidateQueries({ queryKey: qk.tags }),
  });

  const toggleTag = (slug: string) => {
    const next = filters.tags.includes(slug)
      ? filters.tags.filter((s) => s !== slug)
      : [...filters.tags, slug];
    onGo({ ...location, filters: { ...filters, tags: next } });
  };

  const tasks = list.data?.tasks ?? [];
  // Replaces rather than pushes, like the typing that filled it: clearing a five-letter query
  // should not be a sixth entry to press back through.
  const clearSearch = () =>
    onReplace({ ...location, filters: { ...filters, q: "" } });
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
    <div className="relative flex flex-col md:min-h-0 md:flex-1">
      {/*
        What asks the question stays put and what answers it scrolls. The head is short and is
        needed at any point in a long list — it is the query that produced what is under it.

        Full width with the column inside, rather than a scrolling column, so the scrollbar is
        at the edge of the window where a scrollbar belongs.
      */}
      <div className="mx-auto w-full max-w-3xl shrink-0 px-3 py-3 md:px-6 md:py-4">
        {/* Search, status, tags, list: it narrows from the widest instrument to the narrowest,
            so reading down the screen is reading the query that produced what is under it. */}
        {/* The icon says what the box is for without spending the placeholder on it, and stays
          there once somebody has typed and the placeholder is gone. */}
        <span className="relative flex items-center">
          <SearchIcon className="pointer-events-none absolute left-3 text-faint" />
          <TextField
            type="search"
            placeholder="Search"
            // The browser draws its own clear button inside a search field, in its own place and
            // at its own size, and only on some of them. One of ours, everywhere.
            className="w-full pr-10 pl-9 [&::-webkit-search-cancel-button]:hidden"
            value={filters.q}
            // Replaces rather than pushes, so a five-letter query is one entry to press back
            // through rather than five.
            onChange={(e) =>
              onReplace({
                ...location,
                filters: { ...filters, q: e.target.value },
              })
            }
            // Escape is what a search field does everywhere, and half the browsers that draw
            // their own clear button wire it up. It is a keystroke away from the caret, which
            // is where the hand already is.
            onKeyDown={(e) => e.key === "Escape" && clearSearch()}
          />
          {filters.q ? (
            <button
              type="button"
              aria-label="Clear the search"
              onClick={clearSearch}
              className="absolute right-2 rounded-md p-1.5 text-faint hover:bg-fill hover:text-fg"
            >
              <CrossIcon />
            </button>
          ) : null}
        </span>

        {/* Apart rather than adjacent: the segments choose which list this is, and Select begins
          doing something to it. Side by side they read as four of a kind. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5 sm:gap-2">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <Segmented
              label="Which list"
              value={filters.view}
              options={["pinned", "todo", "done"] as const}
              onChange={(next) =>
                onGo({ ...location, filters: { ...filters, view: next } })
              }
            />

            <Button
              size="bar"
              onClick={() => (selection ? stopPicking() : setSelection([]))}
              aria-pressed={selection !== null}
            >
              {selection ? "Cancel" : "Select"}
            </Button>
          </div>

          <Button variant="solid" size="bar" onClick={() => setWriting("")}>
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
            onReorder={(slugs) => arrange.mutate(slugs)}
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
            <Empty
              filters={filters}
              onClear={(next) => onGo({ ...location, filters: next })}
              onWrite={(title) => setWriting(title)}
            />
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {tasks.map((task, i) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  // A wider gap where the run changes, so the bands are something to see
                  // rather than something to work out by reading down the column.
                  //
                  // Not in the finished list, which is one run: it is ordered by when things
                  // were finished and by nothing else, so a band drawn where the pin or the
                  // number changes is a line across a list that is not sorted by either.
                  apart={
                    filters.view !== "done" &&
                    i > 0 &&
                    rank(tasks[i - 1]!) !== rank(task)
                  }
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

          {/* Watched rather than measured, and below the list rather than after it: what marks
              the foot is where the rows end, whether there were twenty of them or none. */}
          <div ref={foot} aria-hidden="true" />

          {filters.q ? (
            <Elsewhere
              found={wider.data?.tasks ?? []}
              shown={tasks}
              view={filters.view}
              waiting={deep && wider.isPending}
              onOpen={(id) =>
                onGo({ ...location, route: { name: "task", id } })
              }
            />
          ) : null}

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

          {/* Room for the bar, at the very end of what scrolls and nowhere else.

              It sat above the results from elsewhere and the Load more button, which are content
              like any other: a search made with the bar up put rows below it that no amount of
              scrolling could reach. */}
          <div
            aria-hidden="true"
            // Closing over the same 180ms the bar takes to go, so the list comes up to meet it
            // rather than finding the room gone once it has left.
            className="transition-[height] duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
            style={{ height: barHeight }}
          />
        </div>
      </div>

      {selection ? (
        <BulkBar
          ids={selection}
          chosen={tasks.filter((task) => selection.includes(task.id))}
          tags={tags.data?.tags ?? []}
          view={filters.view}
          leaving={leaving}
          onLeft={() => {
            setLeaving(false);
            setSelection(null);
          }}
          onHeight={setBarHeight}
          onCancel={stopPicking}
          onDone={() => {
            stopPicking();
            client.invalidateQueries({ queryKey: qk.tasks });
            client.invalidateQueries({ queryKey: qk.tags });
          }}
        />
      ) : null}

      {/* Opened with whatever pills are lit: filtering to home and pressing new task means a
          home task, and typing the word again is work the screen knows the answer to. The
          title comes the same way from a search that found nothing.

          The search is cleared when a task is actually written, not when the dialog opens:
          somebody who changes their mind and closes it has their words back, and somebody who
          goes through with it is not left filtering the list by the title of the one task they
          just made. */}
      <NewTaskDialog
        open={writing !== null}
        tags={filters.tags}
        title={writing ?? ""}
        onClose={() => setWriting(null)}
        onCreated={() => onGo({ ...location, filters: { ...filters, q: "" } })}
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

/**
 * An empty list, and why.
 *
 * "No tasks yet" under a filter is a sentence that is not true, and somebody reading it has to
 * look back up at the bar to work out what they did — so the emptiness names what is narrowing
 * the list and offers to undo exactly that, rather than a general reset that might clear
 * something they meant to keep.
 *
 * Four of them, because they mean four different things: the account is empty, which is true
 * once; the search matched nothing; the tags match nothing; or a view of the same list happens
 * to have nothing in it, which is not a filter to clear.
 */
function Empty({
  filters,
  onClear,
  onWrite,
}: {
  filters: Filters;
  onClear: (next: Filters) => void;
  /** What was searched for, on its way to being the title of a task instead. */
  onWrite: (title: string) => void;
}) {
  const searching = filters.q !== "";
  const tagged = filters.tags.length > 0;

  if (!searching && !tagged) {
    return (
      <p className="mt-8 text-center text-sm text-muted">
        {filters.view === "pinned"
          ? "Nothing is pinned."
          : filters.view === "done"
            ? "Nothing finished yet."
            : "No tasks yet."}
      </p>
    );
  }

  // The label says what pressing it takes away, so nobody has to press it to find out — and
  // it takes away one thing. Clearing the tags as well threw away the part of the filter
  // somebody had set deliberately along with the part they had just mistyped.
  const what = searching ? "the search" : "the tags";

  return (
    <div className="mt-8 flex flex-col items-center gap-3">
      <p className="text-sm text-muted">
        Nothing matched{" "}
        {searching ? <b className="text-fg">{filters.q}</b> : null}
        {searching && tagged ? " under " : null}
        {tagged ? <b className="text-fg">{filters.tags.join(", ")}</b> : null}.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {/* A search that matched nothing is usually a task somebody has written into the
            wrong box. The words are already typed; this is the shortest way from there to a
            task, and it carries the lit tags along like any other new task. */}
        {searching ? (
          <Button variant="solid" onClick={() => onWrite(filters.q)}>
            Create a task
          </Button>
        ) : null}
        <Button
          onClick={() =>
            onClear({
              ...filters,
              q: "",
              tags: searching ? filters.tags : [],
            })
          }
        >
          Clear {what}
        </Button>
      </div>
    </div>
  );
}
