import {
  useEffect,
  useRef,
  type ComponentProps,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import { addCopyButtons } from "@app/codeblocks";
import { Boundary } from "@app/components/Boundary";
import { render, toggleCheck, Unrendered } from "@app/markdown";

/**
 * A description as it reads: the words, with nothing to write in.
 *
 * A face of the dialog the task is open in rather than a dialog of its own over it — the same
 * place, read instead of written, and Edit in the title bar turns it back.
 *
 * Three things in it answer a press. A box ticks, which is an edit to the text it was rendered
 * from. A mention opens that task, read the same way, over this one. And a code block copies.
 */
export function Preview({
  source,
  onChange,
  onMention,
}: {
  source: string;
  /** A tick, as the text with that box flipped. */
  onChange: (next: string) => void;
  /** A mention pressed, by the id it names. */
  onMention: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);

  // After every render rather than on a change of the text: React replaces the markup of a block
  // that changed, which takes its buttons with it.
  useEffect(() => {
    if (box.current) addCopyButtons(box.current);
  });

  const tick = (target: Element) => {
    const item = target.closest("li[data-check]");
    if (!item || !box.current) return;
    const index = [...box.current.querySelectorAll("li[data-check]")].indexOf(
      item,
    );
    if (index >= 0) onChange(toggleCheck(source, index));
  };

  const press = (e: MouseEvent) => {
    if (!(e.target instanceof Element)) return;
    const chip = e.target.closest("a.mention[data-task]");
    if (chip) {
      // A new tab or window is the link's own business, and it is a real link for that.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      onMention(chip.getAttribute("data-task") ?? "");
      return;
    }
    tick(e.target);
  };

  // A box is ticked from the keyboard as a checkbox is. Only on the box's own row: Enter on a
  // link inside the description is the link's.
  const key = (e: KeyboardEvent) => {
    if (e.key !== " " && e.key !== "Enter") return;
    if (!(e.target instanceof Element) || !e.target.matches("li[data-check]"))
      return;
    e.preventDefault();
    tick(e.target);
  };

  if (!source.trim())
    return <p className="text-sm text-muted">No description.</p>;

  return (
    // A floor under it, because a description of two lines in a box of two lines is a dialog
    // that has shrunk to fit and reads as cramped. Above the breakpoint only: on a phone the
    // dialog is the whole screen already.
    //
    // shrink-0 with it, and not decoration: a flex item's implicit min-height:auto is what stops
    // it shrinking below its own content, and stating a min-height replaces that — the prose then
    // shrank to fit the dialog and its last paragraphs sat below the bottom edge.
    <Boundary what="The description">
      <Rendered
        ref={box}
        source={source}
        className="prose shrink-0 text-sm sm:min-h-50"
        onClick={press}
        onKeyDown={key}
      />
    </Boundary>
  );
}

/** A component of its own, so the boundary around it catches what the parser throws. */
function Rendered({
  source,
  ...rest
}: { source: string } & ComponentProps<"div">) {
  return (
    <div {...rest}>
      {render(source).map((block, i) =>
        block instanceof Unrendered ? (
          <p
            key={i}
            className="unrendered"
            title="This part could not be rendered"
          >
            {block.source}
          </p>
        ) : (
          // contents: the wrapper exists for React and not for the layout, so the block inside
          // is what the prose spacing sees.
          <div
            key={i}
            className="block contents"
            dangerouslySetInnerHTML={{ __html: block.html }}
          />
        ),
      )}
    </div>
  );
}
