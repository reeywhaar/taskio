import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { postAccess } from "@app/api/actions/access";
import { getGroups } from "@app/api/actions/groups";
import { getProjects } from "@app/api/actions/projects";
import { qk } from "@app/api/keys";
import { ApiError } from "@app/api/transport";
import type { Group, Project } from "@app/api/types";
import { copy } from "@app/clipboard";
import { Dialog } from "@app/components/Dialog";
import { CheckIcon, CopyIcon } from "@app/components/icons/Icon";

/**
 * The project on screen, and the group whose tags are the ones lit, if one is.
 *
 * The rail asks the same two questions of the same two queries; asked here as well, the list's
 * button does not have to be handed them.
 */
export function useWhere(slug: string, tags: string[]) {
  const projects = useQuery({ queryKey: qk.projects, queryFn: getProjects });
  const groups = useQuery({
    queryKey: qk.groupsOf(slug),
    queryFn: () => getGroups(slug),
  });
  const project = projects.data?.projects.find((p) =>
    slug ? p.slug === slug : p.default,
  );
  const lit = new Set(tags);
  const group = groups.data?.groups.find(
    (g) => g.tags.length === lit.size && g.tags.every((t) => lit.has(t)),
  );
  return { project, group };
}

/** A time of day, here: when a link or a token stops. */
const clock = (at: number) =>
  new Date(at * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Letting an agent in: a link to paste into one, showing a token for the project.
 *
 * The link shows the token for five minutes and the token works for thirty, and the dialog says
 * both, so whoever pastes it knows how long they have to. A new link every time it opens: what
 * one shows cannot be shown again, since the token is kept only behind the link.
 */
export function AgentAccess({
  project,
  group,
  trigger,
}: {
  project: Project | undefined;
  /** The group on screen: the page asks the agent to keep to its tags. */
  group: Group | undefined;
  trigger: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const make = useMutation({
    mutationFn: () =>
      postAccess(
        project?.default ? "" : (project?.slug ?? ""),
        group?.id ?? "",
      ),
  });

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    make.mutate();
    // One link per opening, and only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const link = make.data;
  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog open={open} onClose={() => setOpen(false)} title="Agent access">
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            A link to paste into an agent. It gives a token for{" "}
            {group ? (
              <>
                <b>{project?.name}</b>, and asks it to keep to{" "}
                <b>{group.name}</b>.
              </>
            ) : (
              <>
                the whole of <b>{project?.name}</b>.
              </>
            )}
          </p>
          {/* The whole of it, wrapped, on the ground a code block has, and the copy beside it:
              read at a glance and copied in one press, where a field showed the start of it and
              the copy was a button at the foot of the dialog. */}
          <div className="flex items-start gap-2 rounded-md bg-fill py-2.5 pr-2 pl-3">
            {link ? (
              // A link, so the page can be looked at before it is handed over.
              <a
                aria-label="Link"
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 py-0.5 font-mono text-xs break-all text-fg underline-offset-2 hover:underline"
              >
                {link.url}
              </a>
            ) : (
              <span className="min-w-0 flex-1 py-0.5 text-xs text-muted">
                {make.isPending ? "Making a link…" : ""}
              </span>
            )}
            <button
              type="button"
              aria-label={copied ? "Copied" : "Copy link"}
              title={copied ? "Copied" : "Copy link"}
              disabled={!link}
              onClick={async () => {
                if (!link || !(await copy(link.url))) return;
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
              className="shrink-0 rounded-md p-1 text-muted hover:bg-shade hover:text-fg disabled:opacity-40"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
          {link ? (
            <p className="text-xs text-muted">
              The link shows the token until {clock(link.expires_at)}, for five
              minutes. The token works until {clock(link.token_expires_at)}, and
              until then is under Settings → Tokens, to revoke.
            </p>
          ) : null}
          {make.isError ? (
            <p className="text-sm text-accent">
              {make.error instanceof ApiError
                ? make.error.message
                : "Something went wrong."}
            </p>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
