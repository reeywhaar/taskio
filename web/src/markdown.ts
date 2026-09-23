import DOMPurify from "dompurify";
import { marked, type Token } from "marked";

/**
 * One renderer, configured once.
 *
 * Raw HTML is off in the parser as well as stripped by the sanitiser. Belt and braces, because
 * the description is not always written by the person reading it: a token-wielding agent
 * summarising a web page into one is a path from untrusted text to this screen.
 */
marked.setOptions({ gfm: true, breaks: true });

/**
 * A task list item, drawn as something that can be ticked.
 *
 * marked emits a disabled <input>, which the sanitiser strips — rightly, since a description is
 * not always written by the person reading it. So the box is ours: a span the stylesheet draws,
 * on an item that says which state it is in and where in the source it came from.
 */
marked.use({
  renderer: {
    // The box below stands in for it.
    checkbox: () => "",
    listitem(token) {
      // parse, not parseInline: an item can hold blocks — a fenced code block, a nested list,
      // paragraphs — and parseInline throws on the first one, which took the whole page down.
      const inner = this.parser.parse(token.tokens);
      if (!token.task) return `<li>${inner}</li>`;
      return (
        `<li class="check" role="checkbox" tabindex="0"` +
        ` aria-checked="${token.checked ? "true" : "false"}"` +
        ` data-check="${token.checked ? 1 : 0}">` +
        `<span class="box" aria-hidden="true"></span>${inner}</li>`
      );
    },
  },
});

/** Every `- [ ]` and `- [x]` in a description, in the order they are rendered in. */
const marker = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\])/gm;

/**
 * Flips the nth checkbox in the source and gives the text back.
 *
 * The source is what is stored, so a tick has to be written where it was read from rather than
 * held beside it — and by position, because two identical lines are two identical lines.
 */
export function toggleCheck(source: string, index: number): string {
  let at = 0;
  return source.replace(
    marker,
    (whole, lead: string, state: string, close: string) =>
      at++ === index ? `${lead}${state === " " ? "x" : " "}${close}` : whole,
  );
}

/** @ and a task id, turned into a chip after the markdown is rendered. */
const mention = /(^|[^0-9A-Za-z_@>])@([0-9a-z]{8})\b/g;

/** A block that rendered: sanitized HTML, mentions already chips. */
export class Rendered {
  constructor(readonly html: string) {}
}

/** A block marked could not render, as the source it was. Drawn as text, so nothing in it is
 *  read as markup on the way. */
export class Unrendered {
  constructor(readonly source: string) {}
}

export type Block = Rendered | Unrendered;

function sanitize(html: string): string {
  const safe = DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "form", "input", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"],
    // An external image is a read receipt for whoever hosts it.
    ADD_ATTR: ["referrerpolicy", "loading"],
  });
  return safe.replace(
    mention,
    (_m, lead: string, id: string) =>
      `${lead}<a href="/t/${id}" class="mention" data-task="${id}">@${id}</a>`,
  );
}

/** One top-level block, and only that block lost if it throws. */
function block(token: Token): Block {
  try {
    return new Rendered(sanitize(marked.parser([token])));
  } catch (err) {
    console.error("A description block could not be rendered", err);
    return new Unrendered(token.raw.replace(/\n+$/, ""));
  }
}

/**
 * A description, block by block.
 *
 * Lexed once, so every block keeps the context of the whole — a reference link and its
 * definition, a fence and what it holds — and then rendered a block at a time, so one marked
 * cannot handle is shown as its source while everything around it renders. The lexer failing
 * outright, which is rare, leaves the whole description as its source.
 *
 * Blocks rather than one string of HTML, so a failed one reaches the page as text through React
 * rather than escaped by hand into markup.
 */
export function render(source: string): Block[] {
  let tokens: Token[];
  try {
    tokens = marked.lexer(source);
  } catch (err) {
    console.error("A description could not be read as markdown", err);
    return [new Unrendered(source)];
  }
  return (
    tokens
      .map(block)
      // A blank line is a token of its own and renders as nothing.
      .filter((b) => !(b instanceof Rendered && b.html.trim() === ""))
  );
}

