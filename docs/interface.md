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

## Two control heights, and both shrink on a phone

A field is 44px and a control beside one matches it; the bar over the list is 36px, because
three 44px controls under a 44px field is four bars of the same weight stacked down the screen
and the segmented control is the only one of them that is a place rather than an action.

On a phone both come down — the field to 40px, the bar to 40 under a finger — and the bar's
controls lose their minimum width. Four controls on one line is worth more there than a square
Select: the row wrapped onto two at every width below 390px, which cost more vertical space than
the taller controls ever bought. The type size does not shrink with them, because that is what
makes iOS zoom.

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

## A search says what the filter is hiding

A filtered list that comes back empty, or nearly, leaves somebody unable to tell whether their
words are wrong or their filter is. The screen can answer that, so under the results it does:
the same term against the whole account, minus what is already above, in two groups — the ones
whose tags are not lit, and the ones that are finished. Neither group is drawn when it is empty.

Those rows open and do nothing else. A tick or a pin there would change a task the list above is
not showing, which is a change nobody can see the result of.

It is one request, not one per group, and it is not sent until the foot of the list comes into
view: somebody who found what they wanted in the first three rows never asks the question, and
the answer is a scan of the whole account.

The observer that watches the foot is built per search and not while the list is still coming.
An empty page has its foot at the top of the window, so one attached then reports the bottom as
reached before there is a list to reach the bottom of — which is how a lazy request ends up
firing immediately on every search, and lazy only in the comment above it.

## A pill takes three kinds of press

Tap toggles the tag. Hold it for half a second and the filter narrows to that tag alone — two
lit and a third wanted by itself is otherwise three presses. Move first and it is a drag, which
cancels the hold and rearranges the cloud.

Three intentions on one target, told apart by what the pointer does rather than by three
controls, and written as pointer events so a finger, a pen and a mouse all reach them. The pill
sets `touch-action: none`, because a phone otherwise reads the hold and the drag as the start of
a scroll and swallows both.

The click that follows a hold or a drag is dropped. A press is one intention, and a finger
lifting off should not also toggle the tag it has just narrowed to or moved.

**Nothing moves until the pill is let go.** A dragged pill is dimmed and a bar is drawn in the
gap where it would land — on the right of the pill under the finger when it is travelling right,
the left when travelling left, which is how both ends of the row stay reachable. The alternative,
rearranging under the finger, loses the pointer capture the moment the carried element is moved
in the DOM: the drag ends halfway through and nobody has let go of anything.

The arrangement belongs to the account and is stored per slug, so a tag that goes out of use and
comes back is where it was left. Tags nobody has dragged sort after the ones somebody has, so a
new tag arrives at the end rather than in the middle of an arrangement.

## Groups are dragged like tags, and All is not one of them

The rail's groups carry the same press-and-move gesture as the pills, one axis over: the carried
row dims, a bar shows the place it would land, and nothing moves until it is let go. The gesture
itself is in one place — the two would otherwise be two copies of pointer capture, a slop
threshold and a swallowed click.

All does not carry. It is the list with nothing lit rather than a stored group, so it has no
place in the arrangement and stays at the top of the rail.

A new group is written after the ones already there rather than at position zero, which is where
the first arranged group sits. Otherwise writing one puts it at the top of somebody's
arrangement, tied with the group they had put first.

## A group is a saved filter, and the tags are still the state

The rail lists groups rather than one List entry, and pressing one lights its tags. What it does
not do is put the screen into a mode: there is no group in the URL, only `?tags=`, and a group is
drawn as current when the lit tags are its tags — lit by pressing it, by pressing the pills one
at a time, or by opening somebody else's link.

**All** is not stored. It is the list with nothing lit, which is where everybody starts, so there
is no row to delete and no empty group to explain.

A group may name a tag no task carries, which is the one place in taskio where a tag is written
down before anything has it. That is deliberate: naming the group is often the moment somebody
decides the tag exists, and the tasks follow. The cloud on the list cannot do this, because
inventing a tag there narrows the list to nothing.

A group may also carry a colour, and what wears it is the tab: the favicon's letter takes it, and
so does the mark beside the name in the rail. Nothing else on the page changes. The colour is for
telling one window from another at a glance, which is a job for a 16px tile rather than for
repainting every button — and it comes from a short list rather than a picker, because eight
obviously different colours do that job and sixteen million do not.

Groups are session-only in the API. Not because a program could not use one, but because a
scoped token must not learn tag names its scope does not reach, and a group is a list of tag
names.

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

The pin decides the band and the number decides the order inside it, so a pinned run is itself
sorted rather than a heap that happens to float.

The number is drawn plainly only when it is not zero. A nought on every row is a column of
noughts that says nothing, so it waits until the row is pointed at — where it stands beside the
pin rather than leaving it there on its own.

