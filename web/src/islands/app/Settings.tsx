import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ago } from "@app/ago";
import { deleteAccountRecovery, getAccount } from "@app/api/actions/account";
import { getAuthMe, postAuthLogout } from "@app/api/actions/auth";
import {
  deleteSessions,
  deleteSessionsById,
  getSessions,
} from "@app/api/actions/sessions";
import {
  deleteTokensById,
  deleteTokensRevoked,
  getTokens,
} from "@app/api/actions/tokens";
import type { Token } from "@app/api/types";
import { qk } from "@app/api/keys";
import { Boundary } from "@app/components/Boundary";
import { Button } from "@app/components/Button";
import { Dummy, DummyLines, DummyRows } from "@app/components/Dummy";
import { PasswordDialog } from "@app/islands/app/PasswordDialog";
import { RecoveryDialog } from "@app/islands/app/RecoveryDialog";
import { TokenDialog } from "@app/islands/app/TokenDialog";
import { TokenEditDialog } from "@app/islands/app/TokenEditDialog";
import { lengthName } from "@app/islands/app/TokenFields";

/**
 * One route with panels inside it rather than four routes side by side: they are all this
 * account's, and nothing else in the product is.
 */
export function Settings() {
  const me = useQuery({ queryKey: qk.me, queryFn: getAuthMe });
  return (
    <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-3 py-4 md:px-6">
        <Panel
          title="Account"
          state={me}
          dummy={
            <>
              <Dummy className="h-4 w-56" />
              <Dummy className="mt-3 h-11 w-24" />
            </>
          }
        >
          <p className="text-sm text-muted">
            Signed in as <span className="text-fg">{me.data?.username}</span>
            {me.data?.role === "admin" ? (
              <>
                {" · "}
                <a className="underline" href="/admin">
                  Admin
                </a>
              </>
            ) : null}
          </p>
          <Button
            className="mt-3"
            onClick={() =>
              postAuthLogout().then(() => window.location.assign("/"))
            }
          >
            Sign out
          </Button>
        </Panel>

        <Password />
        <Recovery />
        <Storage />
        <Tokens />
        <Sessions />
      </div>
    </div>
  );
}

/** Ends every other session and keeps this one — that is what people mean by it. */
function Password() {
  const [open, setOpen] = useState(false);
  const [changed, setChanged] = useState(false);

  return (
    <Panel title="Password">
      <Button
        onClick={() => {
          setChanged(false);
          setOpen(true);
        }}
      >
        Change password
      </Button>
      {changed ? (
        <p className="mt-2 text-sm text-muted">
          Changed. Every other browser has been signed out.
        </p>
      ) : null}
      <PasswordDialog
        open={open}
        onClose={(saved) => {
          setOpen(false);
          if (saved) setChanged(true);
        }}
      />
    </Panel>
  );
}

/**
 * Only an address somebody has proved they can read. Until the code comes back the account has
 * no recovery address at all — not a provisional one — so a flow abandoned anywhere leaves
 * exactly what was there before.
 *
 * The section is not shown when the instance has no relay and the account has no address:
 * explaining an administrator's job on everybody's settings page is aimed at somebody who is not
 * reading it.
 */
