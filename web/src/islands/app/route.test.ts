import { describe, expect, it } from "vitest";

import { href, parseAnd, printAnd } from "@app/islands/app/route";

/**
 * The app's parser only has to recognise one shape. Everything else is "not drawable", which is
 * what the drop rule acts on.
 */
describe("parseAnd", () => {
  it("reads what the app writes", () => {
    expect(parseAnd("and(home,chores)")).toEqual(["home", "chores"]);
    expect(parseAnd("and(home)")).toEqual(["home"]);
    expect(parseAnd("home")).toEqual(["home"]);
    expect(parseAnd("and( home , chores )")).toEqual(["home", "chores"]);
  });

  it("drops anything the pills cannot draw", () => {
    // The server accepts every one of these; this screen cannot represent them.
    expect(parseAnd("or(home,work)")).toEqual([]);
    expect(parseAnd("not(work)")).toEqual([]);
    expect(parseAnd("and(home,not(work))")).toEqual([]);
    expect(parseAnd("and(Home)")).toEqual([]);
    expect(parseAnd("")).toEqual([]);
    expect(parseAnd(null)).toEqual([]);
  });

  it("collapses a repeated tag", () => {
    expect(parseAnd("and(home,home)")).toEqual(["home"]);
  });
});

describe("href", () => {
  const filters = { tags: [] as string[], view: "todo" as const, q: "" };

  it("leaves defaults out of the URL", () => {
    expect(href({ route: { name: "list" }, filters })).toBe("/");
  });

  // Three choices on screen, and todo is the one the URL says nothing about.
  it("names the view it is showing, unless it is the default", () => {
    expect(
      href({
        route: { name: "list" },
        filters: { ...filters, view: "pinned" },
      }),
    ).toBe("/?view=pinned");
    expect(
      href({ route: { name: "list" }, filters: { ...filters, view: "done" } }),
    ).toBe("/?view=done");
    expect(href({ route: { name: "list" }, filters })).toBe("/");
  });

  it("carries the pills and the view", () => {
    expect(
      href({
        route: { name: "list" },
        filters: { ...filters, tags: ["home", "chores"], view: "done" },
      }),
    ).toBe("/?tags=and%28home%2Cchores%29&view=done");
  });

  it("writes the whole id into the path, never a prefix", () => {
    const url = href({ route: { name: "task", id: "8qw4tz9k" }, filters });
    expect(url).toBe("/t/8qw4tz9k");
  });

  it("round-trips the canonical filter spelling", () => {
    expect(parseAnd(printAnd(["home", "chores"]))).toEqual(["home", "chores"]);
  });
});
