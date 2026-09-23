import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { postTokens } from "@app/api/actions/tokens";
import { ApiError } from "@app/api/transport";
import { qk } from "@app/api/keys";
import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import {
  blankToken,
  expiresAt,
  TokenFields,
  type TokenForm,
} from "@app/islands/app/TokenFields";
import { printScope } from "@app/islands/app/route";

/**
 * Minting a token.
 *
 * The dialog does not close on success: the secret is in that one response and nowhere else,
 * ever, so it is shown where it was asked for and stays until somebody says they have it.
 * Closing first and revealing it behind would be revealing it somewhere nobody was looking.
 */
export function TokenDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [form, setForm] = useState<TokenForm>(blankToken);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(blankToken);
    setSecret("");
    setError("");
  }, [open]);

  const mint = useMutation({
    mutationFn: () =>
      postTokens({
        label: form.label,
        projects: form.rows.map((row) => ({
          project: row.project,
          scope: printScope(row.tags, row.any),
        })),
        idle_seconds: Number(form.idle),
        expires_at: expiresAt(form.expires) || undefined,
      }),
    onSuccess: (result) => {
      setSecret(result.secret);
      setError("");
      client.invalidateQueries({ queryKey: qk.tokens });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={secret ? "Your new token" : "Mint a token"}
      footer={
        secret ? (
          <Button variant="solid" onClick={onClose}>
            I have copied it
          </Button>
        ) : (
          <>
            <Button
              type="submit"
              form="mint-token"
              variant="solid"
              disabled={!form.label.trim() || mint.isPending}
            >
              {mint.isPending ? "Minting…" : "Mint"}
            </Button>
          </>
        )
      }
    >
      {secret ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-warn">
            This is the only time this token is shown.
          </p>
          <code className="block break-all font-mono text-sm select-all">
            {secret}
          </code>
        </div>
      ) : (
        <form
          id="mint-token"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.label.trim()) mint.mutate();
          }}
        >
          <TokenFields value={form} onChange={setForm} />

          {error ? <p className="text-sm text-accent">{error}</p> : null}
        </form>
      )}
    </Dialog>
  );
}
