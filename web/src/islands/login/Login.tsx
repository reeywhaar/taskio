import { useState, type FormEvent } from "react";

import {
  getAuthInstance,
  getAuthInvitesByToken,
  getAuthRecoveriesByToken,
  postAuthInvitesByTokenAccept,
  postAuthLogin,
  postAuthRecoveries,
  postAuthRecoveriesByTokenAccept,
  type Recovery,
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
  const invite = tokenIn("invite");
  const recovery = tokenIn("recover");
  if (invite) return <Accept token={invite} />;
  if (recovery) return <Recover token={recovery} />;
  return <SignIn />;
}

/** The token in /invite/… or /recover/…, and null when the path is neither. */
function tokenIn(kind: string): string | null {
  const match = new RegExp(`^/${kind}/([A-Za-z0-9_-]+)$`).exec(
    window.location.pathname,
  );
  return match?.[1] ?? null;
}

function SignIn() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  // Whether this instance can mail anybody anything, which decides whether there is a way out
  // of a forgotten password to offer at all. An instance with no relay says nothing here, and
  // somebody locked out asks whoever runs it — which is the only path there was.
  const [canMail, setCanMail] = useState(false);
  useEffect(() => {
    getAuthInstance().then(
      (it) => setCanMail(it.recovery),
      () => setCanMail(false),
    );
  }, []);

  if (forgot) return <Forgot onBack={() => setForgot(false)} />;

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
        {canMail ? (
          <Button
            variant="link"
            className="self-center"
            onClick={() => setForgot(true)}
          >
            I have forgotten my password
          </Button>
        ) : null}
      </form>
    </Shell>
  );
}

/**
 * The forgotten-password form, which tells you nothing.
 *
 * It says the same sentence whether or not the address is on an account here, because anything
 * else turns this into a way to ask the instance who has an account and what address they use.
 * The mail itself carries the correction: it names the account, so a link arriving for a name
 * you do not recognise is its own answer, and nothing arriving is the other one.
 */
function Forgot({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await postAuthRecoveries({ email });
      setSent(true);
    } catch (err) {
      // Only the refusals that are about the request rather than about the address: a rate
      // limit is the caller being told to wait, and says nothing about who has an account.
      setError(
        err instanceof ApiError ? err.message : "Something went wrong here.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Shell title="Check your mail">
        <p className="text-sm text-muted">
          If {email} is on an account here, a link to set a new password is on
          its way to it. It is good for a week and works once.
        </p>
        <Button variant="link" className="self-start" onClick={onBack}>
          Back to signing in
        </Button>
      </Shell>
    );
  }

  return (
    <Shell title="Forgotten password">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <p className="text-sm text-muted">
          The address your account proved, and nothing else — a link to set a
          new password goes there.
        </p>
        <TextField
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          className="w-full"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        {error ? <p className="text-sm text-accent">{error}</p> : null}
        <Button
          type="submit"
          variant="solid"
          className="justify-center"
          disabled={busy || !email.trim()}
        >
          Send a link
        </Button>
        <Button variant="link" className="self-center" onClick={onBack}>
          Back to signing in
        </Button>
      </form>
    </Shell>
  );
}

/**
 * Setting a new password from a link, and saying which link this is.
 *
 * Four states somebody acts on differently — set a password, sign in with the one you already
 * set, use the newer link, ask for another — and one refusal for all four leaves every one of
 * them doing the same useless thing.
 *
 * It does not sign anybody in afterwards, which is the difference from accepting an invitation.
 * There, somebody has just chosen the password for an account that did not exist a moment ago.
 * Here the account existed, the link may have reached the wrong person, and typing the new
 * password at the login form once is the cheapest confirmation that the right one has it.
 */
function Recover({ token }: { token: string }) {
  const [link, setLink] = useState<Recovery | null>(null);
  const [gone, setGone] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    getAuthRecoveriesByToken(token).then(setLink, () => setGone(true));
  }, [token]);

  if (done) {
    return (
      <Shell title="That is set">
        <p className="text-sm text-muted">
          Your password is changed and every session it had is closed. Sign in
          with the new one.
        </p>
        <Button
          variant="solid"
          onClick={() => window.location.assign("/login")}
        >
          Sign in
        </Button>
      </Shell>
    );
  }

  if (gone) return <Dead>That link is not one of ours.</Dead>;
  if (link && link.used) {
    return (
      <Dead>
        That link has already been used. Sign in with the password it set, or
        ask for another.
      </Dead>
    );
  }
  if (link && link.voided) {
    return (
      <Dead>
        A newer link replaced this one. Use that one, or ask for another.
      </Dead>
    );
  }
  if (link && link.expired) {
    return <Dead>That link has expired. Ask for another.</Dead>;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await postAuthRecoveriesByTokenAccept(token, { password });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Something went wrong here.",
      );
      setBusy(false);
    }
  };

  return (
    <Shell title="A new password">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        {/* Whose account this opens. Whoever holds the token could take it, so the name gives
            up nothing — and it is the one thing that makes the page checkable: a name you do
            not recognise means the link is not for you. */}
        <p className="text-sm text-muted">
          For {link ? link.username : "…"}. Everything signed in as them is
          signed out when you set this.
        </p>
        <TextField
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="New password"
          className="w-full"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error ? <p className="text-sm text-accent">{error}</p> : null}
        <Button
          type="submit"
          variant="solid"
          className="justify-center"
          disabled={busy || !link}
        >
          Set it
        </Button>
      </form>
    </Shell>
  );
}

/** A link that cannot be used, and the one thing to do about it. */
function Dead({ children }: { children: React.ReactNode }) {
  return (
    <Shell title="taskio">
      <p className="text-sm text-muted">{children}</p>
      <Button variant="link" onClick={() => window.location.assign("/login")}>
        Back to signing in
      </Button>
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
