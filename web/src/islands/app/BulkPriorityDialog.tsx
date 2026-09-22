import { useEffect, useState } from "react";

import { postTasksBulkPriority } from "@app/api/actions/tasks";
import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import { NumberField } from "@app/components/NumberField";

/**
 * One number, across the selection.
 *
 * In a dialog for the same reason tagging is, which is not that a number needs the room: a field
 * and the two buttons answering it are a head taller than the row of bar-sized buttons they
 * stood in, so opening the prompt grew the bar and moved the list under it. A bar that is one
 * height is worth more than a prompt that is one row.
 */
export function BulkPriorityDialog({
  open,
  ids,
  onClose,
  onSaved,
}: {
  open: boolean;
  ids: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [priority, setPriority] = useState("0");
  const [busy, setBusy] = useState(false);

  // Back to nought each time, so the number is this selection's rather than the last one's.
  useEffect(() => {
    if (open) setPriority("0");
  }, [open]);

  const save = async () => {
    setBusy(true);
    try {
      await postTasksBulkPriority(ids, Number(priority) || 0);
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Priority"
      aside={<span className="text-sm text-muted">{ids.length} selected</span>}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="solid" onClick={() => void save()} disabled={busy}>
            {busy ? "Setting…" : "Set"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <NumberField
          autoFocus
          label="Priority"
          value={priority}
          onChange={setPriority}
        />
        <p className="mt-2 text-xs text-muted">
          The same number on every selected task. Higher sorts first.
        </p>
      </form>
    </Dialog>
  );
}
