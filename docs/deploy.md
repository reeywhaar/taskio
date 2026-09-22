# Deploy

One image, one port, one directory.

```
ghcr.io/reeywhaar/taskio:latest
```

## Environment

| variable | default | meaning |
| --- | --- | --- |
| `TASKIO_PUBLIC_URL` | *required* | The address you open in a browser |
| `TASKIO_DATA_DIR` | `/data` | Where `taskio.db` lives. Fixed in the image; a variable for local runs |
| `TASKIO_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `TASKIO_BACKUP_URL` | — | A backup agent to post archives to. Unset, taskio takes none |

**There is no config file.** Four variables do not want one, and the two things an operator
actually adjusts — the mail relay and the asset limits — live in the database, where they are a
form field and a test send rather than a redeploy. The environment is for what must be true
before the process starts; neither of those is.

**The web directory is a constant and the data directory is a variable**, which looks
inconsistent and is not. Both are fixed at one path inside the image, so neither is something an
operator changes. The difference is what happens when the path is wrong: a missing bundle is the
placeholder page, so a checkout that never builds the frontend runs perfectly well against a
`/srv/web` that does not exist — while a missing data directory refuses to start, by design,
which would make a bare `go run .` impossible without somewhere to point it. The variable exists
for that, and for tests.

## Behind a proxy

`X-Real-IP`, then the last hop of `X-Forwarded-For`, is the caller. Two things read that address:
the rate limiters, which bucket on it, and a token, which records where it was last used. Without
the headers both see the proxy — every caller shares one bucket and every token says the same
address.

The last hop rather than the first, because that is the one the nearest proxy appended; anything
before it is whatever the caller sent.

## `TASKIO_PUBLIC_URL`

Required, validated at startup, and never inferred from a request. `Host` and
`X-Forwarded-Host` are both client-supplied, so an invitation link built from one is an
invitation link a stranger controls.

It decides four things: whether the session cookie carries `Secure`, what invitation links say,
what recovery mail says, and the base URL `/docs` hands an agent.

A trailing slash is trimmed. A path is refused — taskio serves from the root, and a prefix
would produce links that half work.

## The data directory

```sh
docker run -d --name taskio \
  -e TASKIO_PUBLIC_URL=https://taskio.example.com \
  -v taskio-data:/data \
  -p 8080:80 \
  ghcr.io/reeywhaar/taskio:latest
```

**The image declares no `VOLUME`, and a missing data directory refuses to start.**

A `VOLUME` directive makes docker invent an anonymous volume whenever nobody mounts anything.
That litters the host with orphaned volumes nobody can name, and — worse — it hides the
mistake: the container runs, the database is written somewhere, and the data disappears the
next time the container is replaced. Silently, and noticed once the accounts are gone.

So there is no directive, and `serve` checks the directory exists before it opens anything. A
forgotten `-v` is a startup error naming the flag.

**taskio never creates the directory.** Mounting it is the operator's statement about where the
data lives. Inventing one would be taskio guessing at that, quietly and wrongly.

## Port

`:80` inside the container, not configurable. Remap it with `-p`. A port number inside a
container is not a thing an operator should have to think about twice.

## Getting back in

Three ways, and the last one needs nothing but a shell on the host:

```
docker exec taskio taskio invite --role admin   # a link that makes an account
docker exec taskio taskio recover <username>    # a link that sets a password on one
```

`recover` prints a link to `/recover/<token>`, good for a week and usable once. It changes
nothing when it is issued — the account carries on with the password it has until somebody
walks through the link — so it is safe to mint for somebody who turns out to have been fine.
Spending one ends every session that account had, which is the point: the likeliest reason to
be here is that somebody else has one.

The same link can be issued from the admin page, per person, and read once. Where a relay is
configured, somebody locked out can also ask for one themselves at the login form; it goes to
the address their account has proved, and nowhere else. An instance with no relay offers
nothing there, and the two commands above are the whole of it.

## The image

Multi-stage, and the stages do not depend on each other.

- **Go stage** cross-compiles: `CGO_ENABLED=0`, `-trimpath`, version stamped through
  `-ldflags`. `modernc.org/sqlite` is pure Go, which is what keeps this static.
- **Node stage** builds the bundle and the docs page. It arrives with `web/`.
- **`COPY` path by path**, not a `.dockerignore`. An allowlist cannot accidentally admit
  `web/node_modules` or a local `data/`.
- **Alpine runtime with `ca-certificates`** — the mail relay and the backup agent are both
  reached over TLS.
- **`HEALTHCHECK` runs `taskio healthcheck`**, a second process asking the first, so the image
  needs no HTTP client and a wedged server fails it.

## Tags

A push to `main` that passes the tests moves three tags onto one image:

| tag | what it means |
| --- | --- |
| `:latest` | whatever was published last. Fine for a first look, and a pin to nothing |
| `:v1` | this line of the software, fixes included. What a deployment pins to |
| `:<sha>` | one commit and no other. What a rollback names, since the other two have moved |

There is no release number to keep in step with. If something ever breaks compatibility, `:v2`
is what it would be published under, beside a `:v1` that keeps getting fixes.

What the binary says it is, is the commit it was built from: stamped through `-ldflags`, printed
by `taskio version`, and on the startup line. It is the one fact about a build that is true
without anybody maintaining it.

## The bundle is read from disk, not embedded

`serve` hands the static server an `os.DirFS` over `/srv/web`, walked once at startup.

Embedding would make every stylesheet an input to the Go compiler, so a one-line CSS change
would invalidate the layer that compiles and relinks the binary. Reading from disk is what lets
the two image stages be independent, and what lets `go test ./...` pass with no frontend build
present.

A missing bundle is the placeholder page rather than a failure.

## CI

`test` → `publish` → `notify`, on push to `main` and by `workflow_dispatch`.

Publishing on every push is safe because `publish` needs `test`: a red build skips it rather
than shipping a broken image as `latest`. That dependency is the whole gate.

`publish` pushes `:latest` and a tag for the commit sha — the sha tag is what makes a rollback
possible at all, since `latest` has by then moved.

## Backups

Set `TASKIO_BACKUP_URL` to a backup agent and taskio posts it a gzipped `VACUUM INTO` snapshot
of the database. Leave it unset and taskio takes no backups at all.

```
taskio ──POST archive──▶ agent ──▶ wherever the agent was told
       (no credential)    (holds the token, names the file, prunes old ones)
