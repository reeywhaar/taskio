import {
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";

import { postAssets } from "@app/api/actions/assets";
import { ApiError } from "@app/api/transport";
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
 * Only the writing: reading it is the dialog's other face, switched from its title bar — View
 * on a task, Preview on a comment. The paperclip runs along the floor of the box, inside it. See
 * docs/interface.md.
 */
export function Editor({
  value,
  onChange,
  limits,
  prompt = "Markdown. Paste a file, or @ a task.",
  onSubmit,
  autoFocus = false,
}: {
  value: string;
  onChange: (next: string) => void;
  /** What the empty box says. */
  prompt?: string;
  /** The per-file limit, so an oversized paste is refused here rather than after a minute of
   *  uploading. */
  limits: { assetMax: number };
  /** Cmd+Enter, or Ctrl+Enter off a Mac: sends a comment, saves a task. */
  onSubmit?: () => void;
  /** Taken by the dialog it opens in, where the box is the whole of what the dialog is for. */
  autoFocus?: boolean;
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

  // A floor of its own tint, so the browser's resize grip reads as the corner of the words above
  // it rather than something standing on the controls.
  const controls = (
    <div className="flex items-center gap-3 rounded-b-md bg-floor px-3 py-1.5 text-xs">
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
    </div>
  );

  return (
    // Grows into the slack, and never gives up its own height for it: with min-h-0 it was the
    // part of a tall dialog that shrank, and the textarea kept its height and spilled over the
    // fields below it. The dialog's body scrolls; nothing in it has to shrink.
    <div className="flex flex-auto flex-col gap-1">
      {/* One well, the words and the controls along its floor, so the clip reads as the box's
          own rather than something near it. */}
      <div className="sunken flex flex-auto flex-col rounded-md bg-bg">
        <textarea
          ref={ref}
          data-autofocus={autoFocus || undefined}
          rows={10}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
            // Not mid-composition: Enter there is choosing a character.
            // Cmd or Ctrl, never Shift: an iPhone's keyboard turns shift on after a Return, so
            // two Returns for a blank line read as Shift+Enter and sent the task half-written.
            // A soft keyboard has neither Cmd nor Ctrl, and a hardware one has both.
            if (!onSubmit || e.key !== "Enter" || !(e.metaKey || e.ctrlKey))
              return;
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
          className="grip min-h-40 w-full flex-auto border-0 bg-transparent p-3 text-fg focus:outline-none"
          placeholder={prompt}
        />

        {controls}
      </div>

      {error ? <p className="text-sm text-accent">{error}</p> : null}
    </div>
  );
}

/**
 * The keys that send, as a placeholder says them: Cmd on a Mac, Ctrl elsewhere, and nothing on a
 * touch screen, whose keyboard has neither — the button is the way there.
 */
export function sendKeys(): string {
  if (window.matchMedia?.("(pointer: coarse)").matches) return "";
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘+Enter" : "Ctrl+Enter";
}
