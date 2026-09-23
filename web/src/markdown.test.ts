import { marked } from "marked";
import { afterEach, describe, expect, it, vi } from "vitest";

import { excerpt, render, toggleCheck } from "@app/markdown";

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

describe("toggleCheck", () => {
  const list = "- [ ] one\n- [x] two\n- plain\n1. [ ] three\n";

  it("flips the nth box and leaves the rest alone", () => {
    expect(toggleCheck(list, 0)).toContain("- [x] one");
    expect(toggleCheck(list, 0)).toContain("- [x] two");
    expect(toggleCheck(list, 1)).toContain("- [ ] two");
    // Plain items are not boxes, so the numbered one is the third.
    expect(toggleCheck(list, 2)).toContain("1. [x] three");
  });

  it("does nothing when there is no such box", () => {
    expect(toggleCheck(list, 9)).toBe(list);
  });
});

describe("render", () => {
  it("draws a task list as something that can be ticked", () => {
    const html = render("- [ ] one\n- [x] two\n");
    expect(html).toContain('data-check="0"');
    expect(html).toContain('data-check="1"');
    expect(html).toContain('aria-checked="true"');
    // marked's own disabled input is stripped; the box is ours.
    expect(html).not.toContain("<input");
  });

  /** An item holding blocks used to throw, and the throw took the whole page with it. */
  it("renders a list item holding a code block, a nested list and paragraphs", () => {
    const html = render(
      "1. Run it:\n\n   ```sh\n   make\n   ```\n\n2. Then:\n   - [ ] check\n\n   More.\n",
    );
    expect(html).toContain("<code");
    expect(html).toContain("make");
    expect(html).toContain('data-check="0"');
    expect(html).toContain("More.");
    expect(html).not.toContain("<input");
  });

  it("draws a loose task list's box without marked's input", () => {
    const html = render("- [x] one\n\n- [ ] two\n");
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain("<input");
  });
});

/**
 * The next thing marked cannot render costs the block it is in, not the description. marked is
 * made to throw on anything containing BOOM, which is what a bug in it looks like from here.
 */
describe("render, when marked throws", () => {
  const breaking = () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const real = marked.parser.bind(marked);
    return vi.spyOn(marked, "parser").mockImplementation((tokens, options) => {
      if (JSON.stringify(tokens).includes("BOOM")) throw new Error("marked");
      return real(tokens, options);
    });
  };
  afterEach(() => vi.restoreAllMocks());

  it("shows the bad block as its source and renders the rest", () => {
    breaking();
    const html = render(
      "# Before\n\nThis has BOOM <b>in</b> it\n\nAfter **all**\n",
    );
    expect(html).toContain("<h1>Before</h1>");
    expect(html).toContain("<strong>all</strong>");
    expect(html).toContain('class="unrendered"');
    // As text: the source's own tags do not become markup on the way.
    expect(html).toContain("This has BOOM &lt;b&gt;in&lt;/b&gt; it");
  });

  it("loses only the bad item of a list", () => {
    breaking();
    const html = render("3. one\n4. BOOM two\n5. three\n");
    expect(html).toContain('<ol start="3">');
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>three</li>");
    expect(html.match(/<ol/g)).toHaveLength(1);
    expect(html).toContain("BOOM two");
  });

  /** Lexed as a whole, so a reference and its definition find each other across blocks. */
  it("keeps the context of the whole description", () => {
    const html = render(
      "See [the notes][n].\n\n[n]: https://example.com/notes\n",
    );
    expect(html).toContain('href="https://example.com/notes"');
  });
});
