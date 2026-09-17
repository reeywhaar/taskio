# Conventions

Naming, commits, comments, ids, time. Settled once here so it is not re-argued in review.

## Comments

**Why, never what.** A comment restating the line under it is noise. A comment recording the
reason a line is written the way it is stops somebody "simplifying" it back into a bug.

**No prose.** A comment is a note, not a paragraph. Say the reason in a sentence or two and
stop. If it needs three paragraphs to justify, that argument belongs in `docs/` and the comment
points at it.

**No history.** Never "this used to be X", "an earlier version did Y", "this was changed
because". Git holds that. A comment describes the code as it is, in the present tense, to
somebody who has never seen any other version of it.

```go
// Good
// Only when a body is present: a DELETE legitimately carries none.

// Bad — history
// This used to check every request, but that broke DELETE, so now it only fires when
// there is a body.

// Bad — prose
// Checked only when a body is actually present, because a DELETE legitimately carries
// none, and demanding a content type for an absent body is a rule that only ever catches
// our own client rather than any caller we are trying to defend against.

// Bad — what
// If the content length is not zero and the content type is not JSON, refuse.
```

**No negations.** A comment explains the code that is there. It does not explain what is
*absent* — why a dependency was not taken, why a feature does not exist, why a directive was
left out. Those are decisions, they belong in `docs/`, and a comment is the wrong shape for
them: it sits beside code that has nothing to do with the thing being argued about, it is
invisible to anybody who did not already open that file, and there is no natural place for the
second one when a related question comes up.

```go
// Bad — an argument about something that is not here
// No VOLUME. Declaring one makes docker invent an anonymous volume whenever nobody
// mounts anything, which litters the host with orphans.

// Good — the decision in docs/deploy.md, and nothing beside the code
```

If a reader would be surprised by an absence, that surprise belongs in the document that
covers the subject, where it can be found by somebody asking the question rather than only by
somebody reading that file.

**Say it once.** The same reason in a function, its test and its caller is three copies to keep
true, and the two that fall behind are the ones somebody will read.

**Package doc comments are expected**, and are the right place for the argument a package
exists to make — not what it contains, which is readable.

## Examples

**The smallest thing that works, and nothing else.** A `docker run` line, a compose file, a
`curl` — each shows only what a reader must supply. Log levels, tuning knobs, anything that
exists for a checkout rather than a deployment: those belong in the reference table beside the
example, never in it.

An example carrying a variable nobody needs teaches that it is required, and it is copied into
every deployment that follows.

## Commits

**One or two lines.** A declarative sentence saying what the change accomplishes. Capitalised,
no trailing period, no prefix, no conventional-commit tag, no ticket number.

**No trailers. No `Co-Authored-By`. No generated-with footer.** Ever.

```
Refuse a public URL with a path in it rather than producing links that half work

Resolve a task prefix inside the caller's own tasks
so an ambiguous one cannot reveal somebody else's
```

A second line is for the clause that would not fit, not for a body. A change that genuinely
needs three paragraphs is usually two changes.

## Go

- `gofmt` clean; CI fails on anything it would rewrite.
- Tests beside sources as `*_test.go`. No `tests/` directory.
- Errors wrap with `%w` and name what was being done.
- One error vocabulary in `internal/store` — `ErrNotFound`, `ErrConflict`, `ErrInvalid` — built
  through `store.NotFound`, `store.Conflict` and `store.Invalid` so the message is a sentence
  written for whoever reads it.
- `context.Context` first parameter on anything that can block.
- Injectable clocks, so expiry is driven rather than slept through.
- A function returning "this succeeded, and also something happened" returns a bool, not a
  sentinel error.
- Test names are sentences: `TestATrailingSlashIsTrimmedRatherThanRefused`.

## TypeScript

- Prettier, default settings.
- Components are `PascalCase.tsx`; everything else is `camelCase.ts`.
- Imports use the `@app/*` alias, never `../../`.
- `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`,
  `verbatimModuleSyntax`.

## Identifiers

Three kinds, and the rule that decides between them:

> A software-only identifier is a ULID. An identifier a person or a model types is short. An
> identifier the caller has to compute without asking is derived.

| kind | shape | used by |
| --- | --- | --- |
| ULID | prefix plus 26 Crockford characters over 16 bytes | `p_` principal, `i_` invite, `a_` asset, `gr_` group |
| random | 26 Crockford characters, no prefix, prefix-addressable | tasks |
| derived | hash of the thing it names | tokens, tags |

Ids are opaque and never parsed back. A malformed one is refused before it reaches a query, so a
typo is a `400` rather than an empty result that looks like a `404`.

## Migrations

Named `<timestamp>_<snake_case_name>.go`, where the timestamp is the UTC moment the file was
written:

```sh
date -u +%Y%m%d%H%M%S
```

Not a counter. Two people working at once pick the same next integer and do not pick the same
second. The runner sorts by name, so the timestamp is the order.

**Never edit a released migration.** Every deployment past it has recorded it as applied and
will skip the edit forever.

## Time

- `main.go` pins `time.Local = time.UTC`. Everything stored and logged is UTC.
- Stored as **Unix seconds in an `INTEGER` column**. Not text, not milliseconds.
- Nothing here needs local time, so no zone database is compiled in.

## Logging

`log/slog`. Log what an operator needs: a login refused, an account created, a token refused and
why, a sweep that deleted something, a backup sent or failed, a migration applied.

**Never** a token, a cookie value, a password, the relay's password, a recovery code — or a
task's title or description. A log line about a task names its short id.

`debug` is a level, not an exemption.
