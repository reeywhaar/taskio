/** What the API returns. Field names are the server's, unchanged. */

export type Status = "todo" | "done";

export type Task = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  status: Status;
  priority: number;
  pinned: boolean;
  /** #rrggbb, or empty for none. */
  color: string;
  created_at: number;
  updated_at: number;
  done_at: number | null;
};

/** A mention: enough to draw a link with a title on it. */
export type TaskStub = { id: string; title: string; status: Status };

export type TaskDetail = Task & {
  mentions: TaskStub[];
  mentioned_by: TaskStub[];
};

export type TaskPage = {
  tasks: Task[];
  total: number;
  next_cursor?: string;
};

export type Tag = { id: string; slug: string };

/** A named set of tags. Its tags need not be tags anything carries. */
export type Group = {
  id: string;
  name: string;
  tags: string[];
  /** #rrggbb, or empty for the brand color. */
  color: string;
  created_at: number;
};

export type Me = {
  id: string;
  username: string;
  role: "admin" | "user";
  created_at: number;
};

export type Session = {
  id: string;
  current: boolean;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  device: string;
  user_agent: string;
};

export type Token = {
  id: string;
  label: string;
  hint: string;
  scope: string;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
};

export type Asset = {
  id: string;
  url: string;
  content_type: string;
  size: number;
  /** Whether a description should embed it or link to it. The server decides, because it is
   *  the one that settled on the type. */
  image: boolean;
};
