import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getAdminRelay,
  postAdminRelayTest,
  putAdminRelay,
} from "@app/api/actions/admin";
import { ApiError } from "@app/api/transport";
import { qk } from "@app/api/keys";
import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import { Field, Fields } from "@app/components/Field";
import { Select } from "@app/components/Select";
import { TextField } from "@app/components/TextField";

/** Settings for the relay taskio hands messages to. */
export function RelayDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: (saved?: boolean) => void;
}) {
  const client = useQueryClient();
  const relay = useQuery({ queryKey: qk.adminRelay, queryFn: getAdminRelay });
  const [form, setForm] = useState({
    host: "",
    port: 587,
    security: "starttls",
    username: "",
    password: "",
    from_address: "",
    from_name: "",
  });
  const [error, setError] = useState("");

  // Once per opening, not on every arrival of the record: seeding on each one overwrites what
  // somebody has already typed, and the slower the network the more of it there is to lose.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) seeded.current = false;
  }, [open]);

  // Reloaded from what is on record every time it opens, so an abandoned edit is abandoned.
  useEffect(() => {
    if (!open || seeded.current || !relay.data) return;
    seeded.current = true;
    setForm({
      host: relay.data.host,
      port: relay.data.port,
      security: relay.data.security,
      username: relay.data.username,
      // Never comes back out; an empty field means the stored one.
      password: "",
      from_address: relay.data.from_address,
      from_name: relay.data.from_name,
    });
    setError("");
  }, [open, relay.data]);

  const save = useMutation({
    mutationFn: () => putAdminRelay(form),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: qk.adminRelay });
      onClose(true);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...patch }));

  return (
    <Dialog
      open={open}
      onClose={() => onClose()}
      title="Mail relay"
      wide
      footer={
        <>
          <Button onClick={() => onClose()} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="relay"
            variant="solid"
            disabled={!form.host || save.isPending}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form
        id="relay"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.host) save.mutate();
        }}
      >
        <Fields>
          <Field label="Host">
            <TextField
              data-autofocus
              className="w-full"
              placeholder="smtp.example.com"
              value={form.host}
              onChange={(e) => set({ host: e.target.value })}
            />
          </Field>
          <Field label="Port">
            <TextField
              type="number"
              className="w-full"
              value={form.port}
              onChange={(e) => set({ port: Number(e.target.value) })}
            />
          </Field>

          <Field label="Encryption">
            {/* No third option: a password crossing the network in the clear is not a choice
                somebody should be able to make by accident. */}
            <Select
              className="w-full"
              value={form.security}
              onChange={(e) => set({ security: e.target.value })}
            >
              <option value="starttls">STARTTLS (usually port 587)</option>
              <option value="implicit">Implicit TLS (usually port 465)</option>
            </Select>
          </Field>
          <Field
            label="Username"
            hint="Leave both blank for a relay that wants no credentials."
          >
            <TextField
              className="w-full"
              value={form.username}
              onChange={(e) => set({ username: e.target.value })}
            />
          </Field>

          <Field
            label="Password"
            hint={
              relay.data?.password_set
                ? "Stored. Leave blank to keep it."
                : undefined
            }
          >
            <TextField
              type="password"
              className="w-full"
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
            />
          </Field>
          <Field label="From address">
            <TextField
              className="w-full"
              placeholder="taskio@example.com"
              value={form.from_address}
              onChange={(e) => set({ from_address: e.target.value })}
            />
          </Field>

          <Field label="From name" wide>
            <TextField
              className="w-full"
              placeholder="taskio"
              value={form.from_name}
              onChange={(e) => set({ from_name: e.target.value })}
            />
          </Field>
        </Fields>

        {error ? <p className="mt-3 text-sm text-accent">{error}</p> : null}
      </form>
    </Dialog>
  );
}

/**
 * Sending one message through the saved relay.
 *
 * Its own dialog because it is its own act: it proves what was saved, and pairing it with the
 * form would offer to test settings that are not the ones in effect.
 */
export function TestMailDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTo("");
    setNote("");
    setError("");
  }, [open]);

  const test = useMutation({
    mutationFn: () => postAdminRelayTest({ to }),
    onSuccess: () => {
      setError("");
      setNote("Sent.");
    },
    // The relay's own words: "the host was wrong", "the credentials were rejected" and "the
    // certificate did not verify" are three different afternoons.
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong."),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Send a test message"
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button
            type="submit"
            form="test-mail"
            variant="solid"
            disabled={!to || test.isPending}
          >
            {test.isPending ? "Sending…" : "Send it"}
          </Button>
        </>
      }
    >
      <form
        id="test-mail"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (to) test.mutate();
        }}
      >
        <Field label="To">
          <TextField
            type="email"
            data-autofocus
            className="w-full"
            placeholder="you@example.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        {error ? <p className="text-sm text-accent">{error}</p> : null}
        {note && !error ? <p className="text-sm text-muted">{note}</p> : null}
      </form>
    </Dialog>
  );
}
