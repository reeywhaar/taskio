import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  deleteProjectsById,
  patchProjectsById,
  postProjects,
} from "@app/api/actions/projects";
import { ApiError } from "@app/api/transport";
import type { Project } from "@app/api/types";
import { qk } from "@app/api/keys";
import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import { Field } from "@app/components/Field";
import { TextField } from "@app/components/TextField";

/** Open on a project to change it, on "new" to make one, shut on null. */
export type EditingProject = Project | "new" | null;

/**
 * The slug a name suggests, by the server's rule: lowercase letters and digits kept, anything
 * else a hyphen. Shown as it is typed, so what the URL will say is on screen before it is.
 */
export function slugOf(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

/**
 * A project is a name and a slug, and this is both of them — and, for one that is not the
 * default, the way to delete it.
 *
 * The slug follows the name while the project is being made, until somebody types into the slug
 * itself. After that it changes only when it is changed: a rename keeps every link and every
 * agent's ?project= working, and a new slug breaks them, which is said beside the field.
 *
 * Deleting takes every task in the project with it, so it asks for the project's name typed out
 * rather than a yes — the one confirmation here that cannot be given by reflex.
 */
export function ProjectDialog({
  editing,
  onClose,
  onGo,
  onGone,
}: {
  editing: EditingProject;
  onClose: () => void;
  /** Show this project: the one just made, or the open one under a new slug. */
  onGo: (project: Project) => void;
  /** The project on screen was deleted, and somewhere else has to be. */
  onGone: () => void;
}) {
  const client = useQueryClient();
  const project = editing === "new" ? null : editing;

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  /** Whether somebody has typed into the slug, after which the name no longer writes it. */
  const [slugTouched, setSlugTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!editing) return;
    setName(project?.name ?? "");
    setSlug(project?.slug ?? "");
    setSlugTouched(!!project);
    setConfirming(false);
    setTyped("");
    setError("");
  }, [editing, project]);

  const failed = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : "Something went wrong.");

  const save = useMutation({
    mutationFn: () => {
      if (!project)
        return postProjects({ name: name.trim(), slug: slug.trim() });
      return patchProjectsById(project.id, {
        name: name.trim(),
        // Only when it was changed: sending it unchanged is a no-op, but a rename should not
        // even look like it touches the slug.
        ...(slug.trim() !== project.slug ? { slug: slug.trim() } : {}),
      });
    },
    onSuccess: (saved) => {
      client.invalidateQueries({ queryKey: qk.projects });
      onClose();
      // A new project is opened; an edited one is followed only if its slug moved, since the
      // URL on screen would otherwise name a project that is no longer called that.
      if (!project || saved.slug !== project.slug) onGo(saved);
    },
    onError: failed,
  });

  const remove = useMutation({
    mutationFn: () => deleteProjectsById(project!.id),
    onSuccess: () => {
      for (const key of [qk.projects, qk.tasks, qk.tags, qk.groups])
        client.invalidateQueries({ queryKey: key });
      onClose();
      onGone();
    },
    onError: failed,
  });

  const shownSlug = slugTouched ? slug : slugOf(name);
  const canSave = name.trim() !== "" && shownSlug !== "" && !save.isPending;

  return (
    <Dialog
      open={editing !== null}
      onClose={onClose}
      title={project ? "Edit project" : "New project"}
      footer={
        confirming ? (
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => remove.mutate()}
              disabled={typed !== project?.name || remove.isPending}
            >
              {remove.isPending ? "Deleting…" : "Delete project"}
            </Button>
          </>
        ) : (
          <>
            {project && !project.default ? (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                Delete
              </Button>
            ) : null}
            <span className="flex-1" />
            <Button
              type="submit"
              form="project"
              variant="solid"
              disabled={!canSave}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        )
      }
    >
      {confirming && project ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            This deletes <b>{project.name}</b> and every task, group and tag in
            it. It cannot be undone.
          </p>
          <Field label={`Type ${project.name} to confirm`}>
            <TextField
              data-autofocus
              className="w-full"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </Field>
          {error ? <p className="text-sm text-accent">{error}</p> : null}
        </div>
      ) : (
        <form
          id="project"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSave) return;
            if (!slugTouched) setSlug(shownSlug);
            save.mutate();
          }}
        >
          <Field label="Name">
            <TextField
              data-autofocus
              className="w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Slug">
            <TextField
              className="w-full font-mono"
              value={shownSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
            />
          </Field>
          <p className="text-xs text-muted">
            {project
              ? "What the URL and an agent's ?project= say. Changing it breaks every link to the old one."
              : "What the URL and an agent's ?project= will say. It stays when the project is renamed."}
          </p>
          {project?.default ? (
            <p className="text-xs text-muted">
              The default project: where a link with no project goes. It can be
              renamed, and not deleted.
            </p>
          ) : null}
          {error ? <p className="text-sm text-accent">{error}</p> : null}
        </form>
      )}
    </Dialog>
  );
}
