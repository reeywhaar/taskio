import { useState } from "react";

import { PlusIcon } from "@app/components/icons/Icon";
import type { Tag } from "@app/api/types";

/**
 * One component, used twice: on the list it filters, in the editor it assigns. The caller owns
 * what the change means.
 *
 * A pill shows the slug itself — there is no separate display name — so what is on the pill is
 * what goes in the URL and what an agent would type.
 */
export function TagCloud({
  tags,
  selected,
  onToggle,
  onCreate,
}: {
  tags: Tag[];
  selected: string[];
  onToggle: (slug: string) => void;
  /** Only the editor's cloud offers this: a tag exists once a task carries it, so inventing
   *  one on the filter screen would narrow the list to nothing. */
  onCreate?: (slug: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const known = new Set(tags.map((t) => t.slug));
  const shown = [
    ...tags.map((t) => t.slug),
    ...selected.filter((s) => !known.has(s)),
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((slug) => {
        const on = selected.includes(slug);
        return (
          <button
            key={slug}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(slug)}
            className={`rounded-full px-2.5 py-1 text-xs ${
              on
                ? "bg-brand text-brand-ink"
                : "bg-fill text-muted hover:text-fg"
            }`}
          >
            {slug}
          </button>
        );
      })}

      {onCreate ? (
        adding ? (
          <input
            autoFocus
            value={draft}
            placeholder="new tag"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setAdding(false);
              setDraft("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setAdding(false);
                setDraft("");
              }
              if (e.key !== "Enter") return;
              e.preventDefault();
              // Folded rather than refused: somebody typing "Home Repairs" means home-repairs.
              const slug = draft
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9_ -]/g, "")
                .replace(/\s+/g, "-")
                .replace(/^-+|-+$/g, "");
              if (slug) onCreate(slug);
              setAdding(false);
              setDraft("");
            }}
            className="w-28 rounded-full border-[1.5px] border-line bg-bg px-2.5 py-1 text-xs"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-dashed border-line px-2.5 py-1 text-xs text-muted hover:border-faint hover:text-fg"
          >
            <PlusIcon /> New tag
          </button>
        )
      ) : null}
    </div>
  );
}
