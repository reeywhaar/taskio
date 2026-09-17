import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getGroups } from "@app/api/actions/groups";
import { qk } from "@app/api/keys";
import {
  BurgerIcon,
  CrossIcon,
  PencilIcon,
  PlusIcon,
} from "@app/components/icons/Icon";
import { GroupDialog, type Editing } from "@app/islands/app/GroupDialog";
import { markURI } from "@app/mark";
import type { Location } from "@app/islands/app/route";

/**
 * The nav rail is the only thing always in the same place: the groups, settings, and the docs
 * at the foot. Where you are is drawn in the foreground colour rather than hidden.
 *
 * Below the breakpoint it goes behind a burger and slides over as a sheet — the same component
 * with different chrome rather than a second nav.
 */
export function Nav({
  location,
  onGo,
}: {
  location: Location;
  onGo: (next: Location) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const groups = useQuery({ queryKey: qk.groups, queryFn: getGroups });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const onList =
    location.route.name === "list" || location.route.name === "task";

  /** Lit by what the list is filtered by rather than by what was last pressed: the tags are
   *  the state, and they can also be changed a pill at a time. */
  const litBy = (tags: string[]) => onList && same(location.filters.tags, tags);

  /**
   * The group being looked at, which is a question about the tags rather than about what was
   * last pressed — so it survives a reload, a link from somebody else, and the pills.
   */
  const current = (groups.data?.groups ?? []).find((g) => litBy(g.tags));
  const colour = current?.color ?? "";

  // The tab wears it, which is the whole point of a group having one: two windows open on two
  // groups are two icons rather than two of the same icon.
  useEffect(() => {
    const links =
      document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
    for (const link of links) {
      // The .ico is for browsers that will not read an svg, and they will not read a data URI
      // of one either: it is left alone and stays the brand.
      if (link.type !== "image/svg+xml") continue;
      link.href = colour ? markURI(colour) : "/favicon.svg";
    }
  }, [colour]);

  const show = (tags: string[]) => {
    setOpen(false);
    onGo({
      ...location,
      route: { name: "list" },
      filters: { ...location.filters, tags },
    });
  };

  const items = (
    <ul className="flex flex-1 flex-col gap-0.5 p-2">
      <li className="px-3 pt-1 pb-1 text-xs font-medium tracking-wide text-faint uppercase">
        Groups
      </li>

      {/* All is not a stored group and cannot be deleted: it is the list with nothing lit,
          which is where everybody starts. */}
      <Item label="All" lit={litBy([])} onClick={() => show([])} />

      {(groups.data?.groups ?? []).map((group) => (
        <Item
          key={group.id}
          label={group.name}
          lit={litBy(group.tags)}
          onClick={() => show(group.tags)}
          onEdit={() => {
            setOpen(false);
            setEditing(group);
          }}
        />
      ))}

      <li>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setEditing("new");
          }}
          className="inline-flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-left text-sm text-faint hover:bg-fill hover:text-fg"
        >
          <PlusIcon /> New group
        </button>
      </li>

      <li className="mt-4">
        <Item
          label="Settings"
          lit={location.route.name === "settings"}
          onClick={() => {
            setOpen(false);
            onGo({ ...location, route: { name: "settings" } });
          }}
          bare
        />
      </li>

      {/* An ordinary link to a page the server renders, so it is the one entry here that
          leaves the application. The page is the same text an agent reads, and one page cannot
          disagree with itself.

          At the bottom rather than behind a rule: a rule in a list this short is a heavier mark
          than the thing it separates, and the distance says the same thing without drawing
          anything. */}
      <li className="mt-auto">
        <a
          className="block rounded-md px-3 py-2 text-sm text-muted hover:bg-fill hover:text-fg"
          href="/docs"
        >
          Docs
        </a>
      </li>
    </ul>
  );

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-2 py-2 md:hidden">
        <button
          type="button"
          aria-label="Menu"
          aria-expanded={open}
          className="rounded-md p-2 text-lg hover:bg-surface"
          onClick={() => setOpen(true)}
        >
          <BurgerIcon />
        </button>
        <Mark colour={colour} />
        <span className="font-semibold">taskio</span>
      </div>

      <nav className="hidden w-48 shrink-0 flex-col overflow-y-auto bg-surface shadow-rail md:flex lg:w-60 xl:w-72">
        <div className="flex items-center gap-2 px-4 py-3 font-semibold">
          <Mark colour={colour} />
          taskio
        </div>
        {items}
      </nav>

      {/* Mounted whether or not it is open, because a sheet that is unmounted when shut has
          nothing to animate on the way out — it would slide in and then vanish.

          inert while shut rather than merely invisible: it is still in the page, and a rail
          nobody can see is not a rail anybody should be able to tab into. */}
      <div
        className={`fixed inset-0 z-50 md:hidden ${open ? "" : "pointer-events-none"}`}
        inert={!open}
      >
        <button
          type="button"
          aria-label="Close menu"
          tabIndex={open ? 0 : -1}
          className={`absolute inset-0 bg-black/50 transition-opacity duration-200 motion-reduce:transition-none ${
            open ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setOpen(false)}
        />
        <div
          className={`relative h-full w-56 transition-transform duration-200 ease-out motion-reduce:transition-none ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <nav className="flex h-full w-full flex-col bg-surface shadow-rail">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="flex items-center gap-2 font-semibold">
                <Mark colour={colour} />
                taskio
              </span>
              <button
                type="button"
                aria-label="Close menu"
                className="rounded-md p-1 hover:bg-fill"
                onClick={() => setOpen(false)}
              >
                <CrossIcon />
              </button>
            </div>
            {items}
          </nav>
        </div>
      </div>

      <GroupDialog editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}

/** Two sets of tags, compared as sets: the order they were lit in is not part of the filter. */
function same(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const inA = new Set(a);
  return b.every((slug) => inA.has(slug));
}

/**
 * The mark from the browser tab, beside the name, wearing whatever the tab is wearing.
 *
 * Drawn from the same geometry as the tab's icon rather than a second copy of the two
 * rectangles — a mark drawn in two places is a mark that will be changed in one of them. It
 * carries its own pale ground, so it is a tile at either theme and needs nothing from the
 * palette around it.
 */
function Mark({ colour }: { colour: string }) {
  return (
    <img
      src={colour ? markURI(colour) : "/favicon.svg"}
      alt=""
      className="size-5 rounded-[3px]"
    />
  );
}

/**
 * One row of the rail, and the pencil beside it where there is something to edit.
 *
 * The pencil waits for the pointer, because a rail of names with a control on every line is a
 * rail about editing rather than about where you are. Where there is no pointer to wait for it
 * is simply there.
 */
function Item({
  label,
  lit,
  onClick,
  onEdit,
  bare = false,
}: {
  label: string;
  lit: boolean;
  onClick: () => void;
  onEdit?: () => void;
  /** Already inside an <li>, because the caller needed to space it. */
  bare?: boolean;
}) {
  const row = (
    <div className="group/row flex items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        aria-current={lit ? "page" : undefined}
        className={`min-w-0 flex-1 truncate rounded-md px-3 py-2 text-left text-sm ${
          lit
            ? "bg-fill font-medium text-brand"
            : "text-muted hover:bg-fill hover:text-fg"
        }`}
      >
        {label}
      </button>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${label}`}
          className="rounded-md p-1.5 text-faint opacity-0 hover:bg-fill hover:text-fg focus-visible:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100"
        >
          <PencilIcon />
        </button>
      ) : null}
    </div>
  );
  return bare ? row : <li>{row}</li>;
}
