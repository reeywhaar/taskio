import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ago, ahead } from "@app/ago";
import {
  deleteAccountRecovery,
  getAccount,
  patchAccount,
} from "@app/api/actions/account";
import { getAuthMe } from "@app/api/actions/auth";
import {
  deleteSessions,
  deleteSessionsById,
  getSessions,
} from "@app/api/actions/sessions";
import {
  deleteTokensById,
  deleteTokensRevoked,
  getTokens,
  postTokensByIdRotate,
} from "@app/api/actions/tokens";
import type { Token } from "@app/api/types";
import { qk } from "@app/api/keys";
import { Boundary } from "@app/components/Boundary";
import { Button } from "@app/components/Button";
import { Copyable } from "@app/components/Copyable";
import { Dialog } from "@app/components/Dialog";
import { PersonIcon } from "@app/components/icons/Icon";
import { Dummy, DummyLines, DummyRows } from "@app/components/Dummy";
import { Field } from "@app/components/Field";
import { Select } from "@app/components/Select";
import { ApiError } from "@app/api/transport";
import { PasswordDialog } from "@app/islands/app/PasswordDialog";
import { RecoveryDialog } from "@app/islands/app/RecoveryDialog";
import { TokenDialog } from "@app/islands/app/TokenDialog";
import { useConfirm } from "@app/components/Confirm";
import { TokenEditDialog } from "@app/islands/app/TokenEditDialog";
import { lengthName } from "@app/islands/app/TokenFields";

/**
 * One route with panels inside it rather than four routes side by side: they are all this
 * account's, and nothing else in the product is.
 */
export function Settings() {
  return (
    <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-3 py-4 md:px-6">
        <SignedIn />
        <Pins />
        <Storage />
        <Tokens />
        {/* Beside the sessions: both are how this account is got into, and a password changed
            signs every other session out. */}
        <Password />
        <Sessions />
      </div>
    </div>
  );
}

/**
 * Who is signed in, at the top right, where an account is on most pages that have one. It was a
 * section of its own, with a heading over one line, which said less than its place on the page.
 * Nothing while the answer is on its way: a name that arrives a moment late moves nothing.
 */
