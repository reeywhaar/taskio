import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type ComponentProps,
  type DragEvent,
} from "react";

import { postAssets } from "@app/api/actions/assets";
import { ApiError } from "@app/api/transport";
import { addCopyButtons } from "@app/codeblocks";
import { Boundary } from "@app/components/Boundary";
import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import { render, toggleCheck, Unrendered } from "@app/markdown";

function filesOf(list: FileList | null): File[] {
  return Array.from(list ?? []);
}

/** An image is shown; everything else is a link, because a PDF embedded in prose is a link. */
function markdownFor(name: string, url: string, image: boolean): string {
  return image ? `![${name}](${url})` : `[${name}](${url})`;
}

/**
 * A textarea over the markdown itself, and a preview that is a modal rather than a tab.
 *
 * The switch was two tabs, which is the shape anybody who has left a code-review comment
 * already knows — and it made the preview the same size and shape as the box it replaced, which
 * is the one thing a preview should not be. A description is read at the width of a page, not in
 * a ten-row well with an Attach button over it. So Preview opens, rather than swapping, and what
 * it opens has nothing in it but the words.
 *
 * It also means the editor has one state instead of two: nothing to leave the wrong way round,
 * and no way to be typing into a box that is not there. See docs/interface.md.
 */
export function Editor({
  value,
  onChange,
  title,
  limits,
}: {
  value: string;
  onChange: (next: string) => void;
  /** What the preview is called when it opens, which is the task rather than the field. */
  title?: string;
  /** The per-file limit, so an oversized paste is refused here rather than after a minute of
   *  uploading. */
  limits: { assetMax: number };
}) {
  const [showing, setShowing] = useState(false);
  /**
   * What the preview is showing, which is not always what the task now says.
   *
   * An edit from somewhere else arrives as an event and replaces the draft under the reader —
   * a page of prose swapping mid-sentence. This holds the text it opened with and offers the
   * newer one as a button.
   */
  const [shown, setShown] = useState(value);
  const newer = showing && shown !== value;

  /** A tick in the preview is an edit to the text it was rendered from. */
  const tick = (target: EventTarget | null) => {
    const item =
      target instanceof Element ? target.closest("li[data-check]") : null;
    if (!item || !preview.current) return;
    const index = [
      ...preview.current.querySelectorAll("li[data-check]"),
    ].indexOf(item);
    if (index < 0) return;
    const next = toggleCheck(shown, index);
    setShown(next);
    onChange(next);
  };
  const [error, setError] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const preview = useRef<HTMLDivElement>(null);

  // After every render rather than on a change of the text: React replaces the preview's markup
  // wholesale when it changes, which takes the buttons with it. Which is also why this survives
  // the preview not existing most of the time — it is a modal, and there is nothing to decorate
  // until it opens.
  useEffect(() => {
    if (preview.current) addCopyButtons(preview.current);
  });

  /**
   * Insertion goes through execCommand where it exists.
   *
   * Deprecated, and the only way to put text into a textarea without destroying the browser's
   * undo stack — somebody who pastes an image and presses undo expects the image to go, and
   * setRangeText alone deletes their previous paragraph instead.
   */
  const insert = (text: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (document.execCommand?.("insertText", false, text)) {
      onChange(el.value);
      return;
    }
    const start = el.selectionStart;
    el.setRangeText(text, start, el.selectionEnd, "end");
    onChange(el.value);
  };

  /** Replaces one placeholder in place, so two pastes in a row resolve independently. */
  const replace = (placeholder: string, text: string) => {
    const el = ref.current;
    if (!el) return;
    onChange(el.value.replace(placeholder, text));
  };

  const upload = async (files: File[]) => {
    setError("");
    for (const file of files) {
      if (file.size > limits.assetMax) {
        // A phone photo on a slow connection would otherwise spend a minute before being
        // refused, which reads as a broken editor rather than a limit.
        setError(
          `That image is larger than ${Math.floor(limits.assetMax / (1 << 20))} MB.`,
        );
        continue;
      }
      // The placeholder carries a generated token rather than being found by searching for a
      // word, so two pastes in a row resolve independently.
      const token = `uploading-${Math.random().toString(36).slice(2, 8)}`;
      const placeholder = markdownFor(
        file.name,
        token,
        file.type.startsWith("image/"),
      );
      insert(placeholder);
      try {
        const asset = await postAssets(file);
        // The server says whether to embed it: the type it settled on is the one that counts.
        replace(placeholder, markdownFor(file.name, asset.url, asset.image));
      } catch (err) {
        replace(placeholder, "");
        setError(
          err instanceof ApiError
            ? err.message
            : "That image could not be uploaded.",
        );
      }
    }
  };

  return (
    // Grows into the slack, and never gives up its own height for it: with min-h-0 it was the
    // part of a tall dialog that shrank, and the textarea kept its height and spilled over the
    // fields below it. The dialog's body scrolls; nothing in it has to shrink.
    <div className="flex flex-1 flex-col gap-2">
      <div className="flex items-center gap-1 text-sm">
        {/* Only where there is something to look at: a preview of nothing is a control that
            does nothing, and on a new task that is what it would be until the first keystroke. */}
        {value.trim() ? (
          <button
            type="button"
            onClick={() => {
              setShown(value);
              setShowing(true);
            }}
            // Flush with the field below it, not indented from it. The padding was left over
            // from being a tab, where it was the shape of the lit one; nothing is lit here, so
            // it was 8px of nothing pushing the only word on this line out of line with the
            // writing, the title above and Attach across from it.
            className="py-1 text-muted hover:text-fg"
          >
            Preview
          </button>
        ) : null}
        <label className="ml-auto cursor-pointer text-muted hover:text-fg">
          {/* A phone has no paste gesture for a photo, so the button is the only path there. */}
          Attach
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void upload(filesOf(e.target.files));
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <textarea
        ref={ref}
        rows={10}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e: ClipboardEvent<HTMLTextAreaElement>) => {
          const files = filesOf(e.clipboardData.files);
          if (files.length === 0) return;
          e.preventDefault();
          void upload(files);
        }}
        onDragOver={(e: DragEvent) => e.preventDefault()}
        onDrop={(e: DragEvent<HTMLTextAreaElement>) => {
          const files = filesOf(e.dataTransfer.files);
          if (files.length === 0) return;
          e.preventDefault();
          void upload(files);
        }}
        className="sunken w-full min-h-40 flex-1 rounded-md border-0 bg-bg p-3 text-fg focus:outline-none"
        placeholder="Markdown. Paste a file, or @ a task."
      />

      {error ? <p className="text-sm text-accent">{error}</p> : null}

      {/* The current buffer rather than the saved one: this answers "what will this look like",
          not "what did I save".

          Named after the task rather than after the field, because on a phone it is the whole
          screen and the editor behind it is not visible to say which task this belongs to. */}
      <Dialog
        open={showing}
        onClose={() => setShowing(false)}
        title={title?.trim() || "Description"}
        aside={
          newer ? (
            <Button size="bar" onClick={() => setShown(value)}>
              Update
            </Button>
          ) : null
        }
        wide
      >
        {/* A floor under it, because a description of two lines in a box of two lines is a
            dialog that has shrunk to fit and reads as cramped — the room is the point of
            opening it. Above the breakpoint only: on a phone the dialog is the whole screen
            already, and a minimum there could only make it scroll.

            shrink-0 with it, and not decoration: a flex item's implicit min-height:auto is what
            stops it shrinking below its own content, and stating a min-height replaces that. The
            prose then shrank to fit the dialog, its text painted past the end of the scrollable
            area, and the last paragraphs sat below the bottom edge with no way to scroll to
            them. */}
        <Boundary what="The description">
          <Rendered
            ref={preview}
            source={shown}
            className="prose shrink-0 text-sm sm:min-h-50"
            onClick={(e) => tick(e.target)}
            onKeyDown={(e) => {
              if (e.key !== " " && e.key !== "Enter") return;
              e.preventDefault();
              tick(e.target);
            }}
          />
        </Boundary>
      </Dialog>
    </div>
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

export const EditorActions = Button;
