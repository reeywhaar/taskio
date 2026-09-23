import { useQuery } from "@tanstack/react-query";

import { getProjects } from "@app/api/actions/projects";
import { getTags } from "@app/api/actions/tags";
import { qk } from "@app/api/keys";
import type { Token } from "@app/api/types";
import { Button } from "@app/components/Button";
import { Field, Group } from "@app/components/Field";
import { Select } from "@app/components/Select";
import { TextField } from "@app/components/TextField";
import { projectNamed, ProjectField } from "@app/islands/app/ProjectPicker";
import { TagCloud } from "@app/islands/app/TagCloud";

const DAY = 86400;

/**
 * What a token is, as a form: minting one and editing one ask the same four questions, so they
 * are one set of fields rather than two that drift apart.
 *
 * `expires` is "keep" for an expiry already set and left alone, "0" for never, and otherwise a
 * number of seconds from the moment it is saved. `idle` is seconds of disuse, "0" for never.
 */
export type TokenForm = {
  label: string;
  idle: string;
  expires: string;
  rows: ReachRow[];
};

/**
 * One project a token reaches, and what confines it there.
 *
 * `any` is whether a task needs one of the tags or all of them. Several tags picked mean any —
 * garden and reading is a token for both, not for the tasks that happen to be in both — and all
 * is only what a token minted before that already had.
 */
export type ReachRow = {
  /** The project's slug, or empty for the default. */
  project: string;
  tags: string[];
  any: boolean;
  /** A project since deleted, which the token still names. */
  deleted?: boolean;
};

export const blankToken: TokenForm = {
  label: "",
  idle: "0",
  expires: "0",
  rows: [{ project: "", tags: [], any: true }],
};

const IDLE: [string, string][] = [
  ["0", "never"],
  [String(DAY), "a day"],
  [String(7 * DAY), "a week"],
  [String(30 * DAY), "a month"],
];

/**
 * A length of time as somebody would say it. Exported so the token's row and its dialog say
 * the same thing: the row rounded a two-day limit up to "a week" while the dialog, which has to
 * offer the value as it is, said "2 days".
 */
