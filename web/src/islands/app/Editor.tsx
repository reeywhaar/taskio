import { useRef, useState, type ClipboardEvent, type DragEvent } from "react";

import { postAssets } from "@app/api/actions/assets";
import { ApiError } from "@app/api/transport";
import { Button } from "@app/components/Button";

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
 * Only the writing. Reading it is the dialog's other face — View in its title bar — rather
 * than a tab here, which made a preview the same size and shape as the box it replaced, or a
 * second dialog over the first. See docs/interface.md.
 */
export function Editor({
  value,
  onChange,
  limits,
}: {
  value: string;
  onChange: (next: string) => void;
  /** The per-file limit, so an oversized paste is refused here rather than after a minute of
   *  uploading. */
  limits: { assetMax: number };
}) {
  const [error, setError] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

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
    </div>
  );
}

export const EditorActions = Button;
