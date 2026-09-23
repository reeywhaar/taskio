import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { patchTokensById, type TokenPatch } from "@app/api/actions/tokens";
import { ApiError } from "@app/api/transport";
import type { Token } from "@app/api/types";
import { qk } from "@app/api/keys";
import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import {
  blankToken,
  expiresAt,
  TokenFields,
  type TokenForm,
} from "@app/islands/app/TokenFields";
import { parseScope, printScope } from "@app/islands/app/route";

/** The form as the token already stands, which is what an edit is measured against. */
function formOf(token: Token): TokenForm {
  return {
    label: token.label,
    idle: String(token.idle_seconds),
    expires: token.expires_at ? "keep" : "0",
    rows: token.projects.map((row) => ({
      project: row.project,
      ...parseScope(row.scope),
      deleted: row.deleted,
    })),
  };
}

/**
 * Rows as they would be written: live ones only, each scope in the server's grammar. A deleted
 * project's row is left out, because the server refuses a token being given one — saving the
 * projects is where it goes, and the row says so beforehand.
 */
function written(rows: TokenForm["rows"]) {
  return rows
    .filter((row) => !row.deleted)
    .map((row) => ({
      project: row.project,
      scope: printScope(row.tags, row.any),
    }));
}

/** Rows as one comparable string: projects, deleted or not, and scopes with tags in one order. */
function rowsKey(rows: TokenForm["rows"]): string {
  return JSON.stringify(
    rows.map((row) => [
      row.project,
      !!row.deleted,
      // eslint-disable-next-line unicorn/no-array-sort -- a copy, so there is nothing to mutate
      printScope([...row.tags].sort(), row.any),
    ]),
  );
}

/** Whether two sets of rows reach the same things: same projects, same scopes, same order. */
function sameRows(a: TokenForm["rows"], b: TokenForm["rows"]): boolean {
  return rowsKey(a) === rowsKey(b);
}

/**
 * What the form asks for that the token does not already have — and only that, so the log
 * line an edit writes names what changed rather than everything that was on the screen.
 */
function changes(token: Token, form: TokenForm): TokenPatch {
  const patch: TokenPatch = {};
  if (form.label.trim() !== token.label) patch.label = form.label.trim();
  if (!sameRows(form.rows, formOf(token).rows))
    patch.projects = written(form.rows);
  if (Number(form.idle) !== token.idle_seconds)
    patch.idle_seconds = Number(form.idle);
  if (form.expires !== "keep" && !(form.expires === "0" && !token.expires_at))
    patch.expires_at = expiresAt(form.expires);
  return patch;
}

/**
 * Changing a token without reissuing it: what it is called, when it stops working, and what
 * it reaches.
 *
 * The value in somebody's config keeps working and sees the change on its next request.
 * Reissuing instead means finding every place the old one was pasted, which is the work this
 * avoids. The one thing it cannot change is the secret, which is the point of it.
 */
export function TokenEditDialog({
  token,
  onClose,
}: {
  /** The token being edited, or null when the dialog is shut. */
  token: Token | null;
  onClose: (saved?: boolean) => void;
}) {
  const client = useQueryClient();
  const [form, setForm] = useState<TokenForm>(blankToken);
  const [error, setError] = useState("");

  // Seeded from the token each time one is opened, so an abandoned edit is abandoned.
  useEffect(() => {
    if (!token) return;
    setForm(formOf(token));
    setError("");
  }, [token]);

  const patch = token ? changes(token, form) : {};
  const untouched = Object.keys(patch).length === 0;

  const save = useMutation({
    mutationFn: () => patchTokensById(token!.id, patch),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: qk.tokens });
      onClose(true);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  return (
    <Dialog
      open={token !== null}
      onClose={() => onClose()}
      title="Edit token"
      aside={<span className="font-mono text-xs text-faint">{token?.id}</span>}
      footer={
        <Button
          type="submit"
          form="edit-token"
          variant="solid"
          disabled={untouched || !form.label.trim() || save.isPending}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      }
    >
      <form
        id="edit-token"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!untouched && form.label.trim()) save.mutate();
        }}
      >
        <TokenFields
          value={form}
          onChange={setForm}
          current={token ?? undefined}
        />

        <p className="text-xs text-faint">
          The token itself does not change, so whatever holds it keeps working.
        </p>

        {error ? <p className="text-sm text-accent">{error}</p> : null}
      </form>
    </Dialog>
  );
}
