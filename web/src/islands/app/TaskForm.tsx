import { useQuery } from "@tanstack/react-query";

import { getTags } from "@app/api/actions/tags";
import { qk } from "@app/api/keys";
import { Group as Caption } from "@app/components/Field";
import { NumberField } from "@app/components/NumberField";
import { Swatches } from "@app/components/Swatches";
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
  /** #rrggbb, or empty for none. It means whatever whoever set it decided it means. */
  color: string;
  /** The slug of the project it is in, or empty for the default. Its tags are that project's,
   *  which is what the cloud below offers. */
  project: string;
};

export const emptyDraft = (
  tags: string[] = [],
  title = "",
  project = "",
): Draft => ({
  title,
  description: "",
  priority: "0",
  tags,
  color: "",
  project,
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
  const tags = useQuery({
    queryKey: qk.tagsOf(draft.project),
    queryFn: () => getTags(draft.project),
  });
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
        title={draft.title}
        limits={{ assetMax: 10 << 20 }}
      />

      {/* Side by side, because the space beside the number was empty and a row of swatches is
          the shape that fits it. They are unrelated: one orders the list and the other means
          whatever the person who set it decided. */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        {/* A caption, not a label: Field wraps its child in one, and a label takes the first
            labelable thing inside it — which here is the decrease button rather than the
            field. */}
        <Caption
          label="Priority"
          hint={
            <>
              <p>
                Higher sorts higher. A pin beats any number, so a pinned task
                with nothing set still sits above an unpinned one set to nine.
              </p>
              <p>
                Negative numbers sort below nought, which is where a thing goes
                that you do not want to look at and do not want to lose either.
              </p>
              <p>
                The list leaves a wider gap wherever the number changes, so the
                bands are something to see rather than something to work out by
                reading down the column.
              </p>
            </>
          }
        >
          <NumberField
            label="Priority"
            value={draft.priority}
            onChange={(priority) => set({ priority })}
          />
        </Caption>

        <Caption
          label="Color"
          hint={
            <>
              <p>
                A bar down the left of the row, cropped by the card. That is the
                only place it shows.
              </p>
              <p>
                It means whatever you decide it means: nothing reads it, nothing
                sorts by it, and it is not a status. Two or three colors used
                the same way every time are worth more than eight used once.
              </p>
            </>
          }
        >
          <Swatches
            value={draft.color}
            onChange={(color) => set({ color })}
            none="No color"
          />
        </Caption>
      </div>

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