```

**taskio holds no credential, no provider, no bucket and no retention policy.** It decides when
to back up and what goes in the archive; everything after that belongs to the agent. A
compromised taskio container cannot read, overwrite or delete a single existing backup — it has
nothing to authenticate with and nothing to point at. It can only hand over one more archive.

### A copy goes out on meaningful content change, and at no other time

The loop looks every half hour and sends only when something was actually written since the
last archive the agent accepted.

Meaningful excludes two things. A session's `last_seen_at` and a token's `last_used_at` are the
process noticing itself rather than somebody writing something down. And a save that sets
identical values is not a change: content updates carry their own comparison in the `WHERE`
clause, so `RowsAffected` is zero when nothing differed.

A restart sends one archive, because a process that has just started may be on a volume nobody
has a copy of yet.

### There is no heartbeat

An archive is never sent to say *nothing happened*. An instance nobody has touched since Tuesday
sends nothing, for as long as that lasts.

The case against: an agent receiving copies only when somebody adds a task cannot tell a broken
taskio from a quiet one. That is answered by `/healthz`, which says whether this instance is up,
continuously, to anything that asks. A periodic archive would be a second liveness signal
carrying one bit in a few hundred megabytes, on a schedule too coarse to alert from. *Is it
running* is monitoring; *is there a copy of what it holds* is answered by the copy being current.

### Restoring

Stop the container, extract the archive into the data directory, start it again. Everybody stays
signed in, because sessions are in the same file.

The archive carries every password hash on the instance and every image anybody has pasted, so
it is worth the same care as the directory itself.

## With a backup agent

```yaml
services:
  taskio:
    image: ghcr.io/reeywhaar/taskio:latest
    environment:
      TASKIO_PUBLIC_URL: https://taskio.example.com
      TASKIO_BACKUP_URL: http://backup:8080/backup
    volumes: [taskio-data:/data]
    ports: ["8080:80"]

  backup:
    # The agent holds the token and decides where archives end up.
    image: ghcr.io/reeywhaar/backio-agent:latest
    environment:
      # …destination and credential, which are the agent's business

volumes:
  taskio-data:
```

**An example shows the smallest thing that works.** Everything else — the log level, the data
directory, anything that exists for a checkout rather than a deployment — is in the table above
and stays out of here. An example carrying a variable nobody needs teaches that it is required,
and it gets copied into every deployment thereafter.
