/**
 * Every query key, in one object, hierarchically arranged so prefix invalidation is correct by
 * construction: invalidating ["tasks"] catches the filtered list, the unfiltered one and the
 * open task without any of them knowing about the others.
 */
export const qk = {
  me: ["me"] as const,
  tasks: ["tasks"] as const,
  taskList: (search: string) => ["tasks", "list", search] as const,
  task: (id: string) => ["tasks", "one", id] as const,
  tags: ["tags"] as const,
  sessions: ["sessions"] as const,
  tokens: ["tokens"] as const,
  account: ["account"] as const,
  admin: ["admin"] as const,
  adminRelay: ["admin", "relay"] as const,
  adminLimits: ["admin", "limits"] as const,
  adminUsers: ["admin", "users"] as const,
};
