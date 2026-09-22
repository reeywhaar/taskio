import { useEffect, useState } from "react";

import { postTasksBulkTags } from "@app/api/actions/tasks";
import type { Tag, Task } from "@app/api/types";
import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import { Group } from "@app/components/Field";
import { TagCloud, type TagState } from "@app/islands/app/TagCloud";

/**
 * Tagging a selection: the account's whole vocabulary, and the three things a tag can be across
 * more than one task.
 *
 * A dialog rather than a row in the bulk bar, which is where this started. A cloud has no width
 * it can be relied on to fit — an account with a dozen tags wraps the bar to three rows, and the
 * list underneath has to reserve every pixel of it. It is also the one thing in that bar which
 * composes a change instead of firing one, so it wants a Save, an Escape and, on a phone, the
 * whole screen. The bar's other prompt is a single number and stays where it is.
 *
 * Nothing is sent until Save. A tag pressed by mistake is pressed back, and a tag nobody pressed
 * is named in neither list, so the save leaves each task's own answer to it alone — which is the
 * only way a scattered tag survives being looked at.
 */
export function BulkTagDialog({
  open,
  ids,
  chosen,
  tags,
  onClose,
  onSaved,
}: {
  open: boolean;
  ids: string[];
  /** The selected tasks the list can show, which is what the cloud counts. One picked and then
   *  filtered away is still saved to; it just has no tags to report. */
  chosen: Task[];
  tags: Tag[];
  onClose: () => void;
  onSaved: () => void;
}) {
  /** The presses so far, by slug. A tag left alone is not in here. */
  const [wish, setWish] = useState<Record<string, TagState>>({});
  const [busy, setBusy] = useState(false);

  // Emptied each time it opens, so an abandoned edit is abandoned.
  useEffect(() => {
    if (open) setWish({});
  }, [open]);

  /** What the selection says: nobody carries it, everybody does, or it is scattered. */
  const stateOf = (slug: string): TagState => {
    const has = chosen.filter((t) => t.tags.includes(slug)).length;
    if (has === 0) return "off";
    return has === chosen.length ? "on" : "some";
  };

  /** The account's tags, then any a selected task carries that the account has not caught up
   *  with, then any invented here. The account's own order, since that is the order elsewhere. */
  const slugs = [
    ...new Set([
      ...tags.map((t) => t.slug),
      ...chosen.flatMap((t) => t.tags),
      ...Object.keys(wish),
    ]),
  ];

  /** What a pill shows: what somebody has asked for, or what the selection already says. */
  const shows = (slug: string): TagState => wish[slug] ?? stateOf(slug);

  /**
   * A press puts the tag on the whole selection or takes it off the whole selection — and one
   * that is scattered has a third stop, which is leaving it scattered.
   *
   * some -> on -> off -> some. A tag everybody or nobody carries is the two states a tag has
   * always had, because there is no arrangement to go back to.
   */
  const cycle = (slug: string) => {
    const was = stateOf(slug);
    const next: TagState = (() => {
      switch (shows(slug)) {
        case "some":
          return "on";
        case "on":
          return "off";
        default:
          return was === "some" ? "some" : "on";
      }
    })();
    setWish(({ [slug]: _gone, ...rest }) =>
      next === was ? rest : { ...rest, [slug]: next },
    );
  };

  const asked = Object.entries(wish);
  const adding = asked.filter(([, s]) => s === "on").map(([slug]) => slug);
  const removing = asked.filter(([, s]) => s === "off").map(([slug]) => slug);

  const save = async () => {
    setBusy(true);
    try {
      await postTasksBulkTags(ids, adding, removing);
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Tags"
      aside={<span className="text-sm text-muted">{ids.length} selected</span>}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="solid"
            onClick={() => void save()}
            disabled={busy || asked.length === 0}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <Group
        label="Carried by"
        hint={
          adding.length === 0 && removing.length === 0
            ? "A half-filled pill is on some of them and not the rest. Leave it alone and it stays that way."
            : [
                adding.length ? `Adding ${adding.join(", ")}` : "",
                removing.length ? `removing ${removing.join(", ")}` : "",
              ]
                .filter(Boolean)
                .join(", ") + ", across all of them."
        }
      >
        <TagCloud
          tags={tags}
          selected={slugs.filter((slug) => shows(slug) === "on")}
          partial={slugs.filter((slug) => shows(slug) === "some")}
          onToggle={cycle}
          onCreate={(slug) => setWish({ ...wish, [slug]: "on" })}
        />
      </Group>
    </Dialog>
  );
}
