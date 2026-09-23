import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deleteAdminRelay,
  getAdminLimits,
  getAdminRelay,
  getAdminUsers,
  postAdminInvites,
  postAdminUsersByIdRecovery,
} from "@app/api/actions/admin";
import { qk } from "@app/api/keys";
import { Button } from "@app/components/Button";
import { Copyable } from "@app/components/Copyable";
import { Dialog } from "@app/components/Dialog";
import { Select } from "@app/components/Select";
import { LimitsDialog } from "@app/islands/admin/LimitsDialog";
import { RelayDialog, TestMailDialog } from "@app/islands/admin/RelayDialog";

/**
 * How this machine is set up, as distinct from what one account holds: the relay and the asset
 * limits are the instance's, not a person's.
 */
export function Admin() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Admin</h1>
        <a className="text-sm text-muted underline" href="/">
          taskio
        </a>
      </header>
      <Users />
      <RelayPanel />
      <LimitsPanel />
    </main>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-sm font-semibold tracking-wide uppercase">
      {children}
    </h2>
  );
}

function Users() {
  const users = useQuery({ queryKey: qk.adminUsers, queryFn: getAdminUsers });
  const [invited, setInvited] = useState("");
  const [recovered, setRecovered] = useState<{
    url: string;
    username: string;
  } | null>(null);
  const [role, setRole] = useState("user");

  const invite = useMutation({
    mutationFn: () => postAdminInvites({ role }),
    // Readable exactly once, so a lost link is reissued rather than recovered.
    onSuccess: (result) => setInvited(result.link),
  });

  /**
   * A way back in for somebody who has lost their password, handed over rather than mailed.
   *
   * Not sent from here even where a relay works: this is the path for somebody standing in
   * front of you or on a call, and an administrator who could both mail a link and read it
   * would hold a way into every account. The one that goes to an inbox is the account's own to
   * ask for, at the login form.
   *
   * Issuing it changes nothing — nobody is signed out, no password moves, and the account
   * holder is not told — so it can be answered without locking out somebody who turns out to
   * have been fine.
   */
  const recovery = useMutation({
    mutationFn: (id: string) => postAdminUsersByIdRecovery(id),
    onSuccess: (result) =>
      setRecovered({ url: result.url, username: result.username }),
  });

  return (
    <section>
      <Heading>People</Heading>
      <ul className="mb-3 flex flex-col">
        {(users.data?.users ?? []).map((user) => (
          <li
            key={user.id}
            className="flex items-center gap-2 border-b border-line py-2 text-sm"
          >
            <span>{user.username}</span>
            <span className="rounded-full bg-shade px-2 py-0.5 text-xs text-muted">
              {user.role}
            </span>
            <Button
              size="bar"
              className="ml-auto"
              disabled={recovery.isPending}
              onClick={() => recovery.mutate(user.id)}
            >
              Recovery link
            </Button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </Select>
        <Button
          variant="solid"
          onClick={() => invite.mutate()}
          disabled={invite.isPending}
        >
          Make an invitation
        </Button>
      </div>

      {invited ? (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-warn/40 bg-shade p-3">
          <p className="text-sm text-warn">An invitation, shown once.</p>
          <Copyable value={invited} />
        </div>
      ) : null}

      {/* Its own dialog, over the row it was asked from, rather than under the invitations. */}
      <Dialog
        open={recovered !== null}
        onClose={() => setRecovered(null)}
        title="Recovery link"
        footer={
          <Button variant="solid" onClick={() => setRecovered(null)}>
            I have copied it
          </Button>
        }
      >
        <div className="flex flex-col gap-2">
          <p className="text-sm text-warn">
            A way back into <b>{recovered?.username}</b>&apos;s account, shown
            once. Nothing has changed until it is used.
          </p>
          <Copyable value={recovered?.url ?? ""} />
        </div>
      </Dialog>
    </section>
  );
}

function RelayPanel() {
  const client = useQueryClient();
  const relay = useQuery({ queryKey: qk.adminRelay, queryFn: getAdminRelay });
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);

  const remove = useMutation({
    mutationFn: () => deleteAdminRelay(),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.adminRelay }),
  });

  const configured = relay.data?.configured ?? false;

  return (
    <section>
      <Heading>Mail relay</Heading>
      <p className="mb-3 text-sm text-muted">
        taskio hands a message to a relay you already have. Two things send: the
        code that proves a recovery address, and the link somebody who has
        forgotten their password asks for. Without a relay the login page offers
        no way back in, and the way in is a link from here.
      </p>

      <p className="text-sm">
        {configured ? (
          <>
            <span className="font-mono text-xs text-faint">
              {relay.data?.host}:{relay.data?.port}
            </span>{" "}
            · {relay.data?.security} · from {relay.data?.from_address}
          </>
        ) : (
          <span className="text-muted">Not set up. Nothing can be sent.</span>
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => setEditing(true)}>
          {configured ? "Change it" : "Set it up"}
        </Button>
        {configured ? (
          <>
            <Button onClick={() => setTesting(true)}>Send a test</Button>
            <Button variant="link" onClick={() => remove.mutate()}>
              Forget it
            </Button>
          </>
        ) : null}
      </div>

      <RelayDialog open={editing} onClose={() => setEditing(false)} />
      <TestMailDialog open={testing} onClose={() => setTesting(false)} />
    </section>
  );
}

/** Bytes on the wire, megabytes on a screen. */
const mb = (n: number) => Math.round(n / (1 << 20));

function LimitsPanel() {
  const limits = useQuery({
    queryKey: qk.adminLimits,
    queryFn: getAdminLimits,
  });
  const [editing, setEditing] = useState(false);

  return (
    <section>
      <Heading>Attachments</Heading>
      <p className="text-sm text-muted">
        {limits.data ? (
          <>
            Up to{" "}
            <span className="text-fg">
              {mb(limits.data.asset_max_bytes)} MB
            </span>{" "}
            each,{" "}
            <span className="text-fg">
              {mb(limits.data.account_quota_bytes)} MB
            </span>{" "}
            per account.
          </>
        ) : (
          "…"
        )}
      </p>
      <Button className="mt-3" onClick={() => setEditing(true)}>
        Change limits
      </Button>
      <LimitsDialog open={editing} onClose={() => setEditing(false)} />
    </section>
  );
}
