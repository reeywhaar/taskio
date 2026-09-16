# taskio

A task list a person and their agent can both use.

Tasks have a title, a markdown description, tags and one of two states. That is the whole model.
What makes it worth its own thing is the other half: the HTTP API is flat enough to be described
on a single unauthenticated page, so an agent reads `/docs` once and then uses taskio without an
SDK, a schema, or anybody writing a wrapper.

- **Self-hosted.** One static binary, one SQLite file, one port.
- **Two front doors on one account.** What you add in the browser is what the agent sees, and
  the other way round.
- **Scoped tokens.** A token can be confined to a set of tags: it sees only tasks carrying them,
  and gives them to everything it creates.

## Run it

```sh
docker run -d --name taskio \
  -p 8080:80 \
  -v taskio-data:/data \
  -e TASKIO_PUBLIC_URL=https://taskio.example.com \
  ghcr.io/reeywhaar/taskio:latest
```

With no administrator on record, the server logs an invitation link at startup — open it to make
the first account:

```sh
docker logs taskio
```

Four environment variables, a compose example, and what to back up are in
[docs/deploy.md](docs/deploy.md). `TASKIO_PUBLIC_URL` is required and is never inferred from a
request header, because an invitation link built from one is a link a stranger controls.

## Use it from a program

Point an agent at `https://your-instance/docs`. That page is the entire interface: it is
unauthenticated on purpose, so the first request an agent makes is the one that tells it how to
make the rest. The same text lives at [docs/api.md](docs/api.md).

```sh
curl -H "Authorization: Bearer tk_…" "$TASKIO/api/tasks?tags=and(home,chores)"
```

Tokens come from **Settings → Tokens** in the app, or from the machine running it:

```sh
docker exec taskio token create --user misha --label claude
```

A token can also be proved with a hash rather than sent whole, which is what an agent should do
when the value will end up in a transcript. `/docs` explains it.

## Command line

The image's entrypoint is the binary, so every subcommand is one `docker exec` away.

| command | |
| --- | --- |
| `serve` | Run the server |
| `invite` | Print a new invitation link |
| `token create\|list\|revoke` | Mint, list and revoke API tokens |
| `sweep` | Delete what is due now — see below. `--dry-run` shows what would go |
| `healthcheck` | Ask the running server whether it is well |
| `version` | Print the version this binary was built from |

The server sweeps on its own schedule; the subcommand is for running a pass by hand. A pass
clears expired sessions, invitations and recovery attempts, collects assets no task references
any more, and **deletes tasks finished more than thirty days ago** — the one thing here that
removes something somebody wrote, and the reason a backup is worth configuring.

## Develop

Go 1.27 and Node 26. There is no code generation step and no Makefile.

```sh
go test ./...                                   # the server
npm --prefix web ci && npm --prefix web test    # the frontend

mkdir -p data && TASKIO_PUBLIC_URL=http://127.0.0.1 TASKIO_DATA_DIR=./data go run . serve
```

The server listens on `:80` — fixed, because it is remapped by `docker run -p` rather than
configured. A missing frontend build is not fatal: the server serves a placeholder that says so,
which is what lets `go test ./...` pass with no bundle present.

For the frontend, `npm --prefix web run dev` gives Vite on its own port, and `npm --prefix web
run smoke` drives a real headless Chromium against a running instance — palettes, contrast,
layout and the sign-in gate, which are the things jsdom cannot answer.

```
main.go            the CLI's entry
internal/
  api/             routes, the CSRF guard, static serving
  store/           SQLite: tasks, tags, sessions, tokens, assets
  filter/          the tag filter grammar — or, and, not
  search/          typo-tolerant matching
  mail/            SMTP, for one message: the recovery code
  backup/ sweep/   the two background loops
web/               React, Tailwind, three islands
docs/              deploy, API, conventions — api.md renders to /docs
```

## Conventions

[docs/conventions.md](docs/conventions.md) is the short version: comments are notes rather than
prose, they explain what is there rather than what is absent, and decisions that need arguing go
in `docs/` where they can be read once instead of in a comment nobody scrolls to.
