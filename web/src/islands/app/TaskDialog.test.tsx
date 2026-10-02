import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@app/api/transport";
import type { TaskDetail } from "@app/api/types";
import { TaskDialog } from "@app/islands/app/TaskDialog";
import { mount, settle } from "@app/test/harness";

const done = vi.fn();
const todo = vi.fn();
const patch = vi.fn();
const remove = vi.fn();
const comment = vi.fn();
const edit = vi.fn();
/** The order things reached the server in, which is the point of several of these. */
let calls: string[] = [];
let task: TaskDetail;
/** Tasks other than the one open, by id: what a mention opens. */
let others: Record<string, TaskDetail> = {};

vi.mock("@app/api/actions/tasks", () => ({
  getTasksById: (id: string) =>
    Promise.resolve(id === task.id ? task : others[id]),
  patchTasksById: (id: string, body: unknown) => {
    calls.push("patch");
    return patch(id, body);
  },
  postTasksByIdDone: (id: string) => {
    calls.push("done");
    return done(id);
  },
  postTasksByIdTodo: (id: string) => todo(id),
  postTasksByIdPoke: (id: string) => {
    calls.push("poke");
    return Promise.resolve(id);
  },
  postTasksByIdComments: (id: string, body: string) => {
    calls.push("comment");
    return comment(id, body);
  },
  patchTasksByIdCommentsById: (id: string, which: string, body: string) => {
    calls.push("edit");
    return edit(id, which, body);
  },
  deleteTasksById: (id: string) => {
    calls.push("delete");
    return remove(id);
  },
}));
vi.mock("@app/api/actions/tags", () => ({
  getTags: () => Promise.resolve({ tags: [] }),
}));
vi.mock("@app/api/actions/projects", () => ({
  getProjects: () =>
    Promise.resolve({
      projects: [
        {
          id: "pj_1",
          name: "Main",
          slug: "main",
          default: true,
          created_at: 1,
        },
        {
          id: "pj_2",
          name: "Garden",
          slug: "garden",
          default: false,
          created_at: 2,
        },
      ],
    }),
}));

const detail = (status: "todo" | "done"): TaskDetail =>
  ({
    id: "8qw4tz9k",
    project: "main",
    title: "Fix the tap",
    description: "",
    tags: [],
    priority: 0,
    pinned: false,
    color: "",
    status,
    created_at: 1789343452,
    updated_at: 1789343452,
    poked_at: 1789343452,
    done_at: status === "done" ? 1789343452 : null,
    deleted_at: null,
    mentions: [],
    mentioned_by: [],
    comments: [],
  }) as TaskDetail;

beforeEach(() => {
  // Finished on the server, and handed back as a new object the way a refetch does.
  done.mockReset().mockImplementation(() => {
    task = { ...task, status: "done", done_at: 1789343500 };
    return Promise.resolve();
  });
  todo.mockReset().mockResolvedValue(undefined);
  patch.mockReset().mockResolvedValue(undefined);
  remove.mockReset().mockResolvedValue(undefined);
  comment.mockReset().mockResolvedValue(undefined);
  // Edited on the server, so the refetch after it has the new words.
  edit
    .mockReset()
    .mockImplementation((_id: string, which: string, body: string) => {
      task = {
        ...task,
        comments: task.comments.map((c) =>
          c.id === which ? { ...c, body, edited_at: 1789343500 } : c,
        ),
      };
      return Promise.resolve();
    });
  calls = [];
  task = detail("todo");
  others = {};
});

const description = () =>
  screen.getByPlaceholderText(/Markdown\. Paste a file/) as HTMLTextAreaElement;

/** Opened, loaded, and a verdict typed into the description. */
async function withVerdict(onClose = vi.fn()) {
  mount(
    <TaskDialog
      initialMode="edit"
      id="8qw4tz9k"
      project=""
      onClose={onClose}
    />,
  );
  // The field, not the button: the footer is drawn while the task is still on its way.
  await screen.findByPlaceholderText(/Markdown\. Paste a file/);
  await settle();
  fireEvent.change(description(), {
    target: { value: "Verdict: not worth it" },
  });
}

/**
 * The button used to read "Finish", in the place a dialog's dismiss button lives, and it was
 * read as finishing the editing.
 */
