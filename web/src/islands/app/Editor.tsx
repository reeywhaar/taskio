import {
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { postAssets } from "@app/api/actions/assets";
import { ApiError } from "@app/api/transport";
import { Button } from "@app/components/Button";
import { PaperclipIcon } from "@app/components/icons/Icon";

function filesOf(list: FileList | null): File[] {
  return Array.from(list ?? []);
}

/** An image is shown; everything else is a link, because a PDF embedded in prose is a link. */
function markdownFor(name: string, url: string, image: boolean): string {
  return image ? `![${name}](${url})` : `[${name}](${url})`;
}

/**
 * A textarea over the markdown itself.
 *
 * Only the writing, for a description: reading it is the dialog's other face — View in its
 * title bar. A comment has no dialog of its own to turn, so given a preview it gets Edit and
 * Preview, as two words rather than a control. The controls run along the floor of the box, inside
 * it, with any actions at their end. See docs/interface.md.
 */
export function Editor({
  value,
  onChange,
  limits,
  compact = false,
  prompt = "Markdown. Paste a file, or @ a task.",
  preview,
  onSubmit,
  onCancel,
  actions,
}: {
  value: string;
  onChange: (next: string) => void;
  /** A few lines rather than ten, for a comment. */
  compact?: boolean;
  /** What the empty box says. */
  prompt?: string;
  /** The per-file limit, so an oversized paste is refused here rather than after a minute of
   *  uploading. */
  limits: { assetMax: number };
  /** The text as it reads. Given, the box has an Edit | Preview toggle. */
  preview?: (source: string) => ReactNode;
  /** Shift+Enter, for a comment: sends it. */
  onSubmit?: () => void;
  /** Escape, for a comment being edited: drops the edit, and the dialog around it stays. */
  onCancel?: () => void;
  /** Buttons at the end of the controls, inside the box. */
  actions?: ReactNode;
}) {
  const [error, setError] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Back to writing when the text is emptied from outside, which is a comment posted.
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [was, setWas] = useState(value);
  if (value !== was) {
    setWas(value);
    if (!value) setTab("edit");
  }
  const reading = preview !== undefined && tab === "preview";

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

  // A floor of its own tint, so the browser's resize grip reads as the corner of the words above
  // it rather than something standing on the controls.
  const controls = (
    <div className="flex items-center gap-3 rounded-b-md bg-floor px-3 py-1.5 text-xs">
      {preview ? (
        <div role="group" aria-label="Comment" className="flex gap-3">
          {(["edit", "preview"] as const).map((option) => (
            // The one showing is a word; the other is a pseudo-link, dashed because it
            // switches what is here rather than going anywhere. Small caps, like a label.
            <button
              key={option}
              type="button"
              aria-pressed={tab === option}
              onClick={() => setTab(option)}
              className={`caps text-xs ${
                tab === option
                  ? "text-fg"
                  : "text-muted underline decoration-dashed underline-offset-4 hover:text-fg"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      {reading ? null : (
        <label
          title="Attach a file"
          className="cursor-pointer text-sm text-muted hover:text-fg"
        >
          {/* A phone has no paste gesture for a photo, so the button is the only path there. */}
          <PaperclipIcon />
          <span className="sr-only">Attach a file</span>
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
      )}
      <span className="flex-1" />
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );

  return (
    // Grows into the slack, and never gives up its own height for it: with min-h-0 it was the
    // part of a tall dialog that shrank, and the textarea kept its height and spilled over the
    // fields below it. The dialog's body scrolls; nothing in it has to shrink.
    <div
      className="flex flex-auto flex-col gap-1"
      // On the whole box, so it holds on the toggle too. Cancelled, so it is not also the
      // dialog's close request.
      onKeyDown={(e) => {
        if (!onCancel || e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }}
    >
      {/* One well, the words and the controls along its floor, so the toggle reads as the box's
          own rather than a line of text near it. */}
      <div className="sunken flex flex-auto flex-col rounded-md bg-bg">
        {reading ? (
          // As tall as the box it stands for, so the controls under it stay put.
          <div className={`flex-auto p-3 ${compact ? "min-h-20" : "min-h-40"}`}>
            {value.trim() ? (
              preview(value)
            ) : (
              <p className="text-sm text-muted">Nothing to preview.</p>
            )}
          </div>
        ) : null}
        {/* Hidden rather than gone while reading: an upload still lands in it, and its undo
          history survives the trip. */}
        <textarea
          ref={ref}
          rows={compact ? 3 : 10}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
            // Not mid-composition: Enter there is choosing a character.
            if (!onSubmit || e.key !== "Enter" || !e.shiftKey) return;
            if (e.nativeEvent.isComposing) return;
            e.preventDefault();
            onSubmit();
          }}
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
          className={`grip w-full flex-auto border-0 bg-transparent p-3 text-fg focus:outline-none ${
            compact ? "min-h-20" : "min-h-40"
          } ${reading ? "hidden" : ""}`}
          placeholder={prompt}
        />

        {controls}
      </div>

      {error ? <p className="text-sm text-accent">{error}</p> : null}
    </div>
  );
}

export const EditorActions = Button;