export function lengthName(seconds: number): string {
  const preset = IDLE.find(([v]) => v === String(seconds));
  if (preset && seconds > 0) return preset[1];
  if (seconds % DAY === 0) return `${seconds / DAY} days`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hours`;
  return `${Math.round(seconds / 60)} minutes`;
}

const EXPIRES: [string, string][] = [
  ["0", "never"],
  [String(DAY), "a day from now"],
  [String(7 * DAY), "a week from now"],
  [String(30 * DAY), "a month from now"],
  [String(365 * DAY), "a year from now"],
];

export function TokenFields({
  value,
  onChange,
  current,
}: {
  value: TokenForm;
  onChange: (next: TokenForm) => void;
  /** The token being edited, whose own values have to be on offer even where no preset
   *  matches them: a token minted from the command line can have any length at all. */
  current?: Token;
}) {
  const set = (patch: Partial<TokenForm>) => onChange({ ...value, ...patch });

  const idle = [...IDLE];
  if (current && current.idle_seconds > 0) {
    const mine = String(current.idle_seconds);
    if (!idle.some(([v]) => v === mine))
      idle.push([mine, lengthName(current.idle_seconds)]);
  }

  const expires = current?.expires_at
    ? [
        [
          "keep",
          `on ${new Date(current.expires_at * 1000).toLocaleDateString()}`,
        ] as [string, string],
        ...EXPIRES,
      ]
    : EXPIRES;

  return (
    <>
      <Field label="What is it for">
        <TextField
          data-autofocus
          className="w-full"
          placeholder="claude"
          value={value.label}
          onChange={(e) => set({ label: e.target.value })}
        />
      </Field>

      {/* The two clocks, side by side at one width: they are one question asked twice — when
          does this stop — and stacked, each select was only as wide as its longest option, so
          they sat one under the other at two different widths.

          Unused for: a credential nobody has used for a month is one still open on a machine
          nobody remembers, counted from its last use or from minting. Stop working: a date it
          stops on whether or not it is used, for something that should only have it a while. */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Retire it if unused for">
          <Select
            className="w-full"
            value={value.idle}
            onChange={(e) => set({ idle: e.target.value })}
          >
            {idle.map(([v, name]) => (
              <option key={v} value={v}>
                {name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Stop working">
          <Select
            className="w-full"
            value={value.expires}
            onChange={(e) => set({ expires: e.target.value })}
          >
            {expires.map(([v, name]) => (
              <option key={v} value={v}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Rows value={value.rows} onChange={(rows) => set({ rows })} />
    </>
  );
}

/** The moment a relative expiry lands on, counted from now, or 0 for none. */
export function expiresAt(expires: string): number {
  const seconds = Number(expires);
  return seconds > 0 ? Math.floor(Date.now() / 1000) + seconds : 0;
}

/** "a, b or c", for a sentence about the tags. */
function list(tags: string[], word: "or" | "and"): string {
  return tags.length < 2
    ? tags.join("")
    : `${tags.slice(0, -1).join(", ")} ${word} ${tags.at(-1)}`;
}

/** What a row reaches, said as a sentence. */
function reach(row: ReachRow): string {
  if (row.tags.length === 0) return "The whole project.";
  if (row.tags.length === 1)
    return `Tasks carrying ${row.tags[0]}, and everything it writes has to carry it too.`;
  return row.any
    ? `Tasks carrying any of ${list(row.tags, "or")}. Everything it writes carries at least one.`
    : `Only tasks carrying all of ${list(row.tags, "and")}.`;
}

/**
 * The projects a token reaches, a row each: the project, its tags, and a way to take the row
 * away. A project appears once — the picker will not offer one already on another row — and a
 * token keeps at least one, because a token that reaches nothing is a revoked one by another
 * name.
 */
function Rows({
  value,
  onChange,
}: {
  value: ReachRow[];
  onChange: (next: ReachRow[]) => void;
}) {
  const projects = useQuery({ queryKey: qk.projects, queryFn: getProjects });
  const all = projects.data?.projects ?? [];
  /** The real slug of every row's project, so an empty one counts as the default it means. */
  const taken = value.map(
    (row) => projectNamed(all, row.project)?.slug ?? row.project,
  );
  const free = all.filter((p) => !taken.includes(p.slug));

  const put = (at: number, row: ReachRow) =>
    onChange(value.map((r, i) => (i === at ? row : r)));

  return (
    <Group
      label="Reaches"
      hint="A row per project. With no tags picked it reaches the whole project; with several, any of them."
    >
      <div className="flex flex-col gap-3">
        {value.map((row, at) => (
          <Row
            key={at}
            row={row}
            taken={taken.filter((_, i) => i !== at)}
            onChange={(next) => put(at, next)}
            onRemove={
              value.length > 1
                ? () => onChange(value.filter((_, i) => i !== at))
                : undefined
            }
          />
        ))}
        {free.length > 0 ? (
          <div>
            <Button
              size="bar"
              onClick={() =>
                onChange([
                  ...value,
                  { project: free[0]!.slug, tags: [], any: true },
                ])
              }
            >
              + Add project
            </Button>
          </div>
        ) : null}
      </div>
    </Group>
  );
}

function Row({
  row,
  taken,
  onChange,
  onRemove,
}: {
  row: ReachRow;
  /** The other rows' projects, which this one cannot be changed to. */
  taken: string[];
  onChange: (next: ReachRow) => void;
  /** Absent on the last row: a token keeps one. */
  onRemove?: () => void;
}) {
  const tags = useQuery({
    queryKey: qk.tagsOf(row.project),
    queryFn: () => getTags(row.project),
    enabled: !row.deleted,
  });

  return (
    <div className="flex flex-col gap-2 rounded-md bg-shade p-3">
      <div className="flex items-center gap-2">
        {row.deleted ? (
          <span className="text-sm text-accent">
            {row.project} was deleted, and asking for it is refused. The row
            goes when this token&apos;s projects are next saved.
          </span>
        ) : (
          <div className="w-48">
            <ProjectField
              value={row.project}
              taken={taken}
              // Its tags are the last project's, so they do not come along.
              onChange={(project) => onChange({ project, tags: [], any: true })}
            />
          </div>
        )}
        <span className="flex-1" />
        {onRemove ? (
          <Button
            size="bar"
            onClick={onRemove}
            aria-label="Remove this project"
            title="Remove this project"
          >
            −
          </Button>
        ) : null}
      </div>

      {row.deleted ? null : (
        <>
          <TagCloud
            tags={tags.data?.tags ?? []}
            selected={row.tags}
            onToggle={(slug) =>
              onChange({
                ...row,
                tags: row.tags.includes(slug)
                  ? row.tags.filter((s) => s !== slug)
                  : [...row.tags, slug],
              })
            }
          />
          <p className="text-xs text-muted">
            {reach(row)}{" "}
            {/* An old token that needs every tag is the one case here where the pills do not
                mean what they look like, so it says so where it can be seen. The switch is its
                own press: changing a pill never widens a token on the quiet. */}
            {!row.any && row.tags.length > 1 ? (
              <Button
                variant="link"
                onClick={() => onChange({ ...row, any: true })}
              >
                Reach any of them instead
              </Button>
            ) : null}
          </p>
        </>
      )}
    </div>
  );
}
