import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { postAccess } from "@app/api/actions/access";
import {
  deleteTokensById,
  patchTokensById,
  postTokensByIdExtend,
} from "@app/api/actions/tokens";
import { getGroups } from "@app/api/actions/groups";
import { getProjects } from "@app/api/actions/projects";
import { qk } from "@app/api/keys";
import { ApiError } from "@app/api/transport";
import type { Group, Project } from "@app/api/types";
import { copy } from "@app/clipboard";
import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import { CheckIcon, CopyIcon } from "@app/components/icons/Icon";
import { Rows, writtenRows, type ReachRow } from "@app/islands/app/TokenFields";

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
 * The button that opens the dialog, where the page decides what it looks like.
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
  return (
    <>
      {trigger(() => setOpen(true))}
      <AgentAccessDialog
        open={open}
        onClose={() => setOpen(false)}
        project={project}
        group={group}
      />
    </>
  );
}

/**
 * Letting an agent in: a link to paste into one, showing a token for the project.
 *
 * The link shows the token for five minutes and the token works for thirty, and the dialog says
 * both, so whoever pastes it knows how long they have to. A new link every time it opens: what
 * one shows cannot be shown again, since the token is kept only behind the link.
 *
 * Opened on tasks, what it copies is the link and what to do with it — "check 8qw4tz9k" — the two
 * things that were pasted into an agent one after the other every time.
 */
export function AgentAccessDialog({
  open,
  onClose,
  project,
  group,
  tasks,
}: {
  open: boolean;
  onClose: () => void;
  project: Project | undefined;
  /** The group on screen: the page asks the agent to keep to its tags. */
  group: Group | undefined;
  /** The tasks it is for, by id, said under the link. */
  tasks?: string[];
}) {
  const client = useQueryClient();
  const [copied, setCopied] = useState(false);
  /** What the token reaches, as the editor below the link has it. */
  const [rows, setRows] = useState<ReachRow[]>([]);
  /** When the token stops, which +30 minutes moves on. */
  const [stops, setStops] = useState(0);
  const [revoked, setRevoked] = useState(false);
  const make = useMutation({
    mutationFn: () =>
      postAccess(
        project?.default ? "" : (project?.slug ?? ""),
        group?.id ?? "",
      ),
    onSuccess: (made) => setStops(made.token_expires_at),
  });
  const link = make.data;
  /** All of what is pasted: the link, and the tasks to check when there are some. */
  const text = link
    ? tasks?.length
      ? `${link.url}\n\ncheck ${tasks.join(", ")}`
      : link.url
    : "";

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setRevoked(false);
    setRows(project ? [{ project: project.slug, tags: [], any: true }] : []);
    make.mutate();
    // One link per opening, and only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * What it reaches, written as it is changed: the token is already out, and there is no Save
   * between a change and whatever holds it. A moment after the last press, so a run of tags
   * picked one after another is one write, and in order.
   */
  const reach = useMutation({
    mutationFn: (next: ReachRow[]) =>
      patchTokensById(link!.token, { projects: writtenRows(next) }),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.tokens }),
  });
  const timer = useRef(0);
  const changeRows = (next: ReachRow[]) => {
    setRows(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => reach.mutate(next), 400);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Here as well as in Settings, so more time or none is a press away while the dialog that made
  // the token is still open. Revoke is not asked: the token is minutes old, and the person who
  // made it is the one pressing.
  const extend = useMutation({
    mutationFn: () => postTokensByIdExtend(link!.token),
    onSuccess: (tok) => {
      if (tok.expires_at) setStops(tok.expires_at);
      void client.invalidateQueries({ queryKey: qk.tokens });
    },
  });
  const revoke = useMutation({
    mutationFn: () => deleteTokensById(link!.token),
    onSuccess: () => {
      setRevoked(true);
      void client.invalidateQueries({ queryKey: qk.tokens });
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Agent access"
      footer={
        link && !revoked ? (
          <>
            <Button
              variant="danger"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate()}
            >
              Revoke
            </Button>
            <span className="flex-1" />
            <Button disabled={extend.isPending} onClick={() => extend.mutate()}>
              +30 minutes
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          A link to paste into an agent. It gives a token that reaches what is
          below
          {group ? (
            <>
              , and asks the agent to keep to <b>{group.name}</b>
            </>
          ) : null}
          .
        </p>
        {/* The whole of it, wrapped, on the ground a code block has, and the copy beside it:
            read at a glance and copied in one press, where a field showed the start of it and
            the copy was a button at the foot of the dialog. */}
        <div
          className={`flex items-start gap-2 rounded-md bg-fill py-2.5 pr-2 pl-3 ${
            revoked ? "opacity-50" : ""
          }`}
        >
          {link ? (
            <div className="min-w-0 flex-1 py-0.5 font-mono text-xs break-all text-fg">
              {/* A link, so the page can be looked at before it is handed over. */}
              <a
                aria-label="Link"
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className={`underline-offset-2 hover:underline ${revoked ? "line-through" : ""}`}
              >
                {link.url}
              </a>
              {tasks?.length ? (
                <p className="mt-3">check {tasks.join(", ")}</p>
              ) : null}
            </div>
          ) : (
            <span className="min-w-0 flex-1 py-0.5 text-xs text-muted">
              {make.isPending ? "Making a link…" : ""}
            </span>
          )}
          <button
            type="button"
            aria-label={copied ? "Copied" : "Copy link"}
            title={copied ? "Copied" : "Copy link"}
            disabled={!link || revoked}
            onClick={async () => {
              if (!link || !(await copy(text))) return;
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
            className="shrink-0 rounded-md p-1 text-muted hover:bg-shade hover:text-fg disabled:opacity-40"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
        {link ? (
          revoked ? (
            <p className="text-xs text-accent">
              Revoked: the link and its token no longer work.
            </p>
          ) : (
            <p className="text-xs text-muted">
              The link shows the token until {clock(link.expires_at)}, for five
              minutes. The token works until {clock(stops)}.
            </p>
          )
        ) : null}
        {/* The same rows a token's own dialog edits, here before the link goes anywhere: a
            project it was made for to begin with, narrowed to some tags or joined by another
            project as the work needs. The page says what it reaches when it is opened. */}
        {link && !revoked ? (
          <>
            <Rows value={rows} onChange={changeRows} />
            {reach.isError ? (
              <p className="text-sm text-accent">
                {reach.error instanceof ApiError
                  ? reach.error.message
                  : "That could not be saved."}
              </p>
            ) : null}
          </>
        ) : null}
        {[make, extend, revoke].map((m, i) =>
          m.isError ? (
            <p key={i} className="text-sm text-accent">
              {m.error instanceof ApiError
                ? m.error.message
                : "Something went wrong."}
            </p>
          ) : null,
        )}
      </div>
    </Dialog>
  );
}
