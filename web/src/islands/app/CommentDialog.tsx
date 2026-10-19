import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { ApiError } from "@app/api/transport";
import { Button } from "@app/components/Button";
import { useConfirm } from "@app/components/Confirm";
import { Dialog } from "@app/components/Dialog";
import { Editor, sendKeys } from "@app/islands/app/Editor";
import { Preview } from "@app/islands/app/Preview";

/** What the dialog is open on: a new comment, or one already said, by its id and number. */
export type Writing = { id?: string; n?: number; body: string } | null;

/**
 * A comment written or edited in a dialog of its own, over the task's.
 *
 * It was a box at the foot of the task, and an edit opened in place. Either one was a draft
 * inside a dialog whose buttons closed it, and Save or a press outside took the words with it.
 * Here the ways out are sending it and saying no to it, and closing on words typed asks first.
 */
export function CommentDialog({
  writing,
  onSend,
  onClose,
  onMention,
}: {
  writing: Writing;
  /** Writes it; a refusal is said here and the words stay. */
  onSend: (body: string) => Promise<void>;
  onClose: () => void;
  onMention: (id: string, comment?: number) => void;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  /** Its two faces, switched from the title bar as the task's are: the box is the whole dialog. */
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  // Seeded each time it opens, from what it was opened on.
  const [opened, setOpened] = useState<Writing>(null);
  if (writing !== opened) {
    setOpened(writing);
    setBody(writing?.body ?? "");
    setError("");
    setMode("edit");
  }
  const editing = writing?.id !== undefined;
  const changed = body.trim() !== "" && body !== (writing?.body ?? "");

  const send = useMutation({
    mutationFn: () => onSend(body),
    onSuccess: onClose,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });
  const submit = () => {
    if (changed && !send.isPending) send.mutate();
  };

  const confirm = useConfirm();
  const close = async () => {
    if (changed) {
      const yes = await confirm({
        title: editing ? "Discard the edit?" : "Discard the comment?",
        message: "What is typed here has not been sent.",
        confirm: "Discard",
        danger: true,
      });
      if (!yes) return;
    }
    onClose();
  };

  return (
    <Dialog
      open={writing !== null}
      // The task's width: it opens over that dialog, and a narrower card left a frame of it
      // showing round the edge.
      wide
      onClose={close}
      title={editing ? `Edit comment #${writing?.n}` : "Comment"}
      actions={
        mode === "edit" ? (
          // Only where there is something to read, as View on the task.
          body.trim() ? (
            <Button size="compact" onClick={() => setMode("preview")}>
              Preview
            </Button>
          ) : null
        ) : (
          <Button size="compact" onClick={() => setMode("edit")}>
            Edit
          </Button>
        )
      }
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="solid"
            disabled={!changed || send.isPending}
            onClick={submit}
          >
            {editing ? "Save" : "Comment"}
          </Button>
        </>
      }
    >
      {mode === "edit" ? (
        <Editor
          autoFocus
          value={body}
          onChange={setBody}
          prompt={`Comment. Markdown${sendKeys() ? `; ${sendKeys()} sends` : ""}.`}
          limits={{ assetMax: 10 << 20 }}
          onSubmit={submit}
        />
      ) : (
        // About the box's height, so turning to it does not fold the dialog to one line.
        <div className="sm:min-h-60">
          <Preview source={body} onChange={setBody} onMention={onMention} />
        </div>
      )}
      {error ? <p className="text-sm text-accent">{error}</p> : null}
    </Dialog>
  );
}
