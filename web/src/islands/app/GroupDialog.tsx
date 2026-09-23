import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getTags } from "@app/api/actions/tags";
import {
  deleteGroupsById,
  patchGroupsById,
  postGroups,
} from "@app/api/actions/groups";
import { ApiError } from "@app/api/transport";
import type { Group } from "@app/api/types";
import { qk } from "@app/api/keys";
import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import { Group as Caption } from "@app/components/Field";
import { TextField } from "@app/components/TextField";
import { TagCloud } from "@app/islands/app/TagCloud";
import { Swatches } from "@app/components/Swatches";

/** Open on a group to change it, on "new" to write one, shut on null. */
export type Editing = Group | "new" | null;

/**
 * A group is a name and a set of tags, and this is both of them.
 *
 * The cloud can mint a tag nothing carries yet, which the filter cloud on the list cannot:
 * there, inventing a tag narrows the list to nothing, and here it is often the whole point —
 * naming the group is where somebody decides the tag exists, and the tasks follow.
 */
export function GroupDialog({
  editing,
  project,
  onClose,
}: {
  editing: Editing;
  /** The project on screen: a group is a view of one project's tags, and a new one is made in
   *  the project it is being made from. */
  project: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const tags = useQuery({
    queryKey: qk.tagsOf(project),
    queryFn: () => getTags(project),
  });
  const group = editing === "new" ? null : editing;

  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [color, setColor] = useState("");
  const [error, setError] = useState("");

  // Filled when it opens, not cleared when it closes: a dialog emptied on the way out shows the
  // empty version of itself for as long as it takes to close.
  useEffect(() => {
    if (!editing) return;
    setName(group?.name ?? "");
    setChosen(group?.tags ?? []);
    setColor(group?.color ?? "");
    setError("");
  }, [editing, group]);

  const done = () => {
    client.invalidateQueries({ queryKey: qk.groups });
    onClose();
  };
  const failed = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : "Something went wrong.");

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), tags: chosen, color: color };
      return group
        ? patchGroupsById(group.id, body)
        : postGroups(project, body);
    },
    onSuccess: done,
    onError: failed,
  });

  const remove = useMutation({
    mutationFn: () => deleteGroupsById(group?.id ?? ""),
    onSuccess: done,
    onError: failed,
  });

  const toggle = (slug: string) =>
    setChosen((current) =>
      current.includes(slug)
        ? current.filter((s) => s !== slug)
        : [...current, slug],
    );

  const usable = name.trim() !== "" && chosen.length > 0 && !save.isPending;

  return (
    <Dialog
      open={editing !== null}
      onClose={onClose}
      title={group ? "Group" : "New group"}
      footer={
        <>
          {group ? (
            <Button variant="danger" onClick={() => remove.mutate()}>
              Delete
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button
            variant="solid"
            disabled={!usable}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          className="w-full"
          placeholder="What is this set called?"
          data-autofocus
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />

        <Caption
          label="Tags"
          hint="A group can name a tag nothing carries yet. Write the tasks afterwards."
        >
          <TagCloud
            tags={tags.data?.tags ?? []}
            selected={chosen}
            onToggle={toggle}
            onCreate={(slug) =>
              setChosen((current) =>
                current.includes(slug) ? current : [...current, slug],
              )
            }
          />
        </Caption>

        <Caption
          label="Color"
          hint="What the tab wears while this group is the one on screen."
        >
          <Swatches value={color} onChange={setColor} />
        </Caption>

        {error ? <p className="text-sm text-accent">{error}</p> : null}
      </div>
    </Dialog>
  );
}
