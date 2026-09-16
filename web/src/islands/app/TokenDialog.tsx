import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getTags } from "@app/api/actions/tags";
import { postTokens } from "@app/api/actions/tokens";
import { ApiError } from "@app/api/transport";
import { qk } from "@app/api/keys";
import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import { Field, Group } from "@app/components/Field";
import { TextField } from "@app/components/TextField";
import { TagCloud } from "@app/islands/app/TagCloud";
import { printAnd } from "@app/islands/app/route";

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
  const tags = useQuery({ queryKey: qk.tags, queryFn: getTags });
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLabel("");
    setScope([]);
    setSecret("");
    setError("");
  }, [open]);

  const mint = useMutation({
    mutationFn: () =>
      postTokens({ label, scope: printAnd(scope) || undefined }),
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
            <Button onClick={onClose} disabled={mint.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="mint-token"
              variant="solid"
              disabled={!label.trim() || mint.isPending}
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
            if (label.trim()) mint.mutate();
          }}
        >
          <Field label="What is it for">
            <TextField
              autoFocus
              className="w-full"
              placeholder="claude"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>

          {/*
           * A scope is an unnested and() of tags, which is a set of pills — the same control
           * the list and the editor use. Asking somebody to type the grammar would be asking
           * them to learn it for the one case that does not need it.
           */}
          <Group
            label="Confine it to"
            hint={
              scope.length === 0
                ? "Nothing selected: it reaches the whole account."
                : `It sees only tasks carrying ${scope.join(" and ")}, and gives them to everything it creates.`
            }
          >
            <TagCloud
              tags={tags.data?.tags ?? []}
              selected={scope}
              onToggle={(slug) =>
                setScope((current) =>
                  current.includes(slug)
                    ? current.filter((s) => s !== slug)
                    : [...current, slug],
                )
              }
            />
          </Group>

          {error ? <p className="text-sm text-accent">{error}</p> : null}
        </form>
      )}
    </Dialog>
  );
}
