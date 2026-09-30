# Screenshots

The pictures in the project README, captured from a real taskio filled with invented data.

```sh
docs/screenshots/capture.mjs
```

That builds the frontend and the binary, starts taskio on an empty data directory, signs in
through the first-run invitation, fills it from [`seed.mjs`](seed.mjs) through its own API, drives
headless Chromium over the DevTools protocol, and overwrites the PNGs here. Everything it starts
is stopped on the way out. Each PNG says its density, 72 dpi times `SCALE`, as a macOS
screenshot does, so a viewer that reads it shows it at its size on screen.

Needs `go`, `node`, `sqlite3` and Chromium or Chrome, and port 80, where taskio listens.

**A run with nothing changed changes nothing.** The server's ids are random, so before each shot
every task, picture and token id on the page is swapped for a stand-in made from its seed key, in
the same shape; the caret is hidden and transitions are finished. Two runs give the same bytes, so
a PNG shows up in `git status` only when the screen it is of did. A new Chromium can still move a
pixel, and that is a real change to what the screen looks like.

| knob | |
| --- | --- |
| `SIZE=800` | the window, square, in CSS pixels |
| `SCALE=2` | device pixels per CSS pixel |
| `THEME=dark` | the other theme; `OUT=/tmp/shots` keeps it off the committed set |
| `ONLY=list,task` | just those shots |
| `NOTES=0` | without the notes |

**The data** is `seed.mjs`: projects, each with its groups and tasks, tokens, the search typed
into the box, and the pictures, which are SVGs drawn in the same browser and uploaded as PNGs.
Adding a project, group or task is an entry there. Tasks refer to each other as `@{key}` and to
pictures as `(image:key)`; ages are backdated with `sqlite3`, since nothing in the API sets a time.

**The shots** are the list at the bottom of `capture.mjs`: where to go, what to do there, and
optionally one element to crop to. Each can carry notes: small popovers drawn over the page by an
injected script that measures what they point at. Shown as popovers, because a task's dialog is
in the top layer and anything else would be drawn under it.
