# Interface

Decisions about the screen, and the arguments behind them. The components say what they do;
this says why they are shaped that way, and what was turned down.

## The description editor is a textarea over markdown

Markdown is the storage format. A rich-text surface would have to round-trip it — parse on the
way in, serialise on the way out — and every round trip is a chance to lose a construct nobody
tested. A textarea and a Write/Preview switch is the shape anybody who has left a code-review
comment already knows.

**It is set in the proportional face, not a monospace one.** A description is prose with some
marks in it rather than code. Monospace sets prose wide and heavy: the same words take more
room and read as a listing. The preview beside it is proportional, and the two tabs are the
same text — so they are the same face and the same size, and switching between them changes
nothing about how the writing looks.

Alignment is the case monospace is for — tables, fixed-width diagrams — and it loses to prose
here because a description is mostly sentences.

## Controls are 16px on a phone and smaller above it

iOS Safari zooms the page when a control smaller than 16px takes focus, and a page that jumps
when you tap its one field is a page nobody wants to type in twice. So `input`, `select` and
`textarea` are 16px.

Above `40rem` — wider than the phones that zoom — the description editor drops to the preview's
14px. Only the editor: the other fields are single lines where 16px costs nothing, and the
editor is a paragraph of text where it costs a size.

## `TextField` states no width and no text size

The caller owns both. A width in the component collides with one passed by a caller — two
Tailwind classes of equal specificity, where the winner is whichever lands later in the
stylesheet, which is not something a call site can see. A text size would read as if it applied
and then lose to the 16px rule above.

The cost is that every call site has to pass a width, and one that forgets gets the browser's
default input size. That happened, and the browser test now asserts a field fills its form.

## Focus is the border, not a ring

A focused control takes the brand colour on its own border and draws no outline.

The alternative was an outline, and the trouble is where it sits. Outside the border there is a
gap between the two, and the pair reads as a second frame around the field rather than as
focus; flush or inset it doubles the edge into something heavier than the control. The border
is already the shape of the field, so colouring it says the same thing with nothing added.

It is not colour alone: the border goes from a light grey to a saturated brand colour, which is
a change in lightness as well as hue.

**Everything without a border takes a ring instead** — buttons, links, the tag pills. There is
no border beside it there, so nothing reads as a double frame, and it is drawn on
`:focus-visible` rather than `:focus`: a button reached by mouse does not match that, so
clicking one does not leave it ringed. A text field matches either way, which is the reason the
rule stops at the controls that do not.

## The list's three choices are two questions

The control reads **Pinned · Todo · Done**, and only two of those are statuses. Pinning is a
property a todo may have, so the pinned view asks the API for `status=todo&pinned=true` rather
than for a third state a task can be in. The URL says `?view=pinned`, which is a different word
from the API's `status` on purpose: an agent copying one into the other gets a refusal rather
than a surprise.

A pinned task still appears under Todo. It is a marker, not a drawer.

## Priority is a number and a pin is a place

Both order the live list, pinned first and then by priority, and they stay separate because
they answer different questions: a pin is where somebody put a task and a priority is how much
it matters. Collapsed into one number, unpinning would mean lowering a score.

The number is drawn only when it is not zero. A nought on every row is a column of noughts that
says nothing, and the capsule is there to be noticed.

Both sit in the left column, under the id, where the row is already as wide as eight
characters and nothing else is using the room. The number comes first: an unpinned row still
spends the pin's width, so behind it the number would sit off the left edge the id sets. The pin appears on hover when it is not set — it
is a thing you do to a task in passing, and burying it in the editor would mean opening a task
to say it matters.

## A row's two marks are on opposite sides

Selection is on the left and finishing is on the right.

They were the same control for a while, and the trouble is that selection mode then had two
columns of boxes meaning different things — one of them "this task is done", the other "this
task is picked" — a foot apart and identical. Splitting them by side means the left column
appears only while selecting and the right one always does the same thing.

## The bulk bar offers one status action

The list is filtered to one status, so every task in a selection has it, and a button for the
status they already have does nothing to any of them. The bar takes the filter and shows the
one that moves them.

## `line` strokes and `fill` fills

Two tokens, because a 1px edge and a filled plate want different contrast against the same
background. A colour pitched to make a border visible makes a selected row a slab; one pitched
for the plate makes the border invisible. They are read at two weights — 1.5px around a control
and 1px for a structural hairline — and the colour is pitched for the thicker one, which is
what somebody types into.

## The mark is two rectangles, not a letter

The favicon is a brand-coloured T on a pale tile, drawn as two rectangles rather than as
`<text>`. A favicon that names a font is a favicon drawn differently on every machine, and at
16px the difference is the whole mark.

