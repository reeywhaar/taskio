import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { deleteAccountRecovery, getAccount } from "@app/api/actions/account";
import { getAuthMe, postAuthLogout } from "@app/api/actions/auth";
import {
  deleteSessions,
  deleteSessionsById,
  getSessions,
} from "@app/api/actions/sessions";
import { deleteTokensById, getTokens } from "@app/api/actions/tokens";
import type { Token } from "@app/api/types";
import { qk } from "@app/api/keys";
import { Button } from "@app/components/Button";
import { PasswordDialog } from "@app/islands/app/PasswordDialog";
import { RecoveryDialog } from "@app/islands/app/RecoveryDialog";
import { TokenDialog } from "@app/islands/app/TokenDialog";
import { TokenScopeDialog } from "@app/islands/app/TokenScopeDialog";

/**
 * One route with panels inside it rather than four routes side by side: they are all this
 * account's, and nothing else in the product is.
 */
export function Settings() {
  const me = useQuery({ queryKey: qk.me, queryFn: getAuthMe });
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-3 py-4 md:px-6">
      <section>
        <Heading>Account</Heading>
        <p className="text-sm text-muted">
          Signed in as{" "}
          <span className="text-fg">{me.data?.username ?? "…"}</span>
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
      </section>

      <Password />
      <Recovery />
      <Storage />
      <Tokens />
      <Sessions />
    </div>
  );
}

/** Ends every other session and keeps this one — that is what people mean by it. */
function Password() {
  const [open, setOpen] = useState(false);
  const [changed, setChanged] = useState(false);

  return (
    <section>
      <Heading>Password</Heading>
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
    </section>
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

  if (!account.data) return null;
  const { recovery_email: current, relay_configured: relay } = account.data;
  // The section is not shown when the instance has no relay and the account has no address:
  // explaining an administrator's job on everybody's settings page is aimed at somebody who is
  // not reading it.
  if (!relay && !current) return null;

  return (
    <section>
      <Heading>Recovery address</Heading>
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
    </section>
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
  if (!account.data) return null;

  const { used, quota, max } = account.data.assets;
  const share = quota > 0 ? Math.min(1, used / quota) : 0;

  return (
    <section>
      <Heading>Attachments</Heading>
      <p className="text-sm text-muted">
        <span className="text-fg">
          {mb(used)} of {mb(quota)}
        </span>{" "}
        used · up to {mb(max)} per file
      </p>
      <div className="mt-2 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-fill">
        <div
          className={`h-full ${share > 0.9 ? "bg-warn" : "bg-faint"}`}
          style={{ width: `${Math.max(2, share * 100)}%` }}
        />
      </div>
    </section>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-sm font-semibold tracking-wide text-faint uppercase">
      {children}
    </h2>
  );
}

function Tokens() {
  const client = useQueryClient();
  const tokens = useQuery({ queryKey: qk.tokens, queryFn: getTokens });
  const [minting, setMinting] = useState(false);
  const [editing, setEditing] = useState<Token | null>(null);

  const revoke = useMutation({
    mutationFn: (id: string) => deleteTokensById(id),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.tokens }),
  });

  return (
    <section>
      <Heading>Tokens</Heading>
      <p className="mb-3 text-sm text-muted">
        How something that is not a browser uses taskio.{" "}
        <a className="underline" href="/docs">
          The API is documented here
        </a>
        .
      </p>

      <Button onClick={() => setMinting(true)}>Mint a token</Button>

      <ul className="mt-3 flex flex-col">
        {(tokens.data?.tokens ?? []).map((token) => (
          <li
            key={token.id}
            className="flex flex-wrap items-center gap-2 border-b border-line py-2 text-sm"
          >
            <span className="font-mono text-xs text-faint">{token.id}</span>
            <span>{token.label}</span>
            <span className="rounded-full bg-fill px-2 py-0.5 text-xs text-muted">
              {token.scope || "the whole account"}
            </span>
            {token.revoked_at ? (
              <span className="text-xs text-faint">revoked</span>
            ) : null}
            <span className="flex-1" />
            {!token.revoked_at ? (
              <>
                <Button variant="link" onClick={() => setEditing(token)}>
                  Change scope
                </Button>
                <Button variant="link" onClick={() => revoke.mutate(token.id)}>
                  Revoke
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ul>

      <TokenDialog open={minting} onClose={() => setMinting(false)} />
      <TokenScopeDialog token={editing} onClose={() => setEditing(null)} />
    </section>
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
    <section>
      <Heading>Sessions</Heading>
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
    </section>
  );
}