describe("the task dialog's status button", () => {
  it("says what it does, and does it", async () => {
    mount(
      <TaskDialog
        initialMode="edit"
        id="8qw4tz9k"
        project=""
        onClose={vi.fn()}
      />,
    );
    const button = await screen.findByRole("button", { name: "Mark done" });
    fireEvent.click(button);
    await waitFor(() => expect(done).toHaveBeenCalledWith("8qw4tz9k"));
    expect(todo).not.toHaveBeenCalled();
  });

  it("says the other thing on a task that is already done", async () => {
    task = detail("done");
    mount(
      <TaskDialog
        initialMode="edit"
        id="8qw4tz9k"
        project=""
        onClose={vi.fn()}
      />,
    );
    const button = await screen.findByRole("button", { name: "Mark as todo" });
    fireEvent.click(button);
    await waitFor(() => expect(todo).toHaveBeenCalledWith("8qw4tz9k"));
  });

  /** It changes the status and nothing else: nothing typed, nothing written. Then it closes,
   *  as Delete does: the status is what somebody opened the task to change. */
  it("writes nothing it was not given, and closes the dialog", async () => {
    const onClose = vi.fn();
    mount(
      <TaskDialog
        initialMode="edit"
        id="8qw4tz9k"
        project=""
        onClose={onClose}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Mark done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(done).toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("closes after marking a done task todo again", async () => {
    task = detail("done");
    const onClose = vi.fn();
    mount(
      <TaskDialog
        initialMode="edit"
        id="8qw4tz9k"
        project=""
        onClose={onClose}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark as todo" }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(todo).toHaveBeenCalledWith("8qw4tz9k");
  });
});

/**
 * A verdict is often the last thing written on a task, and the next press is Mark done or
 * Delete. Both used to leave it in the fields — and Mark done then refetched the task and
 * seeded the fields over it, so it was gone before Save could have been pressed at all.
 */
describe("a verdict written and then acted on", () => {
  it("is saved before the task is marked done, and never seeded over", async () => {
    await withVerdict();
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));

    await screen.findByRole("button", { name: "Mark as todo" });
    expect(calls).toEqual(["patch", "done"]);
    expect(patch.mock.calls[0]![1]).toMatchObject({
      description: "Verdict: not worth it",
    });
    expect(description().value).toBe("Verdict: not worth it");
  });

  it("is saved before the task is deleted", async () => {
    const onClose = vi.fn();
    await withVerdict(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls).toEqual(["patch", "delete"]);
    expect(patch.mock.calls[0]![1]).toMatchObject({
      description: "Verdict: not worth it",
    });
  });

  it("is not written again when nothing was typed", async () => {
    mount(
      <TaskDialog
        initialMode="edit"
        id="8qw4tz9k"
        project=""
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(remove).toHaveBeenCalled());
    expect(calls).toEqual(["delete"]);
  });

  /** Refused, it stops there and says why, rather than losing the words a second way. */
  it("stops the delete when the save is refused", async () => {
    patch.mockRejectedValue(
      new ApiError(400, "invalid", "A task needs a title."),
    );
    await withVerdict();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await screen.findByText("A task needs a title.");
    expect(remove).not.toHaveBeenCalled();
  });
});

/** A task is opened to be read; Edit turns it into the fields. Only a new one opens written. */
describe("opening a task", () => {
  it("shows it as it reads, with Edit to write", async () => {
    task = { ...detail("todo"), description: "It **drips**." };
    mount(<TaskDialog id="8qw4tz9k" project="" onClose={vi.fn()} />);
    await waitFor(() => expect(prose()).toBe("It drips."));
    expect(screen.queryByPlaceholderText(/Markdown\. Paste a file/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      await screen.findByPlaceholderText(/Markdown\. Paste a file/),
    ).toBeDefined();
  });
});

describe("the read view", () => {
  it("shows the priority and tags the fields hold, and the color by the name", async () => {
    task = {
      ...detail("todo"),
      description: "It drips.",
      priority: 2,
      color: "#16a34a",
      tags: ["home", "repair"],
    };
    mount(<TaskDialog id="8qw4tz9k" project="" onClose={vi.fn()} />);
    const priority = await screen.findByRole("group", { name: "Priority" });
    expect(priority.textContent).toBe("2");
    // Beside the name, not a field of its own, and not part of what the heading is called.
    const heading = screen.getByRole("heading", { name: "Fix the tap" });
    expect(heading.querySelector('[title="Color #16a34a"]')).not.toBeNull();
    expect(screen.queryByRole("group", { name: "Color" })).toBeNull();
    const tags = screen.getByRole("list", { name: "Tags" });
    expect(
      [...tags.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual(["home", "repair"]);
  });

  it("leaves out what is not set", async () => {
    task = { ...detail("todo"), description: "It drips." };
    mount(<TaskDialog id="8qw4tz9k" project="" onClose={vi.fn()} />);
    await waitFor(() => expect(prose()).toBe("It drips."));
    expect(screen.queryByRole("group", { name: "Priority" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Color" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Tags" })).toBeNull();
  });
});

/** Cmd+Enter in the description is Save, as it is Comment in a comment's box. */
describe("Cmd+Enter", () => {
  it("saves and closes from the description", async () => {
    const onClose = vi.fn();
    await withVerdict(onClose);
    fireEvent.keyDown(description(), { key: "Enter" });
    expect(patch).not.toHaveBeenCalled();
    fireEvent.keyDown(description(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patch.mock.calls[0]![1]).toMatchObject({
      description: "Verdict: not worth it",
    });
  });
});

/** A move is a field like any other, saved with the rest — and only sent when it changed. */
describe("moving a task", () => {
  it("sends the project it was moved to", async () => {
    const onClose = vi.fn();
    mount(
      <TaskDialog
        initialMode="edit"
        id="8qw4tz9k"
        project=""
        onClose={onClose}
      />,
    );
    await screen.findByPlaceholderText(/Markdown\. Paste a file/);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Main" }));
    fireEvent.click(await screen.findByRole("button", { name: "Garden" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patch.mock.calls[0]![1]).toMatchObject({ project: "garden" });
  });

  it("says what a move does, where the move is chosen", async () => {
    mount(
      <TaskDialog
        initialMode="edit"
        id="8qw4tz9k"
        project=""
        onClose={vi.fn()}
      />,
    );
    await screen.findByPlaceholderText(/Markdown\. Paste a file/);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Main" }));
    expect(await screen.findByText(/takes its tags along/)).toBeDefined();
  });

  it("does not so much as ask to move a task saved where it is", async () => {
    await withVerdict();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![1]).not.toHaveProperty("project");
  });
});

/**
 * A task opened from a mention or a link can be in another project, and the list behind it is
 * its own project's rather than whatever was on screen.
 */
describe("a task from another project", () => {
  it("asks for the list to be that project's", async () => {
    task = { ...detail("todo"), project: "garden" };
    const onElsewhere = vi.fn();
    mount(
      <TaskDialog
        id="8qw4tz9k"
        project=""
        onClose={vi.fn()}
        onElsewhere={onElsewhere}
      />,
    );
    await waitFor(() =>
      expect(onElsewhere).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "garden" }),
      ),
    );
  });

  it("asks nothing of one already where it is", async () => {
    const onElsewhere = vi.fn();
    mount(
      <TaskDialog
        initialMode="edit"
        id="8qw4tz9k"
        project=""
        onClose={vi.fn()}
        onElsewhere={onElsewhere}
      />,
    );
    await screen.findByPlaceholderText(/Markdown\. Paste a file/);
    await settle();
    expect(onElsewhere).not.toHaveBeenCalled();
  });
});

describe("pinning from the dialog", () => {
  it("pins, saving what was typed first, and stays open", async () => {
    const onClose = vi.fn();
    await withVerdict(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));

    await waitFor(() => expect(calls).toEqual(["patch", "patch"]));
    expect(patch.mock.calls[0]![1]).toMatchObject({
      description: "Verdict: not worth it",
    });
    expect(patch.mock.calls[1]![1]).toEqual({ pinned: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("unpins a pinned task", async () => {
    task = { ...detail("todo"), pinned: true };
    mount(
      <TaskDialog
        initialMode="edit"
        id="8qw4tz9k"
        project=""
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Unpin" }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("8qw4tz9k", { pinned: false }),
    );
  });
});

describe("poking from the dialog", () => {
  it("saves what was typed, pokes, and stays open", async () => {
    task = {
      ...detail("todo"),
      poked_at: Math.floor(Date.now() / 1000) - 15 * 86400,
    };
    const onClose = vi.fn();
    await withVerdict(onClose);
    fireEvent.click(screen.getByRole("button", { name: "poke?" }));
    await waitFor(() => expect(calls).toEqual(["patch", "poke"]));
    expect(onClose).not.toHaveBeenCalled();
  });

  /** A finished task's age is when it was finished, and a poke would move nothing read. */
  it("is not offered on a finished task", async () => {
    task = detail("done");
    mount(
      <TaskDialog
        initialMode="edit"
        id="8qw4tz9k"
        project=""
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("button", { name: "Mark as todo" });
    expect(screen.queryByRole("button", { name: "poke?" })).toBeNull();
  });
});

/** The age the poke resets, said beside it, since the word alone did not say what it does. */
describe("how stale the task is", () => {
  it("says how long it has sat unpoked, from a week", async () => {
    task = {
      ...detail("todo"),
      poked_at: Math.floor(Date.now() / 1000) - 15 * 86400,
    };
    mount(
      <TaskDialog
        initialMode="edit"
        id="8qw4tz9k"
        project=""
        onClose={vi.fn()}
      />,
    );
    const line = await screen.findByText(/Stale for 2 weeks/);
    expect(line.className).toContain("text-warn");
  });

  it("says only how long ago, and offers no poke, before that", async () => {
    task = {
      ...detail("todo"),
      poked_at: Math.floor(Date.now() / 1000) - 3 * 86400,
    };
    mount(
      <TaskDialog
        initialMode="edit"
        id="8qw4tz9k"
        project=""
        onClose={vi.fn()}
      />,
    );
    expect((await screen.findByText("3 days ago")).className).toContain(
      "text-faint",
    );
    expect(screen.queryByRole("button", { name: "poke?" })).toBeNull();
  });

  it("says when a finished task was finished, grey however old", async () => {
    task = {
      ...detail("done"),
      done_at: Math.floor(Date.now() / 1000) - 60 * 86400,
    };
    mount(
      <TaskDialog
        initialMode="edit"
        id="8qw4tz9k"
        project=""
        onClose={vi.fn()}
      />,
    );
    expect(
      (await screen.findByText("finished 2 months ago")).className,
    ).toContain("text-faint");
  });
});

/** The task open, read or written, with nothing else to say about how. */
const open = () =>
  mount(
    <TaskDialog
      initialMode="edit"
      id="8qw4tz9k"
      project=""
      onClose={vi.fn()}
    />,
  );
/** The rendered words, not the textarea holding the same ones. */
const prose = () => document.querySelector(".prose")?.textContent?.trim();

/**
 * One dialog with two faces, switched from the title bar: the fields, and the task as it reads.
 * A preview used to be a second dialog over the first.
 */
describe("reading the task", () => {
  it("switches to reading and back, keeping what was typed", async () => {
    await withVerdict();
    fireEvent.click(screen.getByRole("button", { name: "View" }));

    // Read, it is named after the task, and the fields are gone.
    expect(screen.getByRole("heading", { name: "Fix the tap" })).toBeDefined();
    expect(prose()).toBe("Verdict: not worth it");
    expect(screen.queryByPlaceholderText(/Markdown\. Paste a file/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(description().value).toBe("Verdict: not worth it");
  });

  it("offers no preview of nothing", async () => {
    open();
    await screen.findByPlaceholderText(/Markdown\. Paste a file/);
    expect(screen.queryByRole("button", { name: "View" })).toBeNull();
  });

  /** An edit from elsewhere should not swap a page of prose mid-sentence. */
  it("holds the words steady, and offers the newer text as a button", async () => {
    task = { ...detail("todo"), description: "first words" };
    const { client } = open();
    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    expect(prose()).toBe("first words");

    task = { ...task, description: "second words" };
    await client.invalidateQueries();
    await screen.findByRole("button", { name: "Update" });
    expect(prose()).toBe("first words");

    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(prose()).toBe("second words");
  });

  it("writes a tick into what Save sends", async () => {
    task = { ...detail("todo"), description: "- [ ] one" };
    open();
    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    fireEvent.click(document.querySelector("li[data-check]")!);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(patch.mock.calls[0]![1]).toMatchObject({
        description: "- [x] one",
      }),
    );
  });
});

/** Following a reference is reading, and the task underneath is where somebody was. */
describe("a mention", () => {
  const washers = {
    ...detail("todo"),
    id: "kr20fj8m",
    title: "Buy washers",
    description: "The small ones.",
  } as TaskDetail;

  beforeEach(() => {
    others = { kr20fj8m: washers };
  });

  it("opens the task it names over this one, read first", async () => {
    task = {
      ...detail("todo"),
      mentions: [{ id: "kr20fj8m", title: "Buy washers", status: "todo" }],
    } as TaskDetail;
    const onClose = vi.fn();
    mount(
      <TaskDialog
        initialMode="edit"
        id="8qw4tz9k"
        project=""
        onClose={onClose}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Buy washers/ }));

    expect(
      await screen.findByRole("heading", { name: "Buy washers" }),
    ).toBeDefined();
    expect(await screen.findByText("The small ones.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDefined();

    // Its close comes back here, and this one is still open, still being written.
    const closes = screen.getAllByRole("button", { name: "Close" });
    fireEvent.click(closes[closes.length - 1]!);
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Buy washers" })).toBeNull(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(description()).toBeDefined();
  });

  it("opens the same way from a chip in the description", async () => {
    task = { ...detail("todo"), description: "See @kr20fj8m first." };
    mount(
      <TaskDialog
        initialMode="edit"
        id="8qw4tz9k"
        project=""
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    fireEvent.click(document.querySelector("a.mention")!);
    expect(
      await screen.findByRole("heading", { name: "Buy washers" }),
    ).toBeDefined();
  });
});

const stub = (id: string, title: string) =>
  ({ id, title, project: "main", status: "todo" }) as const;
/** The text of the section under one heading. */
const section = (heading: string) =>
  screen.getByRole("heading", { name: heading }).parentElement!.textContent;

/** A task linked both ways was the same row under two headings. */
describe("the linked tasks", () => {
  it("lists a task linked both ways once, apart from the one-way ones", async () => {
    task = {
      ...detail("todo"),
      mentions: [stub("kr20fj8m", "Buy washers"), stub("m3v9x2pq", "Out only")],
      mentioned_by: [
        stub("kr20fj8m", "Buy washers"),
        stub("t8nv2xy7", "In only"),
      ],
    } as TaskDetail;
    open();
    await screen.findByRole("heading", { name: "Mentioned both ways" });

    expect(section("Mentioned both ways")).toContain("Buy washers");
    expect(section("Mentions")).toContain("Out only");
    expect(section("Mentions")).not.toContain("Buy washers");
    expect(section("Mentioned by")).toContain("In only");
    expect(section("Mentioned by")).not.toContain("Buy washers");
    expect(screen.getAllByRole("button", { name: /Buy washers/ })).toHaveLength(
      1,
    );
  });

  it("draws no heading for a list with nothing in it", async () => {
    task = {
      ...detail("todo"),
      mentions: [stub("kr20fj8m", "Buy washers")],
      mentioned_by: [stub("kr20fj8m", "Buy washers")],
    } as TaskDetail;
    open();
    await screen.findByRole("heading", { name: "Mentioned both ways" });
    expect(screen.queryByRole("heading", { name: "Mentions" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Mentioned by" })).toBeNull();
  });
});

/** A timeline under the description, and a comment carried by Mark done and Delete. */
const box = () =>
  screen.getByPlaceholderText(/^Comment\./) as HTMLTextAreaElement;

describe("comments", () => {
  it("lists them oldest first, saying who wrote each", async () => {
    task = {
      ...detail("todo"),
      comments: [
        {
          id: "c_1",
          n: 1,
          ref: "8qw4tz9k#1",
          body: "Ordered **washers**.",
          author: "robin",
          token: "",
          created_at: 1,
          edited_at: null,
        },
        {
          id: "c_2",
          n: 2,
          ref: "8qw4tz9k#2",
          body: "Fitted them.",
          author: "robin",
          token: "claude",
          created_at: 2,
          edited_at: 3,
        },
      ],
    };
    open();
    const heading = await screen.findByRole("heading", { name: "Comments" });
    const items = heading.parentElement!.querySelectorAll("li");
    expect(items[0]!.textContent).toMatch(/^#1robin ·/);
    expect(items[0]!.querySelector("strong")?.textContent).toBe("washers");
    expect(items[1]!.textContent).toMatch(/^#2claude • robin ·/);
    expect(items[0]!.textContent).not.toMatch(/edited/);
    expect(items[1]!.textContent).toMatch(/· edited/);
  });

  it("links a comment's number to it, copying its id and naming it in the address", async () => {
    const copied = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: copied },
      configurable: true,
    });
    Element.prototype.scrollIntoView = vi.fn();
    task = {
      ...detail("todo"),
      comments: [
        {
          id: "c_1",
          n: 1,
          ref: "8qw4tz9k#1",
          body: "Ordered washers.",
          author: "robin",
          token: "",
          created_at: 1,
          edited_at: null,
        },
      ],
    };
    const onComment = vi.fn();
    mount(
      <TaskDialog
        id="8qw4tz9k"
        project=""
        onComment={onComment}
        onClose={vi.fn()}
      />,
    );
    const link = await screen.findByRole("link", { name: "#1" });
    expect(link.getAttribute("href")).toBe("/t/8qw4tz9k#c1");
    fireEvent.click(link);
    await waitFor(() => expect(copied).toHaveBeenCalledWith("8qw4tz9k#1"));
    expect(onComment).toHaveBeenCalledWith(1);
    expect(link.closest("li")!.className).toContain("bg-shade");
  });

  it("opens onto the comment it was asked for, and marks it", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    task = {
      ...detail("todo"),
      comments: [1, 2].map((n) => ({
        id: `c_${n}`,
        n,
        ref: `8qw4tz9k#${n}`,
        body: `Comment ${n}.`,
        author: "robin",
        token: "",
        created_at: n,
        edited_at: null,
      })),
    };
    mount(
      <TaskDialog id="8qw4tz9k" project="" toComment={2} onClose={vi.fn()} />,
    );
    await screen.findByRole("heading", { name: "Comments" });
    const second = document.querySelector('[data-comment="2"]')!;
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
    expect(scrolled.mock.contexts[0]).toBe(second);
    expect(second.className).toContain("bg-shade");
  });

  it("edits one in place, and shows the new words once saved", async () => {
    task = {
      ...detail("todo"),
      comments: [
        {
          id: "c_1",
          n: 1,
          ref: "8qw4tz9k#1",
          body: "Ordred washers.",
          author: "robin",
          token: "",
          created_at: 1,
          edited_at: null,
        },
      ],
    };
    open();
    const heading = await screen.findByRole("heading", { name: "Comments" });
    const item = () => heading.parentElement!.querySelector("li")!;
    fireEvent.click(
      within(item()).getByRole("button", { name: "Edit comment" }),
    );

    const save = within(item()).getByRole("button", { name: "Save" });
    // Nothing changed is nothing to save.
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.change(within(item()).getByRole("textbox"), {
      target: { value: "Ordered washers." },
    });
    fireEvent.click(save);

    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith("8qw4tz9k", "c_1", "Ordered washers."),
    );
    await waitFor(() =>
      expect(within(item()).queryByRole("textbox")).toBeNull(),
    );
    expect(item().textContent).toMatch(/Ordered washers\./);
    expect(item().textContent).toMatch(/· edited/);
  });

  it("saves an edit on Cmd+Enter", async () => {
    task = {
      ...detail("todo"),
      comments: [
        {
          id: "c_1",
          n: 1,
          ref: "8qw4tz9k#1",
          body: "Ordred washers.",
          author: "robin",
          token: "",
          created_at: 1,
          edited_at: null,
        },
      ],
    };
    open();
    const heading = await screen.findByRole("heading", { name: "Comments" });
    const item = () => heading.parentElement!.querySelector("li")!;
    fireEvent.click(
      within(item()).getByRole("button", { name: "Edit comment" }),
    );
    const field = within(item()).getByRole("textbox");
    fireEvent.change(field, { target: { value: "Ordered washers." } });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith("8qw4tz9k", "c_1", "Ordered washers."),
    );
  });

  it("drops an edit on Escape, and keeps the dialog open", async () => {
    task = {
      ...detail("todo"),
      comments: [
        {
          id: "c_1",
          n: 1,
          ref: "8qw4tz9k#1",
          body: "Ordered washers.",
          author: "robin",
          token: "",
          created_at: 1,
          edited_at: null,
        },
      ],
    };
    const onClose = vi.fn();
    mount(
      <TaskDialog
        initialMode="edit"
        id="8qw4tz9k"
        project=""
        onClose={onClose}
      />,
    );
    const heading = await screen.findByRole("heading", { name: "Comments" });
    const item = () => heading.parentElement!.querySelector("li")!;
    fireEvent.click(
      within(item()).getByRole("button", { name: "Edit comment" }),
    );
    const field = within(item()).getByRole("textbox");
    fireEvent.change(field, { target: { value: "Something else." } });

    // Not the dialog's to close: the keydown is cancelled before it becomes a close request.
    expect(fireEvent.keyDown(field, { key: "Escape" })).toBe(false);
    expect(within(item()).queryByRole("textbox")).toBeNull();
    expect(item().textContent).toMatch(/Ordered washers\./);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancels an edit, leaving the words as they were", async () => {
    task = {
      ...detail("todo"),
      comments: [
        {
          id: "c_1",
          n: 1,
          ref: "8qw4tz9k#1",
          body: "Ordered washers.",
          author: "robin",
          token: "",
          created_at: 1,
          edited_at: null,
        },
      ],
    };
    open();
    const heading = await screen.findByRole("heading", { name: "Comments" });
    const item = () => heading.parentElement!.querySelector("li")!;
    fireEvent.click(
      within(item()).getByRole("button", { name: "Edit comment" }),
    );
    fireEvent.change(within(item()).getByRole("textbox"), {
      target: { value: "Something else." },
    });
    fireEvent.click(within(item()).getByRole("button", { name: "Cancel" }));

    expect(within(item()).queryByRole("textbox")).toBeNull();
    expect(item().textContent).toMatch(/Ordered washers\./);
    expect(edit).not.toHaveBeenCalled();
  });

  it("posts one and empties the box", async () => {
    open();
    await screen.findByPlaceholderText(/^Comment\./);
    const send = screen.getByRole("button", { name: "Comment" });
    expect(send.hasAttribute("disabled")).toBe(true);

    fireEvent.change(box(), { target: { value: "Still drips." } });
    fireEvent.click(send);
    await waitFor(() =>
      expect(comment).toHaveBeenCalledWith("8qw4tz9k", "Still drips."),
    );
    await waitFor(() => expect(box().value).toBe(""));
  });

  it("previews one, and is back to editing once it is posted", async () => {
    open();
    await screen.findByPlaceholderText(/^Comment\./);
    fireEvent.change(box(), { target: { value: "Needs **washers**." } });
    fireEvent.click(screen.getByRole("button", { name: "preview" }));

    const group = screen.getByRole("group", { name: "Comment" });
    const composer = group.parentElement!.parentElement!;
    expect(composer.querySelector("strong")?.textContent).toBe("washers");
    expect(box().classList.contains("hidden")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(box().value).toBe(""));
    expect(box().classList.contains("hidden")).toBe(false);
    expect(
      screen.getByRole("button", { name: "edit" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("posts one on Cmd+Enter, and leaves Enter and Shift+Enter new lines", async () => {
    open();
    await screen.findByPlaceholderText(/^Comment\./);
    fireEvent.change(box(), { target: { value: "Still drips." } });
    fireEvent.keyDown(box(), { key: "Enter" });
    // What an iPhone sends for the second of two Returns.
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    expect(comment).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: "Enter", metaKey: true });
    await waitFor(() =>
      expect(comment).toHaveBeenCalledWith("8qw4tz9k", "Still drips."),
    );
  });

  it("marks done with the comment, the comment first", async () => {
    open();
    await screen.findByPlaceholderText(/^Comment\./);
    fireEvent.change(box(), { target: { value: "Fixed: new washers." } });
    fireEvent.click(
      screen.getByRole("button", { name: "Mark done with comment" }),
    );
    await waitFor(() => expect(calls).toEqual(["comment", "done"]));
  });

  it("deletes with the comment, the comment first", async () => {
    open();
    await screen.findByPlaceholderText(/^Comment\./);
    fireEvent.change(box(), { target: { value: "Not worth it." } });
    fireEvent.click(
      screen.getByRole("button", { name: "Delete with comment" }),
    );
    await waitFor(() => expect(calls).toEqual(["comment", "delete"]));
  });
});
