# Interface

Decisions about the screen, and the arguments behind them. The components say what they do;
this says why they are shaped that way, and what was turned down.

## The description editor is a textarea over markdown

Markdown is the storage format. A rich-text surface would have to round-trip it — parse on the
way in, serialise on the way out — and every round trip is a chance to lose a construct nobody
tested. So it is a textarea, and what you type is what is stored.

**The preview opens; it does not swap.** It was a second tab, which is the shape anybody who has
left a code-review comment already knows — and it made the preview the same size and shape as
the box it replaced, which is the one thing a preview should not be. A description is read at
the width of a page, not in a ten-row well with an Attach button over it. So Preview is a
button, what it opens is a dialog with nothing in it but the words, and it is named after the
task rather than the field, because on a phone it is the whole screen and the editor behind it
is not there to say which task this is. It appears only once there is something to look at.

The editor then has one state instead of two: nothing to leave the wrong way round, and no way
to be typing into a box that is not there.

**It is set in the proportional face, not a monospace one.** A description is prose with some
marks in it rather than code. Monospace sets prose wide and heavy: the same words take more
room and read as a listing. The preview is proportional too, so one text reads the same way in
both.

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

## Focus lights the mouth of the well

A field is sunken, so it has no border to color and nothing outside it to ring. What it has is an
edge where the surface drops away, and focus draws a brand-colored line along that edge, inside.
It is the shape the field already has, saying it is the one being typed into.

The alternative was an outline, and the trouble is where it sits: outside there is a gap, and the
pair reads as a second frame around the field rather than as focus; flush or inset against a
border it doubles the edge. Neither problem exists at the mouth of a well, which is why the line
goes there.

It is not color alone — a well that was empty of any line now has one, which is a change in
structure as much as in hue.

**Everything raised takes a ring instead** — buttons, links, the tag pills. They stand in front of
the page rather than sinking into it, so there is no mouth to light and outside is where a ring
belongs. It is drawn on `:focus-visible` rather than `:focus`: a button reached by mouse does not
match that, so clicking one does not leave it ringed. A field matches either way, which is the
reason the rule stops at the controls that do not.

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
comes back is where it was left. It names every tag, not only the ones somebody has dragged:
writing a slug it does not know rewrites it as the order the cloud is already showing, with the
new slug on the end. That last part is what was wrong — only dragged tags had a place and the
rest sorted by name, so a tag invented today filed itself alphabetically into the middle of a
list somebody thought they had settled. A tag that has just been made is the newest thing on the
account, and last is where it goes.

A task's own chips come back in that same order, because the chips on a row and the pills above
it are the same tags: sorted two different ways they read as two different sets, and the eye goes
looking for the difference.

## A pill has three states, and the third is not one you can ask for

Lit, unlit, and half of each: the tag is carried by some of what the cloud stands for and not by
the rest. It only arises where a cloud stands for more than one task, which today is the bulk
bar's and tomorrow will be a filter saying a tag is shut out rather than merely unlit.

The half state is the brand mixed half and half into the ground the pill already had, not the
brand at half strength and not half the pill painted in it. A split under the words needs one
ink legible on both halves, and in dark there is none — the ground is near-black and the brand a
pale indigo. A blend has one ground and one answer: the page's own ink, which measures 8.6:1 on
the light blend and 5.1 on the dark, where brand-ink would be 2.0 and 3.0.

It reports itself as `aria-pressed="mixed"`, which also keeps it out of the pressed-in shadow a
fully lit pill wears.

## The current row in the rail is the whole row

The ground belongs to the row, not to the name inside it. On the name it stopped short of the
pencil, which then sat outside the thing it edits with a strip of rail between them — and the
group somebody is looking at read as a shape with a button beside it rather than as one row. The
pencil has no ground of its own, because a shade over a shade is a second rectangle inside the
one this was about.

## A control that waits for a pointer is a control a finger does not have

The pin on a row waited for hover, which on a phone never comes: the only way to pin was to open
the task. The mark for finishing one did the opposite — it was drawn on every row of the list,
which is a column of marks down the page.

So both follow one rule, read from opposite ends. Where there is a pointer, a row's controls
appear on the row being pointed at. Where there is no pointer, they are simply there. The same
`pointer-coarse` test the rail's pencil and the code blocks' copy button already used.

What is not a control follows it too: the nought a task of priority zero carries is a value
nobody needs a column of, and it appears on the same terms.

