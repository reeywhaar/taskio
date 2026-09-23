/** What the API returns. Field names are the server's, unchanged. */

/** deleted is a kind of done: it leaves the todo list and turns up among the finished. */
export type Status = "todo" | "done" | "deleted";

export type Task = {
  id: string;
  /** The slug of the project it is in. */
  project: string;
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
  /** When somebody last said it still stands, which is what its age counts from. Only a poke
   *  moves it. */
  poked_at: number;
  done_at: number | null;
  /** Set on a task somebody threw away, which also carries done_at. */
  deleted_at: number | null;
};

/** A mention: enough to draw a link with a title on it. */
export type TaskStub = {
  id: string;
  title: string;
  /** Where it is, which can be another project: a mention is by id. */
  project: string;
  status: Status;
};

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

/** A hard separation of an account's tasks, each with its own tags and groups. */
export type Project = {
  id: string;
  name: string;
  /** What the URL says. Changes only when somebody changes it, never with the name. */
  slug: string;
  /** Where a URL with no project goes. It can be renamed, and cannot be deleted. */
  default: boolean;
  created_at: number;
};

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

/** One project a token reaches, and what confines it there. */
export type TokenRow = {
  project: string;
  name: string;
  /** A flat or() or and() of the project's tags, or empty for all of it. */
  scope: string;
  /** A project since deleted, which the token still names and is refused on. */
  deleted?: boolean;
};

export type Token = {
  id: string;
  label: string;
  hint: string;
  /** Its one row's scope, for a token reaching one project; empty for one reaching several. */
  scope: string;
  projects: TokenRow[];
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
  /** Where it was last used from. Empty until it has been used once. */
  last_ip: string;
  last_agent: string;
  /** Seconds of disuse before it stops working. 0 is never. */
  idle_seconds: number;
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