**A wider gap falls where the run changes**, so the bands are something to see rather than
something to work out by reading the capsules down the column. The list asks the row what it
sorts under rather than working it out again, because two spellings of that would put a line in
the wrong place.

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

## The bulk bar offers one status action and both pin actions

The list is filtered to one status, so every task in a selection has it, and a button for the
status they already have does nothing to any of them. The bar takes the filter and shows the
one that moves them.

**Pinning gets both buttons**, because no view fixes it the way a view fixes status. A todo
list holds pinned and unpinned tasks side by side, so a selection can span both and has to say
which way it is going — following the view there meant a selection could be pinned from the
todo list and never unpinned from it.

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

## A pin leads in a ranked list too

Search ranks by relevance, and ranking by that alone put a pinned task below an unpinned one
the moment somebody typed in the box — which reads as the pin having stopped working rather
than as the list having changed its question. Pinned first, then the score.

## The tab is named after the filter

`web and job :: taskio`, or just `taskio` with nothing lit.

A tab is worth naming when it is one of several, and what makes one of these different from
another is which tags are lit — the view and the search box are things somebody is doing right
now rather than a place they have parked. "and" between them because that is what the filter
means, and what the pills spell into the URL: tasks carrying every one of them, not any.

It is set where the location is kept, not by whoever renders the list. A tab kept in step by
the call sites that remember to is a tab that falls behind one of them.

## A section waits as a shape, not as its own words with gaps in

"Signed in as" followed by nothing is a sentence that says something untrue for as long as it
is on screen. A section with an answer outstanding draws grey rectangles the size of what is
coming instead — so nothing is half-written, and nothing below jumps when the answer lands and
the shape is replaced by the same-sized thing.

The heading stays through all of it. It is the one part that never depended on an answer, and
keeping it means the page has its outline from the first paint.

The grey moves, because a still rectangle reads as broken where a travelling one reads as
waiting. It is the two greys everything else is drawn from, so it does not announce itself as a
third thing, and it stops moving where somebody has asked for less motion.

## One broken section does not take the page

Each section is wrapped, so a render that throws shows a line and a way to try again rather
than blanking the island. It latches: new props alone do not clear it, because a boundary that
retries on every render of a component that throws during render is a loop. Somebody says when.

Trying again is worth offering because most of what breaks a render here is data that was not
what it claimed, and the next answer may be.

## A pin and a tick are drawn before the server agrees

Both are one bit, and a button that waits a round trip to show it is a button somebody presses
twice. The row is changed in every cached list at once, the request goes out behind it, and a
refusal puts the old pages back.

The list on screen is put in its new order at the same moment, so the row travels on the press
rather than on the answer. That is reproducible here without guessing: a page arrives in the
server's order, and a stable sort by pinned, priority and the clock leaves rows equal on all
three where it found them — which is the internal sequence the server breaks ties with.

The answer still arrives and still renders, because the server moves `updated_at`. But it
arrives in the order already on screen, so that render moves nothing: one press, one
rearrangement.

**The view follows the row and the row says so.** A pinned task can travel a long way, and a
scroll position that stays put while the rows shift under it leaves somebody looking at a
different task than the one they were reading. The view goes to where it landed, and it flashes
once on arrival, because a row that has moved looks like every other row when it gets there.

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

A shut dialog is `display: none` and says so itself. `flex` would otherwise win the argument
against the browser's own `dialog:not([open])` rule, and every shut dialog on a page lays
itself out as a 3px sliver of border across whatever is behind it.

**Nothing is lit on opening unless it asked to be.** `showModal()` focuses the first control it
finds whether or not that control wanted focus, and in the task editor that is Delete — a ring
on a destructive action reads as armed. A field asks with `data-autofocus`; where none does,
the dialog holds focus instead.

`data-autofocus` rather than React's `autoFocus`, which is a call rather than an attribute and
runs while the dialog is still hidden — where focusing anything is a no-op.

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

## Picking and opening are two halves of a mode

While a selection is being made the card picks; otherwise it opens. Opening a task from a row
somebody is ticking is the wrong half, and the box is a small target to have to hit. The box
itself stops the click reaching the card, or the row counts the tick twice and toggles back to
where it started.

## The checkbox is ours

`appearance: none`, then the field's border weight and colour, the brand when it is ticked, and
a tick drawn with a clip path rather than typed — a glyph would be whatever font happened to
load. Where `corner-shape: squircle` is understood it rounds further; everywhere else the
radius stands on its own.

## A card is clicked, not its title

The whole card opens the task. The title is still a real button, so the keyboard and a screen
reader have something to land on and announce, and its click reaches the card like any other.

It carries no hover of its own: underlining one line of a card that is entirely clickable says
the rest of it is not. Everything else in the card is a control in its own right — the mark,
the id, a link in the description — and each stops the click from reaching the card behind it.

A click that ends a text selection does not open anything, because that is somebody reading.