export function SignedIn() {
  const me = useQuery({ queryKey: qk.me, queryFn: getAuthMe });
  return (
    <div className="-mb-4 flex min-h-5 justify-end text-sm">
      {me.data ? (
        <span className="flex items-center gap-1.5">
          <PersonIcon className="text-faint" />
          {me.data.username}
          {me.data.role === "admin" ? (
            <>
              <span className="text-faint">·</span>
              <a className="text-muted underline" href="/admin">
                Admin
              </a>
            </>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The password, and the address to get back in by when it is lost: one section, a row each.
 * They were sections of their own, each a heading over one button, which was a column of slabs
 * for the lightest things on the page.
 *
 * The recovery address is only an address somebody has proved they can read. Until the code
 * comes back the account has none at all — not a provisional one — so a flow abandoned anywhere
 * leaves exactly what was there before. Its row is not drawn when the instance has no relay and
 * the account has no address: explaining an administrator's job on everybody's settings page is
 * aimed at somebody who is not reading it.
 */
export function Password() {
  const client = useQueryClient();
  const account = useQuery({ queryKey: qk.account, queryFn: getAccount });
  const [changing, setChanging] = useState(false);
  const [changed, setChanged] = useState(false);
  const [proving, setProving] = useState(false);

  const forget = useMutation({
    mutationFn: () => deleteAccountRecovery(),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.account }),
  });

  const current = account.data?.recovery_email ?? "";
  const relay = account.data?.relay_configured ?? false;

  return (
    <Panel title="Password" state={account} dummy={<DummyRows count={2} />}>
      <ul className="flex flex-col">
        {/* No label: the heading says what it is, and a row called Password under a section
            called Password said it twice. Changing it ends every other session and keeps this
            one — that is what people mean by it. */}
        <Row
          actions={
            <Button
              variant="link"
              onClick={() => {
                setChanged(false);
                setChanging(true);
              }}
            >
              Change…
            </Button>
          }
        >
          {changed ? (
            <span className="text-muted">
              Changed. Every other browser has been signed out.
            </span>
          ) : (
            <span className="tracking-widest text-faint">••••••••</span>
          )}
        </Row>
        {relay || current ? (
          <Row
            label="Recovery address"
            actions={
              <>
                {current ? (
                  <Button variant="link" onClick={() => forget.mutate()}>
                    Forget
                  </Button>
                ) : null}
                {relay ? (
                  <Button variant="link" onClick={() => setProving(true)}>
                    {current ? "Change…" : "Add…"}
                  </Button>
                ) : null}
              </>
            }
          >
            {current || <span className="text-muted">None on file.</span>}
            {/* An address already on file keeps its row when the relay goes away, so it can
                still be seen and forgotten. What it cannot then do is change. */}
            {relay ? null : (
              <span className="block text-xs text-warn">
                There is no mail relay, so it cannot be changed until one is set
                up.
              </span>
            )}
          </Row>
        ) : null}
      </ul>

      <PasswordDialog
        open={changing}
        onClose={(saved) => {
          setChanging(false);
          if (saved) setChanged(true);
        }}
      />
      <RecoveryDialog
        open={proving}
        current={current}
        onClose={() => setProving(false)}
      />
    </Panel>
  );
}

/** One of the password's rows: what it is, what it is now, and what can be done about it. */
function Row({
  label,
  actions,
  children,
}: {
  label?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line py-2 text-sm">
      {/* As wide as it is: a column for the labels left a gap of a word's width before "demo",
          and the rows are too few and too different to be a table. */}
      {label ? <span className="shrink-0 text-muted">{label}</span> : null}
      <span className="min-w-0 flex-1 break-words">{children}</span>
      <span className="flex shrink-0 gap-3">{actions}</span>
    </li>
  );
}

function mb(n: number): string {
  return `${Math.round(n / (1 << 20))} MB`;
}

/**
 * The only warning before an upload starts failing, and one of only two numbers drawn anywhere:
 * it counts bytes rather than a backlog.
 */
function Storage() {
  const account = useQuery({ queryKey: qk.account, queryFn: getAccount });
  if (account.isPending || account.isError) {
    return (
      <Panel
        title="Attachments"
        state={account}
        dummy={
          <>
            <Dummy className="h-4 w-64" />
            <Dummy className="mt-2 h-1.5 w-full max-w-sm" />
          </>
        }
      >
        {null}
      </Panel>
    );
  }

  const { used, quota, max } = account.data.assets;
  const share = quota > 0 ? Math.min(1, used / quota) : 0;

  return (
    <Panel title="Attachments">
      <p className="text-sm text-muted">
        <span className="text-fg">
          {mb(used)} of {mb(quota)}
        </span>{" "}
        used · up to {mb(max)} per file
      </p>
      <div className="mt-2 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-shade">
        <div
          className={`h-full ${share > 0.9 ? "bg-warn" : "bg-faint"}`}
          style={{ width: `${Math.max(2, share * 100)}%` }}
        />
      </div>
    </Panel>
  );
}

/** The lengths a pin may hold for, as the server allows them; 0 is until it is taken off. */
const PIN_HOURS = [0, 2, 4, 8, 12, 24];

/**
 * How long a pin holds. A pin says "this, today", and one left from yesterday is a task at the
 * top of the list after it stopped being the one — but what a day is, is the account's to say.
 * Saved as it is chosen: there is nothing else in the panel to confirm along with it.
 */
export function Pins() {
  const client = useQueryClient();
  const account = useQuery({ queryKey: qk.account, queryFn: getAccount });
  const set = useMutation({
    mutationFn: (hours: number) => patchAccount({ pin_hours: hours }),
    onSuccess: (next) => client.setQueryData(qk.account, next),
  });
  return (
    <Panel title="Pins" state={account} dummy={<Dummy className="h-9 w-56" />}>
      <Field
        label="Unpin after"
        hint={
          <p>
            Counted from when the pin went on. A task pinned for today drops
            back into its place tomorrow, rather than staying at the top after
            it stopped being the one.
          </p>
        }
      >
        <Select
          className="w-56"
          value={account.data?.pin_hours ?? 8}
          disabled={set.isPending}
          onChange={(e) => set.mutate(Number(e.target.value))}
        >
          {PIN_HOURS.map((hours) => (
            <option key={hours} value={hours}>
              {hours === 0 ? "Never" : `${hours} hours`}
            </option>
          ))}
        </Select>
      </Field>
      {set.isError ? (
        <p className="mt-2 text-sm text-accent">
          {set.error instanceof ApiError
            ? set.error.message
            : "Something went wrong."}
        </p>
      ) : null}
    </Panel>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-sm font-semibold tracking-wide uppercase">
      {children}
    </h2>
  );
}

/**
 * One section: a heading that is always there, and under it whatever the answer allows.
 *
 * Nothing half-drawn. A section waiting on an answer shows the shape of one rather than its own
 * words with the values missing — "Signed in as" followed by a gap is a sentence that says
 * something untrue for as long as it is on screen.
 *
 * The heading stays through all three states, so the page keeps its outline and nothing below
 * jumps as each section settles.
 */
/** The three lengths the mint dialog offers, said in words. */
function Panel({
  title,
  description,
  actions,
  state,
  dummy,
  children,
}: {
  title: string;
  /** Under the title, what the section is for. */
  description?: React.ReactNode;
  /** To the right of the title and its description: the section's commands. */
  actions?: React.ReactNode;
  /** The query this section is waiting on, if it waits on one. */
  state?: { isPending: boolean; isError: boolean; refetch: () => void };
  dummy?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      {description || actions ? (
        // The commands beside what they are for rather than under it, wrapping below on a
        // phone: under it, a button sat between the sentence and the list it adds to.
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-64">
            <Heading>{title}</Heading>
            {description ? (
              <p className="text-sm text-muted">{description}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
      ) : (
        <Heading>{title}</Heading>
      )}
      <Boundary what={title} onReset={() => state?.refetch()}>
        {state?.isError ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-accent">{title} could not be read.</p>
            <Button onClick={() => state.refetch()}>Try again</Button>
          </div>
        ) : state?.isPending ? (
          (dummy ?? <DummyLines />)
        ) : (
          children
        )}
      </Boundary>
    </section>
  );
}

/**
 * When a token stops, said the way that matters: how long is left for one ending within the
 * day, which is what an agent's half-hour token is — a date there said nothing but today — and
 * the date for one further off.
 */
function stops(at: number): string {
  const left = at - Date.now() / 1000;
  if (Math.abs(left) < 24 * 3600) {
    return left > 0 ? `stops ${ahead(at)}` : `stopped ${ago(at)}`;
  }
  const day = new Date(at * 1000).toLocaleDateString();
  return `${left > 0 ? "stops" : "stopped"} on ${day}`;
}

export function Tokens() {
  const confirm = useConfirm();
  const client = useQueryClient();
  const tokens = useQuery({ queryKey: qk.tokens, queryFn: getTokens });
  const [minting, setMinting] = useState(false);
  const [editing, setEditing] = useState<Token | null>(null);
  /** The secret a rotation handed back, shown once, and whose it is. */
  const [rotated, setRotated] = useState<{
    label: string;
    secret: string;
  } | null>(null);

  const rotate = useMutation({
    mutationFn: (id: string) => postTokensByIdRotate(id),
    onSuccess: (result) => {
      setRotated({ label: result.token.label, secret: result.secret });
      client.invalidateQueries({ queryKey: qk.tokens });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => deleteTokensById(id),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.tokens }),
  });

  const forget = useMutation({
    mutationFn: () => deleteTokensRevoked(),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.tokens }),
  });

  // The button is not there when there is nothing to press it about, which is most of the time.
  const revoked = (tokens.data?.tokens ?? []).filter(
    (t) => t.revoked_at,
  ).length;

  return (
    <Panel
      title="Tokens"
      description={
        <>
          How something that is not a browser uses taskio.{" "}
          <a className="underline" href="/docs">
            The API is documented here
          </a>
          .
        </>
      }
      actions={
        <>
          {/* A revoked token is kept so one that turns up in a log afterwards can still be
              named. That is worth something for a week and nothing for a year, and until then
              it is a line in the only list of the live ones. */}
          {revoked > 0 ? (
            <Button onClick={() => forget.mutate()} disabled={forget.isPending}>
              Forget {revoked} revoked
            </Button>
          ) : null}
          <Button onClick={() => setMinting(true)}>Mint a token</Button>
        </>
      }
      state={tokens}
      dummy={<DummyRows />}
    >
      <ul className="flex flex-col">
        {(tokens.data?.tokens ?? []).map((token) => (
          // Two lines: what it is and what can be done to it, then what it has been doing. On
          // one line they wrapped wherever the width ran out, which left Revoke… on a line of
          // its own under the rest.
          <li
            key={token.id}
            className="flex flex-col gap-1 border-b border-line py-2 text-sm"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-xs text-faint">{token.id}</span>
              <span>{token.label}</span>
              {/* A chip per project it reaches, with what confines it there — or one saying it
                  reaches them all, which is what a token with no rows does. */}
              {token.projects.length === 0 ? (
                <span className="rounded-full bg-shade px-2 py-0.5 text-xs text-muted">
                  every project
                </span>
              ) : null}
              {token.projects.map((row) => (
                <span
                  key={row.project}
                  className={`rounded-full bg-shade px-2 py-0.5 text-xs text-muted ${
                    row.deleted ? "line-through" : ""
                  }`}
                  title={row.deleted ? "This project was deleted." : undefined}
                >
                  {row.name}
                  {row.scope ? ` · ${row.scope}` : ""}
                </span>
              ))}
              {token.revoked_at ? (
                <span className="text-xs text-faint">revoked</span>
              ) : null}
              <span className="flex-1" />
              {!token.revoked_at ? (
                // Together, so they wrap as one rather than one at a time.
                <span className="flex shrink-0 gap-3">
                  <Button variant="link" onClick={() => setEditing(token)}>
                    Edit
                  </Button>
                  {/* Asked, because the secret in use stops at once: whatever holds it is broken
                      until it is given the new one. Everything else about the token stays. */}
                  <Button
                    variant="link"
                    disabled={rotate.isPending}
                    onClick={async () => {
                      const yes = await confirm({
                        title: "Rotate this token?",
                        message: (
                          <>
                            It gets a new secret and keeps everything else.
                            Whatever uses <b>{token.label}</b> stops working
                            until it is given the new one.
                          </>
                        ),
                        confirm: "Rotate",
                      });
                      if (yes) rotate.mutate(token.id);
                    }}
                  >
                    Rotate…
                  </Button>
                  {/* Asked, because it is the one thing on this row that cannot be taken back:
                      whatever holds the token stops working on its next request, and the only
                      way on is a new token pasted into every place the old one was. */}
                  <Button
                    variant="link"
                    onClick={async () => {
                      const yes = await confirm({
                        title: "Revoke this token?",
                        message: (
                          <>
                            Whatever uses <b>{token.label}</b> stops working at
                            once, and it cannot be undone.
                          </>
                        ),
                        confirm: "Revoke",
                        danger: true,
                      });
                      if (yes) revoke.mutate(token.id);
                    }}
                  >
                    Revoke…
                  </Button>
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-x-3 text-xs text-faint">
              {/* Used by what, from where — the question a token raises when it looks wrong. */}
              <span
                title={
                  token.last_agent ||
                  (token.last_used_at
                    ? ""
                    : token.rotated_at
                      ? "Nothing has used the new secret yet."
                      : "It has never been used.")
                }
              >
                {token.last_used_at
                  ? `used ${ago(token.last_used_at)}${token.last_ip ? ` from ${token.last_ip}` : ""}`
                  : token.rotated_at
                    ? `rotated ${ago(token.rotated_at)}, not used since`
                    : "never used"}
              </span>
              {token.idle_seconds > 0 ? (
                <span>
                  retires after {lengthName(token.idle_seconds)} unused
                </span>
              ) : null}
              {/* The other clock, which nothing on this row said anything about: a token minted
                  with an end date looked exactly like one that would run for ever. */}
              {token.expires_at && !token.revoked_at ? (
                <span>{stops(token.expires_at)}</span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <TokenDialog open={minting} onClose={() => setMinting(false)} />
      <TokenEditDialog token={editing} onClose={() => setEditing(null)} />
      {/* The same once-only showing a new token gets. */}
      <Dialog
        open={rotated !== null}
        onClose={() => setRotated(null)}
        title="New secret"
        footer={
          <Button variant="solid" onClick={() => setRotated(null)}>
            I have copied it
          </Button>
        }
      >
        <div className="flex flex-col gap-2">
          <p className="text-sm text-warn">
            The new secret for <b>{rotated?.label}</b>, shown once. The old one
            has stopped working.
          </p>
          <Copyable value={rotated?.secret ?? ""} />
        </div>
      </Dialog>
    </Panel>
  );
}

function Sessions() {
  const confirm = useConfirm();
  const client = useQueryClient();
  const sessions = useQuery({ queryKey: qk.sessions, queryFn: getSessions });

  const revoke = useMutation({
    mutationFn: (id: string) => deleteSessionsById(id),
    onSuccess: (_result, id) => {
      const wasCurrent = sessions.data?.sessions.find(
        (s) => s.id === id,
      )?.current;
      if (wasCurrent) window.location.assign("/");
      else client.invalidateQueries({ queryKey: qk.sessions });
    },
  });

  const revokeOthers = useMutation({
    mutationFn: () => deleteSessions(),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.sessions }),
  });

  return (
    <Panel title="Sessions" state={sessions} dummy={<DummyRows />}>
      <ul className="flex flex-col">
        {(sessions.data?.sessions ?? []).map((session) => (
          <li
            key={session.id}
            className="flex items-start gap-2 border-b border-line py-2 text-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span>{session.device || "Unknown"}</span>
                {session.current ? (
                  <span className="text-xs text-muted">this browser</span>
                ) : null}
              </div>
              {/* The summary is a parse of a field browsers have been lying in since 1993, so
                  the string it was guessed from sits under it. */}
              <p className="truncate text-xs text-faint">
                {session.user_agent}
              </p>
            </div>
            <Button
              variant="link"
              onClick={async () => {
                const yes =
                  !session.current ||
                  (await confirm({
                    title: "Sign this browser out?",
                    message:
                      "This is the browser you are using. Signing it out returns you to the login page.",
                    confirm: "Sign out",
                  }));
                if (yes) revoke.mutate(session.id);
              }}
            >
              {session.current ? "Sign out…" : "Sign out"}
            </Button>
          </li>
        ))}
      </ul>
      <Button className="mt-3" onClick={() => revokeOthers.mutate()}>
        Sign out everywhere else
      </Button>
    </Panel>
  );
}
