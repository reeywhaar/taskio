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
import { BRAND, markURI } from "@app/mark";

/**
 * What a group may wear.
 *
 * A short list rather than a picker: the colour is worn by a 16px tile in a browser tab, where
 * what matters is telling one window from another at a glance — eight that are obviously
 * different do that, and sixteen million do not.
 */
const COLOURS = [
  BRAND,
  "#e11d48",
  "#d97706",
  "#15803d",
  "#0d9488",
  "#2563eb",
  "#7c3aed",
  "#db2777",
];

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
  onClose,
}: {
  editing: Editing;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const tags = useQuery({ queryKey: qk.tags, queryFn: getTags });
  const group = editing === "new" ? null : editing;

  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [colour, setColour] = useState("");
  const [error, setError] = useState("");

  // Filled when it opens, not cleared when it closes: a dialog emptied on the way out shows the
  // empty version of itself for as long as it takes to close.
  useEffect(() => {
    if (!editing) return;
    setName(group?.name ?? "");
    setChosen(group?.tags ?? []);
    setColour(group?.color ?? "");
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
      const body = { name: name.trim(), tags: chosen, color: colour };
      return group ? patchGroupsById(group.id, body) : postGroups(body);
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
          <Button onClick={onClose}>Cancel</Button>
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
          label="Colour"
          hint="What the tab wears while this group is the one on screen."
        >
          <div className="flex flex-wrap items-center gap-2">
            {COLOURS.map((swatch) => {
              // The brand is stored as no colour at all, so a group that was never given one
              // and a group given the brand are the same group.
              const value = swatch === BRAND ? "" : swatch;
              const on = colour === value;
              return (
                <button
                  key={swatch}
                  type="button"
                  aria-label={swatch === BRAND ? "The brand colour" : swatch}
                  aria-pressed={on}
                  onClick={() => setColour(value)}
                  className={`size-7 rounded-md ring-offset-2 ring-offset-surface ${
                    on ? "ring-2 ring-fg" : ""
                  }`}
                  style={{ background: swatch }}
                />
              );
            })}
            <img
              src={markURI(colour)}
              alt=""
              className="ml-1 size-7 rounded-[4px]"
            />
          </div>
        </Caption>

        {error ? <p className="text-sm text-accent">{error}</p> : null}
      </div>
    </Dialog>
  );
}
