import type { Attachment, Board, BoardDetail, Card, Label, ListWithCards } from "./types";

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
  checkChanges: () => request<{ mtime: number }>("/changes"),

  listBoards: () => request<Board[]>("/boards"),

  createBoard: (title: string) =>
    request<Board>("/boards", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),

  getBoard: (id: string) => request<BoardDetail>(`/boards/${id}`),

  updateBoard: (id: string, title: string, color?: string | null) =>
    request<Board>(`/boards/${id}`, {
      method: "PUT",
      body: JSON.stringify({ title, color }),
    }),

  deleteBoard: (id: string) =>
    request<void>(`/boards/${id}`, { method: "DELETE" }),

  getArchivedCards: (boardId: string) =>
    request<Card[]>(`/boards/${boardId}/archive`),

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
      label_ids?: string[];
      archived?: boolean;
      due_date?: string | null;
    }
  ) =>
    request<Card>(`/cards/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  archiveCard: (id: string) =>
    request<Card>(`/cards/${id}`, {
      method: "PUT",
      body: JSON.stringify({ archived: true }),
    }),

  restoreCard: (id: string, listId?: string) =>
    request<Card>(`/cards/${id}`, {
      method: "PUT",
      body: JSON.stringify({ archived: false, ...(listId ? { list_id: listId } : {}) }),
    }),

  deleteCard: (id: string) =>
    request<void>(`/cards/${id}`, { method: "DELETE" }),

  createLabel: (boardId: string, name: string) =>
    request<Label>(`/boards/${boardId}/labels`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  updateLabel: (id: string, name: string) =>
    request<Label>(`/labels/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    }),

  deleteLabel: (id: string) =>
    request<void>(`/labels/${id}`, { method: "DELETE" }),

  uploadAttachment: async (cardId: string, file: File): Promise<Attachment> => {
    const res = await fetch(
      `${BASE}/cards/${cardId}/attachments?filename=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  },

  getAttachmentUrl: (cardId: string, attId: string) =>
    `${BASE}/cards/${cardId}/attachments/${attId}`,

  getAttachmentThumbUrl: (cardId: string, attId: string) =>
    `${BASE}/cards/${cardId}/attachments/${attId}/thumb`,

  deleteAttachment: (cardId: string, attId: string) =>
    request<void>(`/cards/${cardId}/attachments/${attId}`, { method: "DELETE" }),
};
