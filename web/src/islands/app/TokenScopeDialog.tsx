import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getTags } from "@app/api/actions/tags";
import { patchTokensById } from "@app/api/actions/tokens";
import { ApiError } from "@app/api/transport";
import type { Token } from "@app/api/types";
import { qk } from "@app/api/keys";
import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import { Group } from "@app/components/Field";
import { TagCloud } from "@app/islands/app/TagCloud";
import { parseAnd, printAnd } from "@app/islands/app/route";

/**
 * Changing what a token reaches, without reissuing it.
 *
 * The value in somebody's config keeps working and starts seeing the new scope on its next
 * request. Reissuing instead means finding every place the old one was pasted, which is the
 * work this avoids.
 */
export function TokenScopeDialog({
  token,
  onClose,
}: {
  /** The token being edited, or null when the dialog is shut. */
  token: Token | null;
  onClose: (saved?: boolean) => void;
}) {
  const client = useQueryClient();
  const tags = useQuery({ queryKey: qk.tags, queryFn: getTags });
  const [scope, setScope] = useState<string[]>([]);
  const [error, setError] = useState("");

  // Seeded from the token each time one is opened, so an abandoned edit is abandoned.
  useEffect(() => {
    if (!token) return;
    setScope(parseAnd(token.scope));
    setError("");
  }, [token]);

  const save = useMutation({
    mutationFn: () => patchTokensById(token!.id, { scope: printAnd(scope) }),
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
      title="What this token reaches"
      footer={
        <>
          <Button
            variant="solid"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          <span className="font-mono text-xs text-faint">{token?.id}</span>{" "}
          {token?.label}
        </p>

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

        <p className="text-xs text-faint">
          The token itself does not change, so whatever holds it keeps working.
        </p>

        {error ? <p className="text-sm text-accent">{error}</p> : null}
      </div>
    </Dialog>
  );
}