## A color means whatever the person who set it decided

A task can carry one, and nothing in taskio reads it: nothing sorts, filters or groups by it, and
there is no default. It is drawn four pixels wide down the left of the row, and the space is
there whether or not there is a color in it — a list where three rows are colored and
ninety-seven are not is a list whose text still lines up.

A bar the card crops, not a border along its edge. A border follows the radius, so it bows
inward at the corners and comes out as a leaf rather than a line; a bar behind `overflow-hidden`
is straight, and the corners simply take its ends off.

The swatches sit beside the priority field, which had the space, and the two are unrelated: one
orders the list and the other is a mark somebody made for themselves.

Groups wear one too, and the palette is the same control, empty choice included: a dashed
swatch that is "No color" on a task, which then wears nothing, and "Default color" on a group,
which then wears the brand. The brand is a color like any other beside it.

## The rail is projects, and the open one's groups

A project row is the whole project — the list with nothing lit, which is what All used to be,
so there is no All. Only the open project's groups are drawn, a step in from it: a group is a
view of one project's tags, and every project's groups at once is a rail about the other
projects. Opening a project lights none of the last one's tags, since they are not its tags.

The URL says `?project=` with the slug, and says nothing for the default project — the server's
own rule, so a link with no project means one place to whoever follows it.

A task's list is its own project's. Ids belong to the account, so a mention or a link can open a
task in another project, and when it does the list behind it moves there too — replaced rather
than pushed, because it is the same place drawn over the right list. A dialog over the wrong list
is a task somebody closes and then cannot find.

A slug is derived from the name while the project is being made, until somebody types into the
slug field. After that it changes only when it is changed: a rename keeps every link and every
agent's `?project=` working, and a new slug breaks them, which the field says. Deleting takes
every task in the project with it, so it asks for the name typed out rather than a yes. The
default project can be renamed and not deleted.

## A token is a row per project

With no rows a token reaches every project, and that is where a new one starts: it operates
across the account until it is given rows, and is then confined to the projects listed. Only the
tokens migrated from before projects start out with a row, for the default project, because that
is where everything they could reach was.

Each row is a project and that project's own tags. `+ Add project` asks which project first, and
the row then says its name rather than offering it as a field: changing which project a row is
about is taking it away and adding another, not moving a scope's tags onto a project they may not
exist in. `−` takes a row away, the last one included, and the button to add goes once every
project has a row.

Several pills on a row mean any of them — garden and reading is a token for both projects' work,
not only for the tasks that happen to carry both. A token minted before that needs every tag on
its row, and the row says so, with a switch to reach any instead. Changing a pill never widens a
token on the quiet; only the switch does.

A deleted project's row stays until the token's projects are next saved, saying the project was
deleted and that asking for it is refused.

## A task is moved with a field, not a gesture

The task form leads its row with the project — `[project] [priority] … [color]` — because it is
the widest thing a task is: everything after it, its tags included, is inside it. It looks like a
select and opens the projects as pills, one of which can be lit, the same way a tag or a project
is picked everywhere else. A press is the choice; one pill needs no Save after it.

A move is saved with the rest of the task and sent only when it changed, so a task saved where it
is never so much as asks to move. It takes its tags along: they are the new project's from then
on. The bulk bar moves a selection the same way, and choosing the project it is already in does
nothing.

## Groups and projects are dragged like tags

The rail's rows carry the same press-and-move gesture as the pills, one axis over: the carried
row dims, a bar shows the place it would land, and nothing moves until it is let go. The gesture
itself is in one place — the two would otherwise be two copies of pointer capture, a slop
threshold and a swallowed click. A group moves among its project's groups and a project among
the projects; neither can be dropped among the other.

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

A group may also carry a color, and what wears it is the tab: the favicon's letter takes it, and
so does the mark beside the name in the rail. Nothing else on the page changes. The color is for
telling one window from another at a glance, which is a job for a 16px tile rather than for
repainting every button — and it comes from a short list rather than a picker, because eight
obviously different colors do that job and sixteen million do not.

A group moves to another project with Move… in its dialog, chosen from the same pills. It takes
the tasks it shows — every one carrying all of its tags, finished and binned ones too — and their
tags join the new project's arrangement in the order the old one had them. What was typed into
the dialog is saved on the way, and a group that was on screen takes the list with it.

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

