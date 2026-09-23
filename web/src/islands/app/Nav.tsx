import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getGroups, putGroupsOrder } from "@app/api/actions/groups";
import { getProjects, putProjectsOrder } from "@app/api/actions/projects";
import type { Group, Project } from "@app/api/types";
import { qk } from "@app/api/keys";
import {
  BurgerIcon,
  CrossIcon,
  PencilIcon,
  PlusIcon,
} from "@app/components/icons/Icon";
import { useCarry } from "@app/islands/app/carry";
import { GroupDialog, type Editing } from "@app/islands/app/GroupDialog";
import {
  ProjectDialog,
  type EditingProject,
} from "@app/islands/app/ProjectDialog";
import { markURI } from "@app/mark";
import type { Location } from "@app/islands/app/route";

/**
 * The nav rail is the only thing always in the same place: the projects, the open one's groups,
 * settings, and the docs at the foot. Where you are is drawn in the foreground color rather
 * than hidden.
 *
 * A project row is the whole project, which is what All used to be: the list with nothing lit.
 * Only the open project's groups are drawn, a step in from it — a group is a view of one
 * project's tags, and every project's groups at once is a rail about the other projects.
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
  const [editingProject, setEditingProject] = useState<EditingProject>(null);
  const client = useQueryClient();

  const here = location.filters.project;
  const projects = useQuery({ queryKey: qk.projects, queryFn: getProjects });
  const groups = useQuery({
    queryKey: qk.groupsOf(here),
    queryFn: () => getGroups(here),
  });
  const listedProjects = projects.data?.projects ?? [];
  /** The project on screen: named in the URL, or the default when it names none. */
  const opened = listedProjects.find((p) =>
    here ? p.slug === here : p.default,
  );

  /** The group being carried, and the one it would be dropped on. */
  const [carrying, setCarrying] = useState<string | null>(null);
  const [onto, setOnto] = useState<string | null>(null);

  const listed = groups.data?.groups ?? [];

  const arrange = useMutation({
    mutationFn: (ids: string[]) => putGroupsOrder(here, { ids }),
    onMutate: (ids) => {
      const key = qk.groupsOf(here);
      const before = client.getQueryData<{ groups: Group[] }>(key);
      if (before) {
        const by = new Map(before.groups.map((g) => [g.id, g]));
        client.setQueryData(key, {
          groups: ids.flatMap((id) => by.get(id) ?? []),
        });
      }
      return before;
    },
    onError: (_err, _ids, before) =>
      before && client.setQueryData(qk.groupsOf(here), before),
    onSettled: () => client.invalidateQueries({ queryKey: qk.groups }),
  });

  /** The projects being carried, on the same terms as the groups. */
  const [carryingProject, setCarryingProject] = useState<string | null>(null);
  const [ontoProject, setOntoProject] = useState<string | null>(null);
  const arrangeProjects = useMutation({
    mutationFn: (ids: string[]) => putProjectsOrder({ ids }),
    onMutate: (ids) => {
      const before = client.getQueryData<{ projects: Project[] }>(qk.projects);
      if (before) {
        const by = new Map(before.projects.map((p) => [p.id, p]));
        client.setQueryData(qk.projects, {
          projects: ids.flatMap((id) => by.get(id) ?? []),
        });
      }
      return before;
    },
    onError: (_err, _ids, before) =>
      before && client.setQueryData(qk.projects, before),
    onSettled: () => client.invalidateQueries({ queryKey: qk.projects }),
  });
  const dropProject = () => {
    const ids = listedProjects.map((p) => p.id);
    const from = carryingProject ? ids.indexOf(carryingProject) : -1;
    const to = ontoProject ? ids.indexOf(ontoProject) : -1;
    setCarryingProject(null);
    setOntoProject(null);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, ids[from]!);
    arrangeProjects.mutate(next);
  };
  const markForProject = (id: string): "above" | "below" | null => {
    if (!carryingProject || ontoProject !== id) return null;
    const ids = listedProjects.map((p) => p.id);
    return ids.indexOf(carryingProject) < ids.indexOf(id) ? "below" : "above";
  };

  /**
   * Nothing moves until the group is let go, and All is not in it.
   *
   * The same arrangement as the tag cloud's, one axis over: a bar above or below the row it
   * would land on, drawn as a pseudo-element so the rows do not shift under the finger.
   */
  const drop = () => {
    const ids = listed.map((g) => g.id);
    const from = carrying ? ids.indexOf(carrying) : -1;
    const to = onto ? ids.indexOf(onto) : -1;
    setCarrying(null);
    setOnto(null);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, ids[from]!);
    arrange.mutate(next);
  };

  const markFor = (id: string): "above" | "below" | null => {
    if (!carrying || onto !== id) return null;
    const ids = listed.map((g) => g.id);
    return ids.indexOf(carrying) < ids.indexOf(id) ? "below" : "above";
  };

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
  const color = current?.color ?? "";

  // The tab wears it, which is the whole point of a group having one: two windows open on two
  // groups are two icons rather than two of the same icon.
  useEffect(() => {
    const links =
      document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
    for (const link of links) {
      // The .ico is for browsers that will not read an svg, and they will not read a data URI
      // of one either: it is left alone and stays the brand.
      if (link.type !== "image/svg+xml") continue;
      link.href = color ? markURI(color) : "/favicon.svg";
    }
  }, [color]);

  const show = (tags: string[]) => {
    setOpen(false);
    onGo({
      ...location,
      route: { name: "list" },
      filters: { ...location.filters, tags },
    });
  };

  /** The whole of a project. Its tags are its own, so none of the ones lit here carry over. */
  const showProject = (project: Project) => {
    setOpen(false);
    onGo({
      ...location,
      route: { name: "list" },
      filters: {
        ...location.filters,
        project: project.default ? "" : project.slug,
        tags: [],
      },
    });
  };

  const items = (
    <ul className="flex flex-1 flex-col gap-0.5 p-2">
      {listedProjects.map((project) => {
        const isOpen = project.id === opened?.id;
        return (
          <Fragment key={project.id}>
            <Item
              id={project.id}
              kind="project"
              label={project.name}
              lit={isOpen && litBy([])}
              opened={isOpen}
              carried={carryingProject === project.id}
              mark={markForProject(project.id)}
              onClick={() => showProject(project)}
              onEdit={() => {
                setOpen(false);
                setEditingProject(project);
              }}
              onOver={(id) => {
                setCarryingProject(project.id);
                setOntoProject(id && id !== project.id ? id : null);
              }}
              onDrop={dropProject}
            />

            {/* A step in, so they read as belonging to the project above them. */}
            {isOpen ? (
              <li>
                <ul className="ml-3 flex flex-col gap-0.5">
                  {listed.map((group) => (
                    <Item
                      key={group.id}
                      id={group.id}
                      label={group.name}
                      lit={litBy(group.tags)}
                      carried={carrying === group.id}
                      mark={markFor(group.id)}
                      onClick={() => show(group.tags)}
                      onEdit={() => {
                        setOpen(false);
                        setEditing(group);
                      }}
                      onOver={(id) => {
                        setCarrying(group.id);
                        setOnto(id && id !== group.id ? id : null);
                      }}
                      onDrop={drop}
                    />
                  ))}
                  {/* Smaller than the rows: they make a row rather than being one, and at the
                      rows' size they read as one more group and one more project. */}
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        setEditing("new");
                      }}
                      className="inline-flex w-full items-center gap-1 rounded-md px-3 py-1 text-left text-xs text-faint hover:bg-shade hover:text-fg"
                    >
                      <PlusIcon /> New group
                    </button>
                  </li>
                </ul>
              </li>
            ) : null}
          </Fragment>
        );
      })}

      <li>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setEditingProject("new");
          }}
          className="inline-flex w-full items-center gap-1 rounded-md px-3 py-1 text-left text-xs text-faint hover:bg-shade hover:text-fg"
        >
          <PlusIcon /> New project
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
          className="block rounded-md px-3 py-2 text-sm text-muted hover:bg-shade hover:text-fg"
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
          className="rounded-md p-2 text-lg hover:bg-shade"
          onClick={() => setOpen(true)}
        >
          <BurgerIcon />
        </button>
        <Mark color={color} />
        <span className="font-semibold">taskio</span>
      </div>

      <nav className="hidden w-48 shrink-0 flex-col overflow-y-auto bg-surface shadow-rail md:flex lg:w-60 xl:w-72">
        <div className="flex items-center gap-2 px-4 py-3 font-semibold">
          <Mark color={color} />
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
                <Mark color={color} />
                taskio
              </span>
              <button
                type="button"
                aria-label="Close menu"
                className="rounded-md p-1 hover:bg-shade"
                onClick={() => setOpen(false)}
              >
                <CrossIcon />
              </button>
            </div>
            {items}
          </nav>
        </div>
      </div>

      <GroupDialog
        editing={editing}
        project={here}
        onClose={() => setEditing(null)}
      />
      <ProjectDialog
        editing={editingProject}
        onClose={() => setEditingProject(null)}
        onGo={(project) => showProject(project)}
        onGone={() =>
          onGo({
            ...location,
            route: { name: "list" },
            filters: { ...location.filters, project: "", tags: [] },
          })
        }
      />
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
function Mark({ color }: { color: string }) {
  return (
    <img
      src={color ? markURI(color) : "/favicon.svg"}
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
 *
 * A group or a project row also carries: press and move and it goes somewhere else among its
 * own kind. A group cannot be dropped among the projects, nor a project among one's groups.
 */
function Item({
  id,
  kind = "group",
  label,
  lit,
  opened = false,
  carried = false,
  mark = null,
  onClick,
  onEdit,
  onOver,
  onDrop,
  bare = false,
}: {
  /** The group or project this row is, where it is one. */
  id?: string;
  kind?: "group" | "project";
  label: string;
  lit: boolean;
  /** The project on screen, which reads as the open one even while a group inside it is lit. */
  opened?: boolean;
  carried?: boolean;
  mark?: "above" | "below" | null;
  onClick: () => void;
  onEdit?: () => void;
  onOver?: (id: string | null) => void;
  onDrop?: () => void;
  /** Already inside an <li>, because the caller needed to space it. */
  bare?: boolean;
}) {
  const carry = useCarry({
    find: `[data-${kind}]`,
    enabled: !!onOver,
    onOver: (el) => onOver?.(el?.dataset[kind] ?? null),
    onDrop: () => onDrop?.(),
  });

  const row = (
    // The ground belongs to the row, not to the name inside it. On the name it stopped short of
    // the pencil, which then sat outside the thing it edits with a strip of rail between them —
    // and the current group looked like a shape with a button next to it rather than one row.
    <div
      className={`group/row relative flex items-center gap-1 rounded-md ${
        carried ? "opacity-40" : ""
      } ${lit ? "bg-shade" : "hover:bg-shade"}`}
    >
      <button
        type="button"
        {...{ [`data-${kind}`]: id }}
        onPointerDown={carry.press}
        onPointerMove={carry.move}
        onPointerUp={carry.release}
        onPointerCancel={carry.cancel}
        onClick={() => {
          if (carry.spent.current) {
            carry.spent.current = false;
            return;
          }
          onClick();
        }}
        aria-current={lit ? "page" : undefined}
        className={`min-w-0 flex-1 truncate rounded-md px-3 py-2 text-left text-sm select-none ${
          onOver ? "touch-none" : ""
        } ${
          lit
            ? "font-medium text-brand"
            : opened
              ? "font-medium text-fg"
              : "text-muted group-hover/row:text-fg"
        }`}
      >
        {label}
      </button>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${label}`}
          // No ground of its own: it is standing on the row's now, and a shade over a shade
          // is a second rectangle inside the one this change was about.
          className="mr-1 rounded-md p-1.5 text-faint opacity-0 hover:text-fg focus-visible:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100"
        >
          <PencilIcon />
        </button>
      ) : null}
      {/* The bar itself rather than a pseudo-element on the row: it is absolute, so it takes
          no space and the rows do not shift under the finger to make room for it. */}
      {mark ? (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-3 h-0.5 rounded-full bg-fg ${
            mark === "above" ? "-top-0.5" : "-bottom-0.5"
          }`}
        />
      ) : null}
    </div>
  );
  return bare ? row : <li>{row}</li>;
}
