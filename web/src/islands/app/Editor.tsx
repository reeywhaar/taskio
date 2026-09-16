import { useRef, useState, type ClipboardEvent, type DragEvent } from "react";

import { postAssets } from "@app/api/actions/assets";
import { ApiError } from "@app/api/transport";
import { Button } from "@app/components/Button";
import { render } from "@app/markdown";

type Tab = "write" | "preview";

function filesOf(list: FileList | null): File[] {
  return Array.from(list ?? []);
}

/** An image is shown; everything else is a link, because a PDF embedded in prose is a link. */
function markdownFor(name: string, url: string, image: boolean): string {
  return image ? `![${name}](${url})` : `[${name}](${url})`;
}

/**
 * A textarea over the markdown itself, and a two-tab switch: the shape everybody already knows
 * from a code-review comment box. Set in the proportional face, like the preview beside it, so
 * the tabs show one text two ways. See docs/interface.md.
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
  const [tab, setTab] = useState<Tab>("write");
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
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-1 text-sm">
        {(["write", "preview"] as const).map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={tab === name}
            onClick={() => setTab(name)}
            className={`rounded-md px-2 py-1 capitalize ${
              tab === name ? "bg-fill font-medium" : "text-muted hover:text-fg"
            }`}
          >
            {name}
          </button>
        ))}
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

      {tab === "write" ? (
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
          className="w-full min-h-40 flex-1 rounded-md border-[1.5px] border-line bg-bg p-3 text-fg focus:border-brand focus:outline-none"
          placeholder="Markdown. Paste a file, or @ a task."
        />
      ) : (
        // The current buffer rather than the saved one: the toggle answers "what will this look
        // like", not "what did I save".
        <div
          className="prose min-h-40 flex-1 overflow-y-auto rounded-md border-[1.5px] border-line bg-bg p-3 text-sm"
          dangerouslySetInnerHTML={{ __html: render(value) }}
        />
      )}

      {error ? <p className="text-sm text-accent">{error}</p> : null}
    </div>
  );
}

export const EditorActions = Button;
