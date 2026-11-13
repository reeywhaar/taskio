import type { Status } from "@app/api/types";

/** Still to do, whether it is on the list or snoozed off it for now. */
export const isOpen = (task: { status: Status }) =>
  task.status === "todo" || task.status === "snoozed";