function Recovery() {
  const client = useQueryClient();
  const account = useQuery({ queryKey: qk.account, queryFn: getAccount });
  const [proving, setProving] = useState(false);

  const forget = useMutation({
    mutationFn: () => deleteAccountRecovery(),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.account }),
  });

  // Waiting rather than absent: a section that appears once the answer lands pushes everything
  // under it down, so it holds its place with a shape.
  if (account.isPending || account.isError) {
    return (
      <Panel title="Recovery address" state={account}>
        {null}
      </Panel>
    );
  }
  const { recovery_email: current, relay_configured: relay } = account.data;
  // The section is not shown when the instance has no relay and the account has no address:
  // explaining an administrator's job on everybody's settings page is aimed at somebody who is
  // not reading it.
  if (!relay && !current) return null;

  return (
    <Panel title="Recovery address">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={current ? "" : "text-muted"}>
          {current || "None on file."}
        </span>
        {current ? (
          <Button variant="link" onClick={() => forget.mutate()}>
            Forget it
          </Button>
        ) : null}
      </div>

      {relay ? (
        <Button className="mt-2" onClick={() => setProving(true)}>
          {current ? "Change it" : "Add one"}
        </Button>
      ) : (
        /* An address already on file keeps the section even when the relay goes away, so it
           can still be seen and forgotten. What it cannot then do is change. */
        <p className="mt-2 text-sm text-warn">
          There is no mail relay, so this cannot be changed until one is set up.
        </p>
      )}

      <RecoveryDialog
        open={proving}
        current={current ?? ""}
        onClose={() => setProving(false)}
      />
    </Panel>
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
  state,
  dummy,
  children,
}: {
  title: string;
  /** The query this section is waiting on, if it waits on one. */
  state?: { isPending: boolean; isError: boolean; refetch: () => void };
  dummy?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <Heading>{title}</Heading>
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

export function Tokens() {
  const client = useQueryClient();
  const tokens = useQuery({ queryKey: qk.tokens, queryFn: getTokens });
  const [minting, setMinting] = useState(false);
  const [editing, setEditing] = useState<Token | null>(null);

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
      state={tokens}
      dummy={
        <>
          <DummyLines count={1} />
          <Dummy className="mt-3 h-11 w-32" />
          <DummyRows className="mt-3" />
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        How something that is not a browser uses taskio.{" "}
        <a className="underline" href="/docs">
          The API is documented here
        </a>
        .
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setMinting(true)}>Mint a token</Button>
        {/* A revoked token is kept so one that turns up in a log afterwards can still be
            named. That is worth something for a week and nothing for a year, and until then
            it is a line in the only list of the live ones. */}
        {revoked > 0 ? (
          <Button onClick={() => forget.mutate()} disabled={forget.isPending}>
            Forget {revoked} revoked
          </Button>
        ) : null}
      </div>

      <ul className="mt-3 flex flex-col">
        {(tokens.data?.tokens ?? []).map((token) => (
          <li
            key={token.id}
            className="flex flex-wrap items-center gap-2 border-b border-line py-2 text-sm"
          >
            <span className="font-mono text-xs text-faint">{token.id}</span>
            <span>{token.label}</span>
            {/* A chip per project it reaches, with what confines it there. */}
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
            {/* Used by what, from where — the question a token raises when it looks wrong. */}
            <span
              className="text-xs text-faint"
              title={
                token.last_agent ||
                (token.last_used_at ? "" : "It has never been used.")
              }
            >
              {token.last_used_at
                ? `used ${ago(token.last_used_at)}${token.last_ip ? ` from ${token.last_ip}` : ""}`
                : "never used"}
            </span>
            {token.idle_seconds > 0 ? (
              <span className="text-xs text-faint">
                retires after {lengthName(token.idle_seconds)} unused
              </span>
            ) : null}
            {/* The other clock, which nothing on this row said anything about: a token minted
                with an end date looked exactly like one that would run for ever. */}
            {token.expires_at && !token.revoked_at ? (
              <span className="text-xs text-faint">
                {token.expires_at * 1000 > Date.now() ? "stops" : "stopped"} on{" "}
                {new Date(token.expires_at * 1000).toLocaleDateString()}
              </span>
            ) : null}
            {!token.revoked_at ? (
              <>
                <Button variant="link" onClick={() => setEditing(token)}>
                  Edit
                </Button>
                {/* Asked, because it is the one thing on this row that cannot be taken back:
                    whatever holds the token stops working on its next request, and the only
                    way on is a new token pasted into every place the old one was. */}
                <Button
                  variant="link"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Revoke "${token.label}"? Whatever uses it stops working at once, and it cannot be undone.`,
                      )
                    )
                      revoke.mutate(token.id);
                  }}
                >
                  Revoke
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ul>

      <TokenDialog open={minting} onClose={() => setMinting(false)} />
      <TokenEditDialog token={editing} onClose={() => setEditing(null)} />
    </Panel>
  );
}

function Sessions() {
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
              onClick={() => {
                if (
                  !session.current ||
                  window.confirm(
                    "This is the browser you are using. Signing it out returns you to the login page.",
                  )
                ) {
                  revoke.mutate(session.id);
                }
              }}
            >
              Sign out
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
