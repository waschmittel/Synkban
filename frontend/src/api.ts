import type { Board, BoardDetail, Card, GitSyncConfig, ListWithCards, SyncStatus } from "./types";

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  listBoards: () => request<Board[]>("/boards"),

  createBoard: (title: string) =>
    request<Board>("/boards", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),

  getBoard: (id: string) => request<BoardDetail>(`/boards/${id}`),

  updateBoard: (id: string, title: string) =>
    request<Board>(`/boards/${id}`, {
      method: "PUT",
      body: JSON.stringify({ title }),
    }),

  deleteBoard: (id: string) =>
    request<void>(`/boards/${id}`, { method: "DELETE" }),

  createList: (boardId: string, title: string) =>
    request<ListWithCards>(`/boards/${boardId}/lists`, {
      method: "POST",
      body: JSON.stringify({ title }),
    }),

  updateList: (id: string, data: { title?: string; position?: number }) =>
    request<ListWithCards>(`/lists/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteList: (id: string) =>
    request<void>(`/lists/${id}`, { method: "DELETE" }),

  createCard: (listId: string, title: string) =>
    request<Card>(`/lists/${listId}/cards`, {
      method: "POST",
      body: JSON.stringify({ title }),
    }),

  updateCard: (
    id: string,
    data: {
      title?: string;
      description?: string;
      position?: number;
      list_id?: string;
    }
  ) =>
    request<Card>(`/cards/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteCard: (id: string) =>
    request<void>(`/cards/${id}`, { method: "DELETE" }),

  getSyncStatus: () => request<SyncStatus>("/sync/status"),

  getSyncConfig: () => request<GitSyncConfig>("/sync/config"),

  updateSyncConfig: (config: GitSyncConfig) =>
    request<GitSyncConfig>("/sync/config", {
      method: "POST",
      body: JSON.stringify(config),
    }),

  syncNow: () =>
    request<SyncStatus>("/sync/now", { method: "POST" }),
};
