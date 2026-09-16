import { useQuery } from "@tanstack/react-query";

import { getTags } from "@app/api/actions/tags";
import { qk } from "@app/api/keys";
import { Field } from "@app/components/Field";
import { TextField } from "@app/components/TextField";
import { Editor } from "@app/islands/app/Editor";
import { TagCloud } from "@app/islands/app/TagCloud";

/** What a task is made of, and what either dialog is editing. */
export type Draft = {
  title: string;
  description: string;
  /** A string, not a number: a number input being cleared reads as NaN, and "" is what
   *  somebody typing -1 passes through on the way. */
  priority: string;
  tags: string[];
};

export const emptyDraft = (tags: string[] = []): Draft => ({
  title: "",
  description: "",
  priority: "0",
  tags,
});

/**
 * The fields a task has, wherever it is being written.
 *
 * Shared by the dialog that makes one and the dialog that changes one, because the fields are
 * the same fields and two copies of them drift — a hint reworded in one, a width fixed in the
 * other. What differs between those two errands is everything around these: an id to show, a
 * delete, mentions that only exist once a task does.
 */
export function TaskForm({
  draft,
  onChange,
  titlePlaceholder,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  titlePlaceholder?: string;
}) {
  const tags = useQuery({ queryKey: qk.tags, queryFn: getTags });
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });

  return (
    <>
      <TextField
        className="w-full"
        placeholder={titlePlaceholder}
        data-autofocus={titlePlaceholder ? true : undefined}
        value={draft.title}
        onChange={(e) => set({ title: e.target.value })}
      />

      <Editor
        value={draft.description}
        onChange={(description) => set({ description })}
        limits={{ assetMax: 10 << 20 }}
      />

      <Field
        label="Priority"
        hint="Higher sorts higher. A pin beats any number."
      >
        <TextField
          type="number"
          className="w-24"
          value={draft.priority}
          onChange={(e) => set({ priority: e.target.value })}
        />
      </Field>

      <TagCloud
        tags={tags.data?.tags ?? []}
        selected={draft.tags}
        onToggle={(slug) =>
          set({
            tags: draft.tags.includes(slug)
              ? draft.tags.filter((s) => s !== slug)
              : [...draft.tags, slug],
          })
        }
        onCreate={(slug) =>
          set({
            tags: draft.tags.includes(slug)
              ? draft.tags
              : [...draft.tags, slug],
          })
        }
      />
    </>
  );
}