**A set pin is a capsule, like a set number.** It was a bare pin in the brand color, and beside
a filled capsule saying 1 it read as the lesser mark — so a task pinned at nought looked
outranked by one below it that was not pinned at all. The pin is what the list sorts by first,
so it wears at least the weight of the number.

**A wider gap falls where the run changes**, so the bands are something to see rather than
something to work out by reading the capsules down the column. The list asks the row what it
sorts under rather than working it out again, because two spellings of that would put a line in
the wrong place.

Both sit in the left column, under the id and under the date, where the row is already as wide
as an age and nothing else is using the room. The number comes first: an unpinned row still
spends the pin's width, so behind it the number would sit off the left edge the id sets. The pin appears on hover when it is not set — it
is a thing you do to a task in passing, and burying it in the editor would mean opening a task
to say it matters.

## A task says how long it has been sitting there

Under the id, in words rather than as a timestamp: "3 hours ago", "2 weeks ago", "11 months
ago". Nobody reads `2026-08-04 11:42` and thinks "six weeks" — they read the number and then do
the arithmetic, if they bother, and the point of the label is to be understood without doing
any. The exact time is in the tooltip, where it costs nothing.

It counts from the last thing that happened to the task rather than the last time anything was
written to it: `deleted_at` for one in the bin, `done_at` for one that is finished, `poked_at`
for one that is live. A finished list is a record of what was finished, and a task closed a
minute ago read "8 hours ago" because somebody had edited its description that morning — true,
and not what anybody reads the column for.

On a live task it used to be `updated_at`, so anything done to it reset the number — a tag taken
off a whole selection included, which said forty tasks had been looked at when nobody had looked
at any of them. So staleness has its own mark: a poke says the task still stands, and only a
poke moves `poked_at`. A task nobody has poked counts from when it was written.

The task dialog's title bar says the same age as the row, colored the same way — "3 days ago";
"finished 2 days ago"; "deleted …". From a week a todo reads "Stale for 2 weeks · poke?", and
that is where the poke is: a Poke button on its own did not say what it did, and the age it
resets is what tells somebody whether to press it. The bulk bar pokes a selection. Neither is
offered on finished tasks, whose age is when they were finished.

Two marks on the scale, and they are the whole feature. Under a week it is `faint`, which is the
row saying there is nothing to see. From a week it is `warn`, from a month `accent`. A finished
task stays grey however old it is, because red on a thing that is done says it needs attention,
which is the one thing it does not.

It is drawn smaller than anything else on the row, tucked under the id, with the gap below it
rather than around it: the date belongs to the id above, and the number and the pin below are
their own pair. At the size of the text beside it, a date on every row is a second column of
writing competing with the titles — this is a thing to notice, not a thing to read.

The column is a fixed 68px — the longest thing the vocabulary can say is "11 months ago", which
measures 63, and the id under it is 58. An id is a fixed number of characters and an age is
words, so without a width every row would set its own left margin and the titles would come out
ragged down the list.

## Deleting is a mark, not a removal

Delete used to remove the row. That is the one operation in the program with nothing behind it:
a mistyped id, a bulk selection off by one, a confirmation answered by reflex, and the task is
gone with its description, its tags and everything that mentioned it.

So it is a mark. A deleted task carries `done_at` as well as `deleted_at`, which is what makes
the rest of the program need no changes at all: it drops off the todo list, appears among the
finished where it can be put back, and the ninety-day sweep collects it on exactly the mechanics
that already collect a done task.

On the row it says `deleted` in accent where a live task says how long it has been sitting there
— the number is what a live task is judged by, and one in the bin is not waiting for anybody —
and the mark on the right reads Restore. There is no third verb for that: the same action that
takes a task out of the finished list takes it out of the bin, because a task on the list again
is not a deleted one by any reading.

It leaves everybody's backlink list while it is there. What points at a task is a list of work
rather than of history, and a link from the bin is a link to something its owner has said they
are finished with. It comes back if the task does.

## The finished list is one run

It is ordered by when things were finished and by nothing else, so it draws no bands. The wider
gap between runs is the todo list saying where the pin ends and the numbers begin — in a list
sorted by neither, a line drawn where the pin or the number changes is a line across nothing.

## A row's two marks are on opposite sides

Selection is on the left and finishing is on the right.

