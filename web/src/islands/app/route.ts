import { useEffect, useState } from "react";

/**
 * The URL is the application's state, not a decoration on it.
 *
 * Three routes, one parameter, and a query string no router manages anyway — about sixty lines
 * against a dependency wanting configuration of the same size. The trigger for revisiting is
 * the first route needing a nested layout or a segment worth loading lazily.
 */
export type Route =
  { name: "list" } | { name: "task"; id: string } | { name: "settings" };

/**
 * Which list is on screen.
 *
 * Not the API's status, which is todo, done or all: pinned is a property a todo may have, so
 * the screen's third choice is a view over the same list rather than a fourth state a task
 * can be in.
 */
export type View = "pinned" | "todo" | "done";

export type Filters = {
  /** A flat and() of slugs. Anything richer came from outside and is dropped. */
  tags: string[];
  view: View;
  q: string;
};

export type Location = { route: Route; filters: Filters };

/** Marks the entries this island pushed, so back can be told from a deep link. */
const MARK = "taskio";

export function read(): Location {
  const url = new URL(window.location.href);
  return {
    route: readRoute(url.pathname),
    filters: readFilters(url.searchParams),
  };
}

function readRoute(path: string): Route {
  if (path === "/settings") return { name: "settings" };
  const task = /^\/t\/([0-9a-zA-Z]{4,8})$/.exec(path);
  if (task?.[1]) return { name: "task", id: task[1].toLowerCase() };
  return { name: "list" };
}

function readFilters(params: URLSearchParams): Filters {
  const view = params.get("view");
  return {
    tags: parseAnd(params.get("tags")),
    view: view === "done" || view === "pinned" ? view : "todo",
    q: params.get("q") ?? "",
  };
}

/**
 * The app never writes anything but an unnested and() into the URL, so a value that is not that
 * shape can only have come from outside — typed into the address bar, or pasted from something
 * an agent wrote. It is dropped, and the URL rewritten, so the address bar never shows a filter
 * that is not in effect.
 *
 * Much smaller than the server's parser, and deliberately: porting the whole grammar would mean
 * two implementations of or, not and nesting that have to agree forever, to support a screen
 * that cannot draw any of it.
 */
export function parseAnd(raw: string | null): string[] {
  if (!raw) return [];
  const slug = /^[a-z0-9_-]{1,40}$/;
  const inner = /^and\((.*)\)$/s.exec(raw.trim());
  const parts = (inner?.[1] ?? raw.trim()).split(",").map((s) => s.trim());
  if (parts.some((p) => !slug.test(p))) return [];
  return [...new Set(parts)];
}

/** The canonical spelling, which is what goes back into the URL. */
export function printAnd(tags: string[]): string {
  if (tags.length === 0) return "";
  return tags.length === 1 ? `and(${tags[0]})` : `and(${tags.join(",")})`;
}

/** What the tab is called with nothing lit. */
const NAME = "taskio";

/**
 * What the tab says.
 *
 * The lit tags and nothing else. A tab is worth naming when it is one of several, and what
 * makes one of these different from another is the filter — the view and the search box are
 * things somebody is doing right now rather than a place they have parked.
 *
 * "and" between them because that is what the filter means, and what the pills spell into the
 * URL: these are tasks carrying every one of them, not any.
 */
export function title(location: Location): string {
  const { tags } = location.filters;
  return tags.length > 0 ? `${tags.join(" and ")} :: ${NAME}` : NAME;
}

export function href(location: Location): string {
  const path =
    location.route.name === "task"
      ? `/t/${location.route.id}`
      : location.route.name === "settings"
        ? "/settings"
        : "/";

  const params = new URLSearchParams();
  const tags = printAnd(location.filters.tags);
  if (tags) params.set("tags", tags);
  if (location.filters.view !== "todo")
    params.set("view", location.filters.view);
  if (location.filters.q) params.set("q", location.filters.q);

  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

/**
 * useLocation keeps the URL and the screen in step.
 *
 * go pushes; replace does not. Typing into the search box replaces, so a five-letter query is
 * one entry to press back through rather than five.
 */
/**
 * The element the list scrolls inside, once it has one.
 *
 * Above the breakpoint the page does not scroll: the rail and the controls stay put and only
 * the list moves, which means window.scrollY is always 0 and is no longer where somebody is.
 * Below it the page scrolls as it always did, so both are read and whichever is not zero is
 * the answer — there is only ever one of them scrolling.
 */
let scroller: HTMLElement | null = null;

export function setScroller(el: HTMLElement | null) {
  scroller = el;
}

function scrollOffset(): number {
  return scroller?.scrollTop || window.scrollY;
}

/** Puts a list back where it was. Both, because which one moves depends on the width. */
export function scrollToOffset(offset: number) {
  scroller?.scrollTo(0, offset);
  window.scrollTo(0, offset);
}

export function useLocation() {
  const [location, setLocation] = useState<Location>(read);

  useEffect(() => {
    const onPop = () => setLocation(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Here rather than at a call site: the tab is a view of the location like the address bar is,
  // and one kept in step by whoever remembers to is one that falls behind.
  useEffect(() => {
    document.title = title(location);
  }, [location]);

  const go = (next: Location) => {
    const scroll = scrollOffset();
    // Written into the entry we are leaving, so coming back can restore it: the browser does
    // this for free on a real navigation and not at all for a pushState one.
    window.history.replaceState({ ...window.history.state, scroll }, "");
    window.history.pushState({ mark: MARK, scroll: 0 }, "", href(next));
    setLocation(next);
  };

  const replace = (next: Location) => {
    window.history.replaceState(
      { ...window.history.state, mark: MARK },
      "",
      href(next),
    );
    setLocation(next);
  };

  /**
   * Returning to a screen we pushed from calls back(), not push. Without it, opening and
   * closing four tasks leaves eight entries for the system gesture to walk through before it
   * can leave the app.
   *
   * A deep link straight to a task has nothing behind it, so that case pushes the list rather
   * than reversing out of taskio entirely.
   */
  const close = (fallback: Location) => {
    if (window.history.state?.mark === MARK) window.history.back();
    else go(fallback);
  };

  return { location, go, replace, close };
}

/** The scroll offset stored on the entry being returned to. */
export function storedScroll(): number {
  const value = window.history.state?.scroll;
  return typeof value === "number" ? value : 0;
}
