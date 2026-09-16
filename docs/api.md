# taskio API

taskio is a task list. This page is everything needed to use it from a program: there is no SDK
and nothing else to read.

Every path below is relative to this instance's own address.

## Authenticating

Every request carries a token.

```sh
curl -H "Authorization: Bearer tk_…" "$TASKIO/api/tasks"
```

Get one from **Settings → Tokens** in the app, or from the machine running it:

```sh
docker exec taskio token create --user misha --label claude
```

It is shown once. A lost token is revoked and minted again rather than recovered.

### Nonced tokens

A token can be sent whole, or kept back and proved with a hash. Same token either way.

```
tk_XCKKOs_wu0DuJ4EUbYDOhwV7hOGbGyrVfeT_BWsOhFE   the credential
tkc_1789343452.b7e1cda9e95a.4f2c…                useless in 5 minutes
```

**Use the nonced form when the value will end up in a transcript**, which for an agent is
always. A tool call carrying a raw token is a live credential in a document nobody thinks of as
a secret; a nonced one is spent by the time anybody reads it.

```
tkc_<unix seconds>.<token id>.<sha256("<nonce>.<id>.<key>")>
```

where `key` is the lowercase hex of `sha256(<the whole token, prefix included>)` and `id` is its
first 12 characters. Good for five minutes either way.

```sh
key=$(printf %s "$TOKEN" | shasum -a 256 | cut -d' ' -f1)
id=${key:0:12}
ts=$(date +%s)
tok="tkc_$ts.$id.$(printf '%s.%s.%s' "$ts" "$id" "$key" | shasum -a 256 | cut -d' ' -f1)"
```

A nonced value may also travel as `?token=…`, which a raw one may not.

## Ids

A task id is **eight lowercase characters**: `8qw4tz9k`.

**Any unambiguous prefix of four or more characters works in its place** — `8qw4` names the same
task as long as no other task of yours starts that way. If two do, the answer is `409` and names
both; give another character.

Case is ignored on input, and `i`/`l` read as `1` and `o` as `0`. Output is always lowercase.

**Send back the whole id, not a prefix.** A prefix that names one task today names two next
month. Every response carries the full one.

## Tags

A tag is a slug written on a task: lowercase letters, digits, `-` and `_`.

**There is no tag to create first.** Putting a word in `tags` is what makes it a tag, and taking
it off every task is what makes it stop existing. `and`, `or` and `not` are reserved.

## Filtering

`?tags=` takes an expression:

```
home                                    tasks carrying home
and(home,chores)                        both
or(home,work)                           either
not(work)                               everything without work, including untagged tasks
or(and(home,chores),not(work))          nested freely
```

Prefix form, so there is no precedence to get wrong: the parentheses are the structure.

- `and` and `or` take one or more arguments; `not` takes exactly one.
- **A slug no task of yours carries is refused**, naming every wrong one at once. A typo would
  otherwise be indistinguishable from an empty result.
- At most 1,024 bytes, 8 deep, 64 parts.

## Scopes

A token may be confined to a flat `and()` of tags. It then means two things:

> **A scoped token sees only tasks carrying those tags, and everything it creates is given
> them.**

So a token scoped `and(work)` posting `{"title":"Call the plumber"}` gets back a task tagged
`work`. It cannot see, edit or delete anything outside the scope, and it cannot rename or remove
the tag it is scoped to. Tasks coming back with tags you did not ask for is the scope working,
not a bug.

## Endpoints

```
GET    /api/tasks              ?tags= &q= &status= &limit= &cursor=
POST   /api/tasks              {title, description?, tags?}
GET    /api/tasks/{id}
PATCH  /api/tasks/{id}         {title?, description?, tags?}
POST   /api/tasks/{id}/done
POST   /api/tasks/{id}/todo
DELETE /api/tasks/{id}

POST   /api/tasks/bulk/done      {ids}
POST   /api/tasks/bulk/todo      {ids}
POST   /api/tasks/bulk/tags      {ids, add?, remove?}
POST   /api/tasks/bulk/priority  {ids, priority}
POST   /api/tasks/bulk/pinned    {ids, pinned}
POST   /api/tasks/bulk/delete    {ids}

GET    /api/tags
PATCH  /api/tags/{slug}        {slug}
DELETE /api/tags/{slug}

POST   /api/assets             the bytes
GET    /api/assets/{id}
```

### The bulk routes

One transaction each, all or nothing: an unknown or unreachable id refuses the whole call rather
than applying eleven of twelve changes. At most 500 ids.

`bulk/tags` applies `remove` after `add`, so a slug in both is removed.

`bulk/priority` and `bulk/pinned` set one value across the set — they do not add to what is
there. A task already at that value is not written: `updated_at` does not move for it.

### `GET /api/tasks`

| parameter | default | meaning |
| --- | --- | --- |
| `tags` | — | A filter, above |
| `q` | — | Search. Forgiving about the title, exact about the description |
| `status` | `todo` | `todo`, `done` or `all` |
| `pinned` | — | `true` or `false`. Unset asks about neither |
| `limit` | `1000` | 1 to 1000. The default is the maximum |
| `cursor` | — | From a previous response's `next_cursor` |

```jsonc
{
  "tasks": [ { "id": "8qw4tz9k", "title": "Fix the tap", "description": "It drips.",
               "tags": ["home","repair"], "status": "todo",
               "priority": 0, "pinned": false,
               "created_at": 1789343452, "updated_at": 1789343452, "done_at": null } ],
  "total": 1
}
```