They were the same control for a while, and the trouble is that selection mode then had two
columns of boxes meaning different things — one of them "this task is done", the other "this
task is picked" — a foot apart and identical. Splitting them by side means the left column
appears only while selecting and the right one always does the same thing.

## A search that found nothing is usually a task

The empty state offers to write one, with what was searched for as its title and whatever pills
are lit already on it. Somebody types a task into the search box often enough that the shortest
way from there to a task is worth a button; the words are already typed.

The search is cleared when a task is actually written, not when the dialog opens. Somebody who
changes their mind and shuts it has their words back, and somebody who goes through with it is
not left filtering the list by the title of the one task they just made.

**Clearing takes away one thing.** The button beside it said "Clear the search and the tags" and
did exactly that, which threw away the part of the filter somebody had set deliberately along
with the part they had mistyped. It clears the search where there is one, and the tags only when
there is nothing else to clear.

## The bulk bar offers one status action and both pin actions

The list is filtered to one status, so every task in a selection has it, and a button for the
status they already have does nothing to any of them. The bar takes the filter and shows the
one that moves them.

**Pinning gets both buttons**, because no view fixes it the way a view fixes status. A todo
list holds pinned and unpinned tasks side by side, so a selection can span both and has to say
which way it is going — following the view there meant a selection could be pinned from the
todo list and never unpinned from it.

**Copy ids** puts the selection on the clipboard, comma separated, which is the point of a
selection somebody made by eye: eleven ids picked out of ninety rows is a filter nothing can
express, and reading them off the screen one at a time is how it gets done otherwise. It says
so for a moment afterwards, because a copy that reports nothing is a copy nobody trusts.

**Nothing is asked for in the bar itself.** Tags and priority both open a dialog. A prompt that
stood in the bar's own row was a field and two buttons at the field height, which is taller than
the bar-sized buttons it replaced — so opening one grew the bar and shuffled the list underneath
it. The bar is one height for as long as it is on screen.

Tagging needs the room for its own reasons: a cloud has no width it can be relied on to fit, and
an account with a dozen tags wrapped the bar to three rows that the list then had to reserve. It
is also the only thing here that composes a change rather than firing one, so it wants a Save, an
Escape, and the whole screen on a phone.

**A tag is saved, not applied as it is pressed.** A press is a note about what to do: pressed by
mistake, it is pressed back. A tag nobody pressed is named in neither list when Save runs, so
each task keeps its own answer — which is the only way a half-lit tag survives being looked at.
A tag that starts half-lit has three stops for that reason, all → none → half again; one that
everybody or nobody carries has the two it always had, since there is no arrangement to return
to.

**The row reads the other way round**: the actions, then the gap, then what the row is about —
the count and a cross to close it. Every control here is reached from the left, and the two
things that are not controls at all sit past them. The actions wrap among themselves and the rest
stays on the first line; on a phone it is a line of its own above them, the count at its start.

**The ones used least are behind More**: Select all, Priority, Move… and Delete…. Ten across, at
the smallest size the buttons come in, still wrapped to a second line on a window between a
tablet's and a laptop's with the rail open. Delete is among them because it asks first anyway, so
a menu in front of it costs one press, not a mistake.

A selection can span the todo and done views and a search into another project, so neither of
these loses what was picked elsewhere. Select all adds every row on screen, and reads Select none
once they are all in, which takes only those rows out. The count opens the selection as a list of
rows with nothing to press in them, each asked for by id, since most of it may not be on screen.

**It slides out the way it came in.** A bar that vanishes the frame after a press reads as the
screen having changed rather than as something having been put away — so the list holds the
selection until the bar reports its animation over, because a component cannot delay its own
unmount. The room kept for it closes over those same 180ms: the bar measures its full height all
the way out, since it is sliding rather than shrinking, so it reports nothing while leaving and
the list comes up to meet it.

**The room goes at the very end of what scrolls, and nowhere else.** It sat above the results
from elsewhere and the Load more button, which are content like any other — so a search made
with the bar up put rows below it that no amount of scrolling could reach.

## Light says what a thing is, not a border

A surface is the same color as whatever it sits on. It is in front because it catches light on
one side and casts on the other, and it is behind because the same light falls on the inside of
it. `raised` is a card, a button, a pill; `sunken` is a field, a trough, anything meant to be
filled; pressed is raised turned inside out, which is what a finger on a real button does.

