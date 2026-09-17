import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getAdminLimits, putAdminLimits } from "@app/api/actions/admin";
import { ApiError } from "@app/api/transport";
import { qk } from "@app/api/keys";
import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import { Field, Fields } from "@app/components/Field";
import { TextField } from "@app/components/TextField";

/** Megabytes on this side of the wire, bytes on the other: the API's unit is not a person's. */
const MB = 1 << 20;

export function LimitsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: (saved?: boolean) => void;
}) {
  const client = useQueryClient();
  const limits = useQuery({
    queryKey: qk.adminLimits,
    queryFn: getAdminLimits,
  });
  const [max, setMax] = useState(10);
  const [quota, setQuota] = useState(1024);
  const [error, setError] = useState("");

  // Once per opening: see RelayDialog, which loses more when it gets this wrong.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) seeded.current = false;
  }, [open]);

  useEffect(() => {
    if (!open || seeded.current || !limits.data) return;
    seeded.current = true;
    setMax(Math.round(limits.data.asset_max_bytes / MB));
    setQuota(Math.round(limits.data.account_quota_bytes / MB));
    setError("");
  }, [open, limits.data]);

  const save = useMutation({
    mutationFn: () =>
      putAdminLimits({
        asset_max_bytes: max * MB,
        account_quota_bytes: quota * MB,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: qk.adminLimits });
      onClose(true);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  return (
    <Dialog
      open={open}
      onClose={() => onClose()}
      title="Attachment limits"
      footer={
        <>
          <Button
            type="submit"
            form="limits"
            variant="solid"
            disabled={save.isPending}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form
        id="limits"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="mb-3 text-sm text-muted">
          Lowering the quota below what an account already holds deletes
          nothing. What stops is uploading.
        </p>
        <Fields>
          <Field label="Largest attachment (MB)">
            <TextField
              type="number"
              data-autofocus
              className="w-full"
              value={max}
              onChange={(e) => setMax(Number(e.target.value))}
            />
          </Field>
          <Field label="Per account (MB)">
            <TextField
              type="number"
              className="w-full"
              value={quota}
              onChange={(e) => setQuota(Number(e.target.value))}
            />
          </Field>
        </Fields>
        {error ? <p className="mt-3 text-sm text-accent">{error}</p> : null}
      </form>
    </Dialog>
  );
}