/**
 * A piece of an excerpt: prose, prose that is a link, or the break between two lines.
 *
 * A break is its own piece rather than a newline inside one, because the row renders these as
 * elements and a newline in a text node is whitespace.
 */
export type Piece = { text: string; href?: string; br?: true };

/**
 * Only what a browser can follow and a reader can recognise. marked stopped sanitising hrefs,
 * and a description is not always written by the person reading it.
 */
function followable(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href.trim());
}

/**
 * A description's opening, for the row under a title.
 *
 * Line breaks survive as breaks. Folding them into spaces makes a sentence nobody wrote, and
 * replacing them with a separator makes one nobody punctuated; the row clamps to two lines, so
 * there is room to show the second one as a second one.
 *
 * Which is also why nothing here counts lines or adds an ellipsis: how many lines fit is a
 * question about a width this cannot see, and the clamp that answers it draws its own.
 *
 * Pieces rather than HTML: the row renders them as elements, so there is no markup to sanitise
 * and no path from a description to innerHTML. Links survive because a description is often
 * mostly one, and one reduced to its text is a line saying nothing.
 *
 * Walks marked's own tokens rather than rendering and stripping tags: the excerpt then agrees
 * with the editor about what is syntax and what is prose, and no second grammar has to be kept
 * in step with the first.
 *
 * Images are dropped rather than reduced to their alt text. A pasted one carries a data URI
 * long enough to be the whole excerpt, and the row has two lines.
 */
export function excerpt(source: string, limit = 300): Piece[] {
  const pieces: Piece[] = [];
  // Held rather than pushed, so a break with nothing after it is not a blank line at the end.
  let pending = false;

  const push = (text: string, href?: string) => {
    if (!text) return;
    if (pending) {
      pending = false;
      if (pieces.length > 0) pieces.push({ text: "", br: true });
    }
    const last = pieces[pieces.length - 1];
    // Adjacent prose is one piece, so the row does not render a span per word. Dropping an
    // image leaves the spaces that were on either side of it, hence the collapse.
    if (last && !last.br && !last.href && !href)
      last.text = (last.text + text).replace(/ {2,}/g, " ");
    else pieces.push(href ? { text, href } : { text });
  };

  const walk = (tokens: Token[], top = false) => {
    for (const token of tokens) {
      // A blank line is its own token, and the block that ended has already asked for a break.
      if (token.type === "image" || token.type === "space") continue;
      if (token.type === "br") {
        pending = true;
        continue;
      }
      if (token.type === "link") {
        const href = (token as { href: string }).href;
        push(
          (token as { text: string }).text.replace(/\s+/g, " "),
          followable(href) ? href : undefined,
        );
      } else if (token.type === "list") {
        // A list keeps its children under items rather than tokens, so a walk over tokens
        // alone steps straight over one and the row comes out empty.
        walk((token as { items: Token[] }).items, true);
      } else if ("tokens" in token && token.tokens) {
        walk(token.tokens as Token[]);
      } else if ("text" in token && typeof token.text === "string") {
        push(token.text.replace(/\s+/g, " "));
      }
      // A block ending is a line ending; whether it becomes one depends on what follows.
      if (top) pending = true;
    }
  };
  walk(marked.lexer(source) as Token[], true);

  // A bound on what reaches the DOM, not on what is shown: the clamp decides that. Breaks cost
  // nothing against it, so a description of many short lines is not cut after the first few.
  let left = limit;
  const out: Piece[] = [];
  for (const piece of pieces) {
    if (piece.br) {
      out.push(piece);
      continue;
    }
    const text = piece.text.slice(0, left);
    if (text) out.push({ ...piece, text });
    left -= text.length;
    if (left <= 0) break;
  }

  // Only the ends are trimmed: the spaces between pieces are what separate the words.
  while (out.length > 0 && out[out.length - 1]!.br) out.pop();
  const first = out[0];
  const last = out[out.length - 1];
  if (first && last) {
    first.text = first.text.replace(/^\s+/, "");
    last.text = last.text.replace(/\s+$/, "");
  }
  return out.filter((piece) => piece.br || piece.text.length > 0);
}
