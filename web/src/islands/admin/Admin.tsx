import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deleteAdminRelay,
  getAdminLimits,
  getAdminRelay,
  getAdminUsers,
  postAdminInvites,
} from "@app/api/actions/admin";
import { qk } from "@app/api/keys";
import { Button } from "@app/components/Button";
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
    <h2 className="mb-2 text-sm font-semibold tracking-wide text-faint uppercase">
      {children}
    </h2>
  );
}

function Users() {
  const users = useQuery({ queryKey: qk.adminUsers, queryFn: getAdminUsers });
  const [link, setLink] = useState("");
  const [role, setRole] = useState("user");

  const invite = useMutation({
    mutationFn: () => postAdminInvites({ role }),
    // Readable exactly once, so a lost link is reissued rather than recovered.
    onSuccess: (result) => setLink(result.link),
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
            <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted">
              {user.role}
            </span>
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

      {link ? (
        <div className="mt-3 rounded-md border border-warn/40 bg-surface p-3">
          <p className="text-sm text-warn">This link is shown once.</p>
          <code className="mt-1 block break-all font-mono text-sm select-all">
            {link}
          </code>
        </div>
      ) : null}
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
        taskio hands a message to a relay you already have. One thing sends
        today: the code that proves a recovery address.
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