**`status` defaults to `todo`.** Ask for `all` if you want finished tasks too, or you will
summarise the wrong list.

`total` is how many match the filter, before `limit`. `next_cursor` is present only when there
is another page — a search never has one, because results are ranked.

The done list is ordered by when things were finished. Every other list is ordered **pinned
first, then by `priority` descending, then by when they were written** — so a list read top to
bottom is a list in the order somebody meant to work through it.

### Priority and pinning

Both say what to do next, and they are separate on purpose: a pin is where somebody put a task
and a priority is how much it matters, so lowering a number does not unpin anything.

| field | | |
| --- | --- | --- |
| `priority` | any integer, `0` by default | Higher sorts higher. Negative sorts below the unset ones |
| `pinned` | `true` or `false` | Sorts above every unpinned task, whatever their priority |

**Pinning is a property, not a status.** A pinned task is still a todo and still comes back from
`status=todo`; `?pinned=true` narrows to them, and the two compose — `?pinned=true&status=done`
is the pinned things already finished.

Neither orders the done list. They are about what to do next, which a finished task no longer
has an answer to, so the record of what happened stays in the order it happened.

### Writing

`POST` needs only a title, and takes `description`, `tags`, `priority` and `pinned` in the same
call. `PATCH` takes pointers: **an absent field is left alone, an empty one is cleared**, and
`tags` replaces the whole set.

```sh
curl -X PATCH -H "Authorization: Bearer tk_…" -H "Content-Type: application/json" \
  -d '{"priority": 5, "pinned": true}' "$TASKIO/api/tasks/8qw4tz9k"
```

Marking a task done twice is a success and does not move `done_at`.

## Images

A description is markdown, and an image in it is an asset stored here.

**Send it inline and it is one request.** A `data:` URI in the description is decoded, stored and
rewritten before the task is saved:

```jsonc
// sent
{ "title": "Fix the tap",
  "description": "It drips.\n\n![](data:image/png;base64,iVBORw0KGgoAAAANS...)" }

// stored, and returned
{ "title": "Fix the tap",
  "description": "It drips.\n\n![](/api/assets/a_01j9z...)" }
```

Works on `POST` and on `PATCH` alike, and the whole write is one transaction: if one image is
refused, none of them is stored and the task is left as it was.

| limit | value |
| --- | --- |
| Inline images per write | 20 |
| Inline bytes per write, decoded | this instance's per-image limit |

`POST /api/assets` is the other way: the raw bytes as the body, with a `Content-Type`. It
answers `{id, url, content_type, size}` and the `url` goes in the description. Use it when the
same image goes on several tasks, or when a task is edited repeatedly — inline would re-send
every picture on every save.

PNG, JPEG, GIF, WebP and AVIF. **SVG is refused**: it is an image format that runs script. The
declared type and the bytes must agree.

`GET /api/assets/{id}` serves one, and only to the account that owns it.

## Mentioning another task

```
Preparation for @8qw4tz9k
```

`@` and a task id, in a title or a description. A prefix works and **is rewritten to the full id
when the task is saved**, so what comes back is not always what was sent.

What does not resolve — a typo, a deleted task, something outside a token's scope — is left
exactly as typed and is not a link. Nothing is refused over it.

`GET /api/tasks/{id}` carries both directions:

```jsonc
{ "id": "8qw4tz9k", "title": "Preparation for @kr20fj8m",
  "mentions":     [ { "id": "kr20fj8m", "title": "Fix the tap",     "status": "todo" } ],
  "mentioned_by": [ { "id": "3vxq91rt", "title": "Order the part",  "status": "done" } ] }
```

The list endpoint carries neither: resolving them for a thousand rows is a thousand joins for a
decoration.

## Errors

```json
{ "ok": false, "code": "tag_unknown", "message": "No task carries the tag \"chorse\"." }
```

`code` is stable and safe to match on. `message` is written to be read, and names the limit or
the value that was wrong.

| code | status | what to do |
| --- | --- | --- |
| `invalid` | 400 | The body or a parameter is wrong; the message says how |
| `tag_unknown` | 400 | Check the spelling against `GET /api/tags` |
| `filter_invalid` | 400 | The expression does not parse |
| `cursor_invalid` | 400 | Start the list again |
| `unauthenticated` | 401 | The token is missing, wrong, expired or revoked |
| `token_forbidden` | 403 | That route is not open to tokens |
| `out_of_scope` | 403 | The task is outside this token's scope |
| `not_found` | 404 | No such task |
| `prefix_ambiguous` | 409 | Give another character or two |
| `asset_too_large` | 413 | One image is over the limit; the message names it |
| `asset_count_exceeded` | 413 | Too many images in one write |
| `quota_exceeded` | 413 | The account is out of storage |
| `rate_limited` | 429 | Wait, then retry |

## A worked session

```sh
TASKIO=https://taskio.example.com
AUTH="Authorization: Bearer $TOKEN"
JSON="Content-Type: application/json"

# What tags are in use
curl -sS -H "$AUTH" "$TASKIO/api/tags"

# Write one
curl -sS -H "$AUTH" -H "$JSON" -X POST "$TASKIO/api/tasks" \
  -d '{"title":"Fix the tap","description":"It drips.","tags":["home","repair"]}'

# Find it again
curl -sS -H "$AUTH" "$TASKIO/api/tasks?tags=and(home,repair)"
curl -sS -H "$AUTH" "$TASKIO/api/tasks?q=tpa"

# Finish it
curl -sS -H "$AUTH" -X POST "$TASKIO/api/tasks/8qw4/done"
```
