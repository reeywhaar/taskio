import { useState } from "react";
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
  onChoose,
  onClose,
}: {
  open: boolean;
  title: string;
  /** The slug lit when it opens: where the task is now. Empty is the default project. */
  current: string;
  onChoose: (project: Project) => void;
  onClose: () => void;
}) {
  const projects = useQuery({ queryKey: qk.projects, queryFn: getProjects });
  const list = projects.data?.projects ?? [];
  const lit = projectNamed(list, current);

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
              onClick={() => onChoose(project)}
              className={`raised rounded-full px-3 py-1.5 text-sm select-none ${
                on ? "wash" : "bg-bg text-muted hover:text-fg"
              }`}
            >
              {project.name}
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}

/**
 * Which project a task is in, as a field: a select to look at, and a dialog to choose in.
 *
 * Not a native select, because the choice is drawn as pills everywhere else a project or a tag
 * is picked — the same thing chosen two ways is two things to learn.
 */
export function ProjectField({
  value,
  onChange,
}: {
  /** The slug, or empty for the default project. */
  value: string;
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
        onClick={() => setChoosing(true)}
        // The Select's own metrics and well, so it stands in a row of fields as one of them.
        className="sunken relative inline-flex min-h-10 w-full items-center rounded-md bg-bg py-1.5 pr-9 pl-3 text-left text-fg sm:min-h-11 sm:py-2"
      >
        <span className="truncate">{shown?.name ?? " "}</span>
        <ChevronDownIcon className="pointer-events-none absolute right-3 text-muted" />
      </button>
      <ProjectSelectDialog
        open={choosing}
        title="Project"
        current={value}
        onChoose={(project) => {
          setChoosing(false);
          onChange(project.slug);
        }}
        onClose={() => setChoosing(false)}
      />
    </>
  );
}