`favicon.svg` is what browsers use. `favicon.ico` is there because Safari and anything older
ask for `/favicon.ico` by name, and without one that request reaches the SPA and is answered
with a redirect to the sign-in page — an HTML document where an icon was expected. It is
generated from the same geometry by `npm run favicon`, so the two cannot drift.

## The tab is named after the filter

`web and job :: taskio`, or just `taskio` with nothing lit.

A tab is worth naming when it is one of several, and what makes one of these different from
another is which tags are lit — the view and the search box are things somebody is doing right
now rather than a place they have parked. "and" between them because that is what the filter
means, and what the pills spell into the URL: tasks carrying every one of them, not any.

It is set where the location is kept, not by whoever renders the list. A tab kept in step by
the call sites that remember to is a tab that falls behind one of them.

## The last answer stays until the next one arrives

Lighting a tag asks a different question, and a list that empties while the answer is in flight
says "there is nothing", which is a different sentence from "wait". The rows from the last
question stay on screen, dimmed, under a two-pixel bar, until the new ones replace them.

The bar is drawn while another question's answer is on screen, not on every refetch. A
background refresh of the same question puts the same rows back, and a bar that blinks on each
one is noise rather than news.

The empty state waits for that too, or the first thing a fresh filter says is that nothing
matched — before anything has been asked.

## An open tab keeps up on its own

`GET /api/events` is a stream the browser holds open. When content changes the server sends one
word, and the tab refetches what is on screen.

**Server-sent events rather than a websocket.** What travels is one word in one direction, so
half a socket would go unused; `EventSource` reconnects on its own with backoff, which is most
of what a socket here would have needed hand-writing; and it is plain HTTP, so nothing in front
of it has to be taught a second protocol and `go.mod` keeps its three dependencies. The
alternatives the task listed — refetch on focus, refetch on a timer — are a guess about when
something happened, and this is the answer.

**The message carries nothing.** Not what changed, not whose. What changed is a question the
caller already has endpoints for, and a payload here would be a second copy of the model to
keep true.

**A watcher hears its own account and nothing else.** Every write says whose it was, and the
stream is scoped to the account holding it — a stream everybody hears is a fact about other
people's afternoons, delivered to anyone with a tab open.

What belongs to no one account is sent to everybody: the mail relay, the attachment limits, the
roll of accounts, a sweep that reaches across all of them. Those are the instance's, and a tab
showing them should not be the last to know.

It is a browser's channel, not an agent's: session-only, and absent from `/docs`. Something
holding a token has the list endpoints and a schedule of its own.

## A dialog is the whole screen on a phone

A centred card on a phone spends its margins on the page behind it, which nobody is reading,
and leaves the editor a slot to type into. Below the breakpoint the dialog is the viewport:
no inset, no rounding, no border. Above it, the centred card it always was.

Either way the body scrolls and the footer does not, so what a dialog asks for is never below
the fold with nothing to press. The editor takes the slack, which is the point of the screen
being full — a description is the thing you opened it to write.

**Nothing is lit on opening unless it asked to be.** `showModal()` focuses the first control it
finds whether or not that control wanted focus, and in the task editor that is Delete — a ring
on a destructive action reads as armed. React's `autoFocus` is a call rather than an attribute
and has already run by then, so whatever holds focus at that moment is what asked for it: it
gets it back, and where nothing did, the dialog holds it instead.

## Only the list scrolls

Above the breakpoint the page itself does not move. The rail is its own column, the search box
and the filters stay put, and the list scrolls inside them — so the controls that produced what
you are looking at are still there when you are a hundred rows into it.

Below the breakpoint the page scrolls as one. A fixed head on a phone spends a third of the
screen on controls, and what is left is not a list.

The head sits in a full-width block with the column centred inside it, rather than the column
itself scrolling, so the scrollbar is at the edge of the window where a scrollbar belongs.

**Returning to a list puts it back where it was**, which the browser does for a real navigation
and never for a `pushState` one. The offset is written into the history entry being left. What
is read for it depends on the width — above the breakpoint the list's own container scrolls and
`window.scrollY` is always zero, below it the reverse — so both are read and the one that is
not zero is the answer. There is only ever one of them scrolling.

## A card is clicked, not its title

The whole card opens the task. The title is still a real button, so the keyboard and a screen
reader have something to land on and announce, and its click reaches the card like any other.

It carries no hover of its own: underlining one line of a card that is entirely clickable says
the rest of it is not. Everything else in the card is a control in its own right — the mark,
the id, a link in the description — and each stops the click from reaching the card behind it.

A click that ends a text selection does not open anything, because that is somebody reading.
