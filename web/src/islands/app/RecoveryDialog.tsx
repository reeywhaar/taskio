import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  postAccountRecovery,
  postAccountRecoveryConfirm,
} from "@app/api/actions/account";
import { ApiError } from "@app/api/transport";
import { qk } from "@app/api/keys";
import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import { Field } from "@app/components/Field";
import { TextField } from "@app/components/TextField";

/**
 * Proving an address before it becomes the one an account can be recovered through.
 *
 * Two steps in one dialog, because they are one errand: an address nobody has proved they can
 * read is worse than none, so until the code comes back the account has no recovery address at
 * all — not a provisional one. A flow abandoned at any point leaves exactly what was there.
 */
export function RecoveryDialog({
  open,
  current,
  onClose,
}: {
  open: boolean;
  /** The address on file, so the field can say whether this is a change. */
  current: string;
  onClose: (saved?: boolean) => void;
}) {
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setEmail("");
    setCode("");
    setWaiting(false);
    setError("");
  }, [open]);

  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : "Something went wrong.");

  const start = useMutation({
    mutationFn: () => postAccountRecovery({ email }),
    onSuccess: () => {
      setWaiting(true);
      setError("");
    },
    onError: fail,
  });

  const confirm = useMutation({
    mutationFn: () => postAccountRecoveryConfirm({ code }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: qk.account });
      onClose(true);
    },
    onError: fail,
  });

  return (
    <Dialog
      open={open}
      onClose={() => onClose()}
      title={waiting ? "Enter the code" : "Recovery address"}
      footer={
        <>
          <Button
            onClick={() => (waiting ? setWaiting(false) : onClose())}
            disabled={start.isPending || confirm.isPending}
          >
            {waiting ? "Start again" : "Cancel"}
          </Button>
          <Button
            type="submit"
            form="recovery"
            variant="solid"
            disabled={
              waiting ? !code || confirm.isPending : !email || start.isPending
            }
          >
            {waiting ? "Confirm" : "Send a code"}
          </Button>
        </>
      }
    >
      <form
        id="recovery"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (waiting) confirm.mutate();
          else start.mutate();
        }}
      >
        {waiting ? (
          <>
            <p className="text-sm text-muted">
              A code is on its way to {email}. The address is not on the account
              until the code comes back.
            </p>
            <Field label="The code from the mail">
              <TextField
                autoFocus
                className="w-full"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
          </>
        ) : (
          <Field
            label={current ? "A different address" : "Your address"}
            hint="It is used for one thing: getting back in."
          >
            <TextField
              type="email"
              autoFocus
              className="w-full"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        )}

        {error ? <p className="text-sm text-accent">{error}</p> : null}
      </form>
    </Dialog>
  );
}
