import { describe, expect, it } from "vitest";

import { excerpt, render } from "@app/markdown";

/** Breaks read back as newlines, so a test can say where the lines fall. */
const plain = (source: string, limit?: number) =>
  excerpt(source, limit)
    .map((piece) => (piece.br ? "\n" : piece.text))
    .join("");

describe("render", () => {
  /**
   * The description is not always written by the person reading it: an agent summarising a web
   * page into one is a path from untrusted text to this screen.
   */
  it("strips script however it arrives", () => {
    for (const source of [
      "<script>alert(1)</script>",
      '<img src="x" onerror="alert(1)">',
      "[click](javascript:alert(1))",
      '<a href="javascript:alert(1)">click</a>',
    ]) {
      const html = render(source);
      expect(html).not.toContain("<script");
      expect(html).not.toContain("onerror");
      expect(html).not.toContain("javascript:");
    }
  });

  it("renders ordinary markdown", () => {
    expect(render("# Title")).toContain("<h1>Title</h1>");
    expect(render("- one\n- two")).toContain("<li>one</li>");
  });

  /** A mention becomes a link; an email address does not. */
  it("turns @id into a chip and leaves an address alone", () => {
    expect(render("See @8qw4tz9k")).toContain('href="/t/8qw4tz9k"');
    expect(render("misha@8qw4tz9k")).not.toContain('href="/t/');
  });

  it("keeps an image, which is the whole point of the editor", () => {
    expect(render("![](/api/assets/a_01j9z)")).toContain("<img");
  });
});

describe("excerpt", () => {
  it("takes the syntax off", () => {
    expect(plain("Ask about the **evening** slots.")).toBe(
      "Ask about the evening slots.",
    );
    expect(plain("A `code` word")).toBe("A code word");
  });

  /** The row clamps to two lines, so a second line is worth being a second line. */
  it("keeps a line break as a break", () => {
    expect(plain("First line\n\nSecond line")).toBe("First line\nSecond line");
    expect(plain("Soft break\nsecond line")).toBe("Soft break\nsecond line");
    expect(plain("# Heading\n\nAnd a paragraph")).toBe(
      "Heading\nAnd a paragraph",
    );
  });

  it("puts no break at either end", () => {
    expect(plain("One line only")).toBe("One line only");
    expect(plain("\nOne line only\n")).toBe("One line only");
    expect(excerpt("Trailing\n\n").filter((p) => p.br)).toEqual([]);
  });

  /** A description is often mostly a link, and one reduced to its text says nothing. */
  it("keeps a link a link", () => {
    expect(excerpt("See [the notes](https://example.com/x) first")).toEqual([
      { text: "See " },
      { text: "the notes", href: "https://example.com/x" },
      { text: " first" },
    ]);
  });

  it("links a bare url too", () => {
    const pieces = excerpt("Read https://example.com/x today");
    expect(pieces[1]).toEqual({
      text: "https://example.com/x",
      href: "https://example.com/x",
    });
  });

  // marked stopped sanitising hrefs, and the row must not render one a click would run.
  it("keeps the words but drops an href a browser should not follow", () => {
    expect(excerpt("[click](javascript:alert(1))")).toEqual([
      { text: "click" },
    ]);
  });

  // A pasted image is a data URI long enough to be the whole excerpt on its own.
  it("drops images rather than reading their alt text", () => {
    expect(
      plain("Before ![a screenshot](data:image/png;base64,AAAA) after"),
    ).toBe("Before after");
  });

  // marked keeps a list's children under items, which a walk over tokens alone steps over.
  it("reads a bulleted description, a line per bullet", () => {
    expect(plain("- Website for the tools\n- And a second line")).toBe(
      "Website for the tools\nAnd a second line",
    );
  });

  // A bound on what reaches the DOM. What is shown is the clamp's business, not this one's.
  it("caps what it hands to the row", () => {
    expect(plain("x".repeat(400), 50)).toBe("x".repeat(50));
  });

  it("is empty for an empty description", () => {
    expect(excerpt("")).toEqual([]);
  });
});
