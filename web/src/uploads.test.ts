import { beforeEach, describe, expect, it, vi } from "vitest";

import { finishInComment, finishInTask, track } from "@app/uploads";

/** The task as the server has it, which the finishing reads and writes. */
let description = "";
let comments: { id: string; body: string }[] = [];
const patch = vi.fn((_id: string, body: { description: string }) => {
  description = body.description;
  return Promise.resolve();
});
const edit = vi.fn((_id: string, which: string, body: string) => {
  comments = comments.map((c) => (c.id === which ? { ...c, body } : c));
  return Promise.resolve();
});
vi.mock("@app/api/actions/tasks", () => ({
  getTasksById: () => Promise.resolve({ description, comments }),
  patchTasksById: (id: string, body: { description: string }) =>
    patch(id, body),
  patchTasksByIdCommentsById: (id: string, which: string, body: string) =>
    edit(id, which, body),
}));

/** An upload that lands when the test says. */
function upload() {
  let land!: (markdown: string) => void;
  let fail!: () => void;
  const markdown = new Promise<string>((resolve, reject) => {
    land = resolve;
    fail = () => reject(new Error("refused"));
  });
  return { markdown, land, fail };
}

beforeEach(() => {
  patch.mockClear();
  edit.mockClear();
});

describe("an upload saved before it landed", () => {
  it("lands in the saved task when it arrives", async () => {
    const shot = upload();
    track("![shot](uploading-aaaaaa)", shot.markdown);
    description = "It drips.\n\n![shot](uploading-aaaaaa)";
    finishInTask("8qw4tz9k", description);

    expect(patch).not.toHaveBeenCalled();
    shot.land("![shot](/api/assets/a_one)");
    await vi.waitFor(() =>
      expect(description).toBe("It drips.\n\n![shot](/api/assets/a_one)"),
    );
  });

  it("goes from the saved task when it fails", async () => {
    const shot = upload();
    track("![shot](uploading-bbbbbb)", shot.markdown);
    description = "Before ![shot](uploading-bbbbbb) after";
    finishInTask("8qw4tz9k", description);
    shot.fail();
    await vi.waitFor(() => expect(description).toBe("Before  after"));
  });

  /** One at a time, each reading the task afresh, so the second does not undo the first. */
  it("lands two that arrive together", async () => {
    const one = upload();
    const two = upload();
    track("![one](uploading-cccccc)", one.markdown);
    track("![two](uploading-dddddd)", two.markdown);
    description = "![one](uploading-cccccc)\n![two](uploading-dddddd)";
    finishInTask("8qw4tz9k", description);
    two.land("![two](/api/assets/a_two)");
    one.land("![one](/api/assets/a_one)");
    await vi.waitFor(() =>
      expect(description).toBe(
        "![one](/api/assets/a_one)\n![two](/api/assets/a_two)",
      ),
    );
  });

  it("lands in a comment", async () => {
    const shot = upload();
    track("![shot](uploading-eeeeee)", shot.markdown);
    comments = [{ id: "c_1", body: "See ![shot](uploading-eeeeee)" }];
    finishInComment("8qw4tz9k", "c_1", comments[0]!.body);
    shot.land("![shot](/api/assets/a_one)");
    await vi.waitFor(() =>
      expect(comments[0]!.body).toBe("See ![shot](/api/assets/a_one)"),
    );
  });

  it("writes nothing for text with nothing on its way", () => {
    finishInTask("8qw4tz9k", "Just words.");
    expect(patch).not.toHaveBeenCalled();
  });
});