`aloft` is the one thing that floats over the list rather than sitting in it, and what it casts
is fog rather than a shadow: no offset at all, an even darkening all the way round. A directional
cast was the obvious answer and the wrong one — the bar is stuck to the foot of the screen and
rows slide under its *top* edge, which is exactly the edge a shadow thrown down and to the right
leaves bare.

It has its own color at its own strength rather than a fraction of `cast`, and the color is warm
— black fog on a beige rail greys it, and taking the color out of a ground is the one thing
nothing here is allowed to do. Measured through a screenshot, `cast` at this radius moved the
ground by three levels out of 255, which is a shadow nobody can see; the fog moves it by ten in
light and eight in dark, on grounds of 229 and 38.

And no highlight at all, unlike raised. A highlight says where the light is coming from, and fog
has no direction to contradict — a white line along the top-left edge of a docked bar is a lit
edge on the one side rows slide under, drawn straight across the fog that is there to separate
them.

**The bar stands over the list, and the list leaves room for it.** The rows run to the foot of
the page and pass under the bar; the room is a spacer as tall as the bar at the end of what
scrolls, so the last of them can still be scrolled out from under it.

It was the other way round above the breakpoint: the bar sat in the flow below the scrolling
box, which took its height off the list. The rows then ended where the bar began — the list cut
short by it, with the bottom of the screen given to a bar rather than to the thing being read.
Over it at either width now, sticky below the breakpoint where the window is what scrolls and
absolute above it where the list has a box of its own.

The bar measures itself and says how tall it is, because it wraps to two rows on a phone and
back again on a turn; a number written down here would be the height it had the day somebody
looked. It asks for nothing while it is leaving, or the room would sit there as a band of empty
ground under the last row for as long as the animation lasted.

**It arrives from below**, in 180ms. A bar that is simply there the frame after a tap reads as
the screen having changed rather than as something having been brought in. On the way in only: a
transition cannot run on an element React has already unmounted, and keeping it mounted to slide
out means holding its space on the layout where it takes any.

**It docks rather than floats.** Flush with the bottom edge at either width, and square where it
meets it: a rounded corner sitting twelve pixels above the foot of the screen is a card somebody
left there, and a bar that runs into the edge is a thing attached to it.

The shadow is three layers a side rather than one. A single `box-shadow` is one blur with an even
falloff, and an even falloff is what makes a thing look like a sticker with a grey smudge behind
it — real penumbra is dense right under the edge and gives up quickly. The alphas are fractions
of one color per side, so a theme has two values to change rather than twelve. The throw is
short: a long one reads as furniture hovering over the page instead of a page with things pressed
into it.

**A sheen across every raised thing**, running against the light: a little paler along the bottom
and a breath of dark along the top. With the light rather than against it, the gradient and the
shadow say the same thing twice and the shape flattens instead. It is `background-image`, so the
color the element chose stays under it — and it is left off the brand wash, which would have the
color washed out of it by a pale gradient beneath.

**And the same sheen turned over on every sunken thing**, because the surface is: pale along the
top, dark along the floor. Both halves share one pair of stops, so there is one intensity to
change rather than two, and a card and a field then shade in opposite directions — which is the
difference you can see without hunting for an edge. Measured down the middle of the search field
it runs 239 at the top to 235 at the bottom in light and 49 to 37 in dark, against a card running
234 to 240 and 40 to 52 the other way.

**Warm grounds, cool things standing on them.** `page` is a warm grey and `surface`, the rail, is
a warm beige. `bg` — a card, a field, a pill, a dialog — is the cool near-white it has always
been. The cards then look white, which is what they are meant to look like, and the rail is
divided from the page by temperature as well as by a shade of lightness.

This is a departure from the rest of this section. Soft UI usually says a thing is the color of
whatever it sits on and only the light tells them apart, which is what two grounds a hair apart
was. Saying it twice — with light and with temperature — is the version that looks right, and
the light still does the work at the edges, where the shadows are.

A chip inside a card takes `fill`, because it cannot be the color of the thing it sits on, and
`fill` is cool like the card. A patch on a warm ground takes `shade` instead: black at six
percent in light, white at seven in dark. It has no color of its own, so it darkens the beige of
the rail and the grey of the page without either turning cool — which is what the current row in
the rail used to do, as the one place the two temperatures met.

