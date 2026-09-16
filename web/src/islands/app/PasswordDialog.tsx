import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { postAccountPassword } from "@app/api/actions/account";
import { ApiError } from "@app/api/transport";
import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import { Field } from "@app/components/Field";
import { TextField } from "@app/components/TextField";

/** What the server refuses anything shorter than. Mirrors store's own minimum. */
const MIN_PASSWORD = 8;

/**
 * Changing your own password.
 *
 * A dialog rather than fields sitting open on the settings page. Everything else there is
 * something to read — who you are signed in as, what storage is left, which sessions exist —
 * and empty password boxes in the middle of it are the only part that looks like work
 * outstanding. They are also password boxes on screen for as long as the page is, which is a
 * thing to leave a shared machine showing.
 *
 * The current password is required, and that is the whole point of the form: being signed in
 * is not the same as knowing it, and the difference is what stops a borrowed session becoming
 * a taken account.
 */
export function PasswordDialog({
  open,
  onClose,
}: {
  open: boolean;
  /** Given true when the password actually changed, so the page can say so. */
  onClose: (changed?: boolean) => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");

  const change = useMutation({
    mutationFn: () => postAccountPassword({ current, new: next }),
    onSuccess: () => {
      // Nothing is kept afterwards, and the dialog goes with it: leaving filled password fields
      // on screen is leaving them to be read over a shoulder.
      setCurrent("");
      setNext("");
      setAgain("");
      onClose(true);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  // Emptied when it opens, not when it closes. A dialog cleared on the way out shows what was
  // typed for as long as it takes to close.
  useEffect(() => {
    if (!open) return;
    setCurrent("");
    setNext("");
    setAgain("");
    setError("");
  }, [open]);

  // Caught here because the server cannot: it receives one new password and has no way to know
  // it was meant to be typed twice.
  const mismatch = again !== "" && next !== again;
  const usable =
    current !== "" &&
    next.length >= MIN_PASSWORD &&
    next === again &&
    !change.isPending;

  return (
    <Dialog
      open={open}
      onClose={() => onClose()}
      title="Change your password"
      footer={
        <>
          <Button onClick={() => onClose()} disabled={change.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="change-password"
            variant="solid"
            disabled={!usable}
          >
            {change.isPending ? "Changing…" : "Change it"}
          </Button>
        </>
      }
    >
      <form
        id="change-password"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (usable) change.mutate();
        }}
      >
        <p className="text-sm text-muted">
          Your current one is required — being signed in here is not the same as
          knowing it. Your other browsers are signed out; this one stays.
        </p>

        <Field label="Current password">
          <TextField
            type="password"
            autoComplete="current-password"
            data-autofocus
            className="w-full"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field
          label="New password"
          hint={`At least ${MIN_PASSWORD} characters.`}
        >
          <TextField
            type="password"
            autoComplete="new-password"
            className="w-full"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label="New password again">
          <TextField
            type="password"
            autoComplete="new-password"
            className="w-full"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
        </Field>

        {mismatch ? (
          <p className="text-sm text-accent">These two do not match.</p>
        ) : null}
        {error ? <p className="text-sm text-accent">{error}</p> : null}
      </form>
    </Dialog>
  );
}
