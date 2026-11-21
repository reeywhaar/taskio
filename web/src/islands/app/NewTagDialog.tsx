import { useEffect, useId, useState } from "react";

import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import { Field } from "@app/components/Field";
import { TextField } from "@app/components/TextField";

/**
 * What a typed name becomes as a tag. Folded rather than refused: somebody typing "Home Repairs"
 * means home-repairs.
 */
export function tagSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_ -]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A name for a tag, asked in a dialog of its own.
 *
 * It was a field that opened in place of the New tag pill and took the tag on Enter, and lost it
 * on anything else: a press anywhere outside it, which is what somebody does once they have
 * typed a word, threw the word away. Here there is an Add to press, and nothing goes until Add
 * or Cancel says so.
 */
export function NewTagDialog({
  open,
  onAdd,
  onClose,
}: {
  open: boolean;
  onAdd: (slug: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const form = useId();
  useEffect(() => {
    if (open) setName("");
  }, [open]);

  const slug = tagSlug(name);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New tag"
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={form} variant="solid" disabled={!slug}>
            Add
          </Button>
        </>
      }
    >
      <form
        id={form}
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          // Its own: the cloud can sit inside a form of somebody else's, and React carries a
          // submit up through every one of them.
          e.stopPropagation();
          if (slug) onAdd(slug);
        }}
      >
        <Field label="Name">
          <TextField
            data-autofocus
            className="w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {/* Said before it is added, rather than found out after. */}
        {slug && slug !== name.trim() ? (
          <p className="text-xs text-muted">
            Added as <b className="font-mono text-fg">{slug}</b>.
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