**`faint` is the third tier, not an invisible one.** 3.5:1 on the page against muted's 4.5 and
fg's 10. It was 2.2, which is a shape rather than a sentence — and an id, a user agent and the
age on a row are all words somebody reads. Every small uppercase caption in the application was drawn in it, which made the
headings of the settings page the palest text on the page — so a section heading is `fg` and a
caption over a short list is `muted`, at 10.3 and 4.5 against the page. The rule the palette
follows: `fg` for what is being said, `muted` for what is said about it, `faint` for what is
there without being read.

**A lit thing wears the brand, plainly.** `wash` is the class, and it is a fill: the brand as its
own color, with `brand-ink` on top. It was a radial gradient of the brand for a while — pale in
the middle, gathering to a rim — on the argument that a block of full-strength color on
everything lit is a screen shouting. Having lived with both, the gradient is the one that lost:
weak enough to be a wash, it is a smudge; strong enough to be a color, it is a fill with extra
steps.

The honest number: white on the orange measures 3.22:1, against a 4.5 bar for text this size.
That is the trade, made knowingly — the brand is the one thing on a screen of greys that says
which application this is, and these are short labels on controls that are also shaped,
positioned and lit. Dark does not have the problem: near-black on the pale indigo is 6.32. The
class sets no `background-image`, so a raised thing keeps its sheen and the color shades with
every other surface, and a flat one — the priority capsule — stays flat, which is right for a
label that is not a control.

**One rounding.** 6px for a control or a field, including the segmented control and the segment
inside it; 8px for a card; 12px for a modal. A corner that depends on which pass restyled it is
the thing this is written down to stop.

## The mark is two rectangles, not a letter

The favicon is a brand-colored T on a pale tile, drawn as two rectangles rather than as
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

## Every dialog draws a way out

A dialog fills the screen on a phone, so there is no backdrop beside it to press, and there is no
Escape on a phone either. What was left was whatever the footer happened to offer — and the
editor's three buttons are Delete, Mark done and Save, none of which is "not this".

So the close is on the dialog rather than in each footer: one control, always drawn, next to the
title. It closes without saving, which is the whole point of it.

## A button that stops to ask ends in an ellipsis

The macOS rule. "…" says the press is not the whole of it: the command stops to ask something,
and nothing happens until it is answered. A choice to make — Tag…, Move…. A question before it
goes ahead — Revoke…, and Delete… where it confirms. A form it cannot run without — Change
password…. Sign out… has one only on the browser in use, because only that one asks.

A button that does its thing on the press has none, even when something opens. Delete in the task
dialog deletes. Preview shows the description and asks nothing, and a recovery link is made the
moment it is pressed.

Nor does one that opens a thing to be written, new or not — New task, Mint a token, Edit, Change
limits — for the reason New Message has none in Mail: the window is the thing, and writing in it
is not answering a question. Nor a label that names a thing rather than a command: Priority is
what is set, not an unfinished verb. Nor the button a dialog ends with, which is the answer.

The mark is worth something only while every button keeps it, so a new button is held to it in
review, and `Button` says so where buttons are written.

## Every button that does something to a task writes the fields first

Delete and Mark done save what is in the fields before they do anything else — only when the
fields say something new, and a save the server refuses stops the rest and says why.

A verdict is often the last thing written on a task, why it is done or why it is not worth doing,
and the next press is one of those two. Both used to leave the verdict in the fields. Delete then
threw the fields away with the task; Mark done refetched the task and seeded the fields over the
verdict, so it was gone before Save could have been pressed at all.

That second one is also why the fields are seeded only over a draft nobody has touched. The task
is fetched again whenever anything invalidates it — a status change, an edit arriving from
elsewhere — and seeding over what somebody has typed since is the dialog throwing it away.

The close is still the one way out that writes nothing.

## A dialog is the whole screen on a phone

A centred card on a phone spends its margins on the page behind it, which nobody is reading,
and leaves the editor a slot to type into. Below the breakpoint the dialog is the viewport:
no inset, no rounding, no border. Above it, the centred card it always was.

Either way the title and the footer stay put and the body scrolls between them, so what a dialog
asks for is never below the fold with nothing to press, and a long description never scrolls its
own name off the top. Both are ruled off from the body with the same line, from either end.

The head is a title bar and not a panel: 49px at every width, around a 28px close. It was 57 on
a phone and 65 above it, which on one short word is a band of nothing with a rule under it. The
editor takes the slack, which is the point of the screen being full — a description is the thing
you opened it to write.

