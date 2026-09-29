import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { getProjects } from "@app/api/actions/projects";
import type { Project } from "@app/api/types";
import { qk } from "@app/api/keys";
import { Dialog } from "@app/components/Dialog";
import { ChevronDownIcon } from "@app/components/icons/Icon";

/** The project a slug names, where empty is the default — the URL's own rule. */
export function projectNamed(
  projects: Project[],
  slug: string,
): Project | undefined {
  return projects.find((p) => (slug ? p.slug === slug : p.default));
}

/**
 * Choosing one project: the same pills as a tag cloud, and only one of them can be lit.
 *
 * A press is the choice. There is nothing to compose — one pill, not a set of them — so a Save
 * after it would be a second press asking whether the first one was meant.
 */
export function ProjectSelectDialog({
  open,
  title,
  current,
  taken = [],
  hint,
  onChoose,
  onClose,
}: {
  open: boolean;
  title: string;
  /** The slug lit when it opens: where the task is now. Empty is the default project, and
   *  null lights nothing — choosing one to add rather than choosing where something goes. */
  current: string | null;
  /** Slugs that cannot be chosen here, because something else already holds them. */
  taken?: string[];
  /** What choosing does, under the pills. */
  hint?: ReactNode;
  onChoose: (project: Project) => void;
  onClose: () => void;
}) {
  const projects = useQuery({ queryKey: qk.projects, queryFn: getProjects });
  const list = projects.data?.projects ?? [];
  const lit = current === null ? undefined : projectNamed(list, current);

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="flex flex-wrap gap-1.5">
        {list.map((project) => {
          const on = project.id === lit?.id;
          return (
            <button
              key={project.id}
              type="button"
              aria-pressed={on}
              disabled={!on && taken.includes(project.slug)}
              onClick={() => onChoose(project)}
              className={`raised rounded-full px-3 py-1.5 text-sm select-none disabled:opacity-40 ${
                on ? "wash" : "bg-bg text-muted hover:text-fg"
              }`}
            >
              {project.name}
            </button>
          );
        })}
      </div>
      {hint ? <div className="text-sm text-muted">{hint}</div> : null}
    </Dialog>
  );
}

/**
 * Which project a task is in, as a label at the head of its dialog: the name, pressed to choose
 * another.
 *
 * In the title bar rather than a field among the others, because it is not one of them: it is
 * where the task lives, and everything in the form is inside it. Not a native select, because
 * the choice is drawn as pills everywhere else a project or a tag is picked.
 */
export function ProjectLabel({
  value,
  hint,
  onChange,
}: {
  /** The slug, or empty for the default project. */
  value: string;
  /** What moving it does, said in the dialog that moves it. */
  hint?: ReactNode;
  onChange: (slug: string) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const projects = useQuery({ queryKey: qk.projects, queryFn: getProjects });
  const shown = projectNamed(projects.data?.projects ?? [], value);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        title="Project"
        onClick={() => setChoosing(true)}
        className="-ml-1.5 inline-flex max-w-40 shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-sm text-muted hover:bg-fill hover:text-fg"
      >
        <span className="truncate">{shown?.name ?? " "}</span>
        <ChevronDownIcon className="shrink-0 text-xs" />
      </button>
      <ProjectSelectDialog
        open={choosing}
        title="Project"
        current={value}
        hint={hint}
        onChoose={(project) => {
          setChoosing(false);
          onChange(project.slug);
        }}
        onClose={() => setChoosing(false)}
      />
    </>
  );
}
