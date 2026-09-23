import type { Tag, Token } from "@app/api/types";
import { Field, Group } from "@app/components/Field";
import { Select } from "@app/components/Select";
import { TextField } from "@app/components/TextField";
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
  scope: string[];
};

export const blankToken: TokenForm = {
  label: "",
  idle: "0",
  expires: "0",
  scope: [],
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
  tags,
  current,
}: {
  value: TokenForm;
  onChange: (next: TokenForm) => void;
  tags: Tag[];
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

      {/*
       * A scope is an unnested and() of tags, which is a set of pills — the same control the
       * list and the editor use. Asking somebody to type the grammar would be asking them to
       * learn it for the one case that does not need it.
       */}
      <Group
        label="Confine it to"
        hint={
          value.scope.length === 0
            ? "Nothing selected: it reaches the whole account."
            : `It sees only tasks carrying ${value.scope.join(" and ")}, and everything it writes has to carry them too.`
        }
      >
        <TagCloud
          tags={tags}
          selected={value.scope}
          onToggle={(slug) =>
            set({
              scope: value.scope.includes(slug)
                ? value.scope.filter((s) => s !== slug)
                : [...value.scope, slug],
            })
          }
        />
      </Group>
    </>
  );
}

/** The moment a relative expiry lands on, counted from now, or 0 for none. */
export function expiresAt(expires: string): number {
  const seconds = Number(expires);
  return seconds > 0 ? Math.floor(Date.now() / 1000) + seconds : 0;
}