**A preview has a floor under it.** A description of two lines in a box of two lines is a dialog
that has shrunk to fit, and the room is the point of opening it at all. Above the breakpoint
only: on a phone the dialog is the whole screen already, and a minimum there could only make it
scroll.

It carries `shrink-0` with that floor, and the two go together. A flex item's implicit
`min-height: auto` is what stops it shrinking below its own content, and stating a `min-height`
replaces it — so the prose shrank to fit the dialog, its text painted past the end of the
scrollable area, and the last paragraphs sat under the bottom edge with no way to scroll to
them.

**The cushion at the end of a scroll is a box, not padding.** Measured: the scrolling body's
`padding-bottom` reads 16px and contributes nothing at the end of the scroll, because a flex
scroll container drops it — so text stopped dead against the bottom edge. A child with a height
is in the flow and cannot be dropped.

**What the title is about goes on the title's line.** The task editor's id sat on a row of its
own under the heading, which cost a row and a gap off the top of every task: on a phone the
writing started 205px down a 780px screen, and 165 after. A dialog takes an `aside` for that —
an id, a state — and draws it beside the heading.

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

The box stands at the right of the row, in the slot the done mark occupies the rest of the time,
and both are the same size. Pressing Select then changes what is in that slot and moves nothing.
Beside the id it was a column appearing on the left, which shoved every row's contents sideways
at the moment somebody began picking — and the mark it now replaces had nothing to do while
picking anyway, since a row being ticked is not a row being finished.

## What a field means lives behind a question mark

A caption names the field and a `?` beside it opens a dialog saying what it is for. The
explanation used to be a line of small grey text under every field, which makes a form read as
twice as long as it is and says most of it to people who already knew. Behind a mark it is there
when it is wanted, takes no room when it is not, and has space to say the whole thing rather
than the half that fits on one line — priority now explains pins, negative numbers and the gaps
between bands, which was never going to fit under a 64px field.

The mark is drawn beside the caption and written after the control, because a `<label>` names
the first labelable thing inside it and a `<button>` is one: put the mark where it looks like it
belongs and the caption stops naming the field and starts naming the mark. A grid puts it back
in the first row. There is a test for exactly that, because it is invisible until somebody
tries to use the form without a mouse.

## The stepper is ours, because the platform has none

No browser on a phone draws the spinner on `input[type=number]` — iOS Safari included — so on the
device where a keyboard is most in the way, the only way to change a number was to type it.
`NumberField` puts a minus and a plus either side of the field, square and the height of the
field rather than the height of a spinner arrow, because the pointer that needed them is a
finger. The native spinner is turned off everywhere rather than left to appear beside ours on a
desktop.

It carries its own name. A `Field` wraps its child in a `<label>`, and a label attaches to the
first labelable thing inside it — which here is the decrease button, not the field — so a
stepper takes the caption form and the name comes down as a prop: the field is "Priority" and
the buttons either side are "Decrease Priority" and "Increase Priority".

## Getting back in is a link, not a question

Somebody who has forgotten their password cannot sign in, so every route here is
unauthenticated, and each one is shaped by that.

**The forgotten-password form says the same thing whatever was typed into it.** "If that address
is on an account here, a link is on its way." Telling somebody their address is unknown turns
the form into a way to ask the instance who has an account and what address they use, which is
exactly the list a stranger must not be able to build. The mail carries the correction instead:
it names the account, so a link arriving for a name you do not recognise is its own answer, and
nothing arriving is the other one.

**The form is only offered where mail can be sent.** The login page asks the instance, and where
no relay is configured it offers nothing — a form that says "check your inbox" on an instance
that cannot send is lying. On those, and on any instance at all, an administrator hands a link
over instead, from the admin page or from `taskio recover` on the host.

**A link says which kind of dead it is.** Set a password, sign in with the one you already set,
use the newer link, ask for another — four states somebody acts on differently, and one refusal
for all four leaves every one of them doing the same useless thing. The page also names the
account the link opens: whoever holds the token could take it, so the name gives up nothing, and
it is the one thing that makes the page checkable.

**Setting a password does not sign anybody in.** That is the difference from accepting an
invitation, where somebody has just chosen the password for an account that did not exist a
moment ago. Here the account existed, the link may have reached the wrong person, and typing the
new password at the login form once is the cheapest confirmation that the right one has it.

## The checkbox is ours

`appearance: none`, then the field's border weight and color, the brand when it is ticked, and
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
