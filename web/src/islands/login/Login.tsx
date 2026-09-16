import { useState, type FormEvent } from "react";

import {
  getAuthInvitesByToken,
  postAuthInvitesByTokenAccept,
  postAuthLogin,
} from "@app/api/actions/auth";
import { ApiError } from "@app/api/transport";
import { Button } from "@app/components/Button";
import { TextField } from "@app/components/TextField";
import { useEffect } from "react";

/**
 * The only document an unauthenticated visitor loads: a few kilobytes instead of the whole
 * application, and an invitation link opens a page about accepting an invitation rather than
 * the shell of an app the visitor cannot use.
 */
export function Login() {
  const token = inviteToken();
  return token ? <Accept token={token} /> : <SignIn />;
}

function inviteToken(): string | null {
  const match = /^\/invite\/([A-Za-z0-9_-]+)$/.exec(window.location.pathname);
  return match?.[1] ?? null;
}

function SignIn() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await postAuthLogin({ username, password });
      window.location.assign("/");
    } catch (err) {
      // The server's own sentence, because it was written for whoever reads it.
      setError(
        err instanceof ApiError ? err.message : "Something went wrong here.",
      );
      setBusy(false);
    }
  };

  return (
    <Shell title="taskio">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <TextField
          name="username"
          autoComplete="username"
          placeholder="Username"
          className="w-full"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />
        <TextField
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          className="w-full"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <p className="text-sm text-accent">{error}</p> : null}
        <Button
          type="submit"
          variant="solid"
          className="justify-center"
          disabled={busy}
        >
          Sign in
        </Button>
      </form>
    </Shell>
  );
}

/** Accepting signs you in: being shown a login form afterwards is asking somebody to prove
 *  something they just proved. */
function Accept({ token }: { token: string }) {
  const [live, setLive] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Whether the link is live, before somebody types a password into it.
  useEffect(() => {
    getAuthInvitesByToken(token).then(
      () => setLive(true),
      () => setLive(false),
    );
  }, [token]);

  if (live === false) {
    return (
      <Shell title="taskio">
        <p className="text-sm text-muted">
          That invitation has been used or has expired. Ask for another.
        </p>
      </Shell>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await postAuthInvitesByTokenAccept(token, { username, password });
      window.location.assign("/");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Something went wrong here.",
      );
      setBusy(false);
    }
  };

  return (
    <Shell title="Make an account">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <TextField
          name="username"
          autoComplete="username"
          placeholder="Username"
          className="w-full"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />
        <TextField
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="Password"
          className="w-full"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <p className="text-sm text-accent">{error}</p> : null}
        <Button
          type="submit"
          variant="solid"
          className="justify-center"
          disabled={busy || !live}
        >
          Create it
        </Button>
      </form>
    </Shell>
  );
}

function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </main>
  );
}
