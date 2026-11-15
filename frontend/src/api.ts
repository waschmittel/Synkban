import type { Attachment, Board, BoardDetail, BoardMode, Card, CardHistory, ChecklistItem, Draft, Label, ListWithCards, Settings, UpdateSettingsPayload } from "./types";

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
  checkChanges: () => request<{ mtime: number; boards: Record<string, number> }>("/changes"),

  getSettings: () => request<Settings>("/settings"),

  updateSettings: (data: UpdateSettingsPayload) =>
    request<Settings>("/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  getWarnings: () => request<{ warnings: string[] }>("/warnings"),

  /// With stats; `today` (local `YYYY-MM-DD`) defines "overdue".
  listBoards: (today?: string) => request<Board[]>(today ? `/boards?today=${today}` : "/boards"),

  createBoard: (title: string) =>
    request<Board>("/boards", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),

  getBoard: (id: string) => request<BoardDetail>(`/boards/${id}`),

  updateBoard: (id: string, data: { title?: string; color?: string | null; archived?: boolean; mode?: BoardMode }) =>
    request<Board>(`/boards/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  archiveBoard: (id: string) =>
    request<Board>(`/boards/${id}`, {
      method: "PUT",
      body: JSON.stringify({ archived: true }),
    }),

  restoreBoard: (id: string) =>
    request<Board>(`/boards/${id}`, {
      method: "PUT",
      body: JSON.stringify({ archived: false }),
    }),

  deleteBoard: (id: string) =>
    request<void>(`/boards/${id}`, { method: "DELETE" }),

  listArchivedBoards: () => request<Board[]>("/boards/archive"),

  reorderBoards: (ids: string[]) =>
    request<void>("/boards/order", {
      method: "PUT",
      body: JSON.stringify({ ids }),
    }),

  getArchivedCards: (boardId: string) =>
    request<Card[]>(`/boards/${boardId}/archive`),

  createList: (boardId: string, title: string) =>
    request<ListWithCards>(`/boards/${boardId}/lists`, {
      method: "POST",
      body: JSON.stringify({ title }),
    }),

  updateList: (id: string, data: { title?: string; position?: number; collapsed?: boolean }) =>
    request<ListWithCards>(`/lists/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteList: (id: string) =>
    request<void>(`/lists/${id}`, { method: "DELETE" }),

  createCard: (listId: string, title: string, extra?: { label_ids?: string[]; due_date?: string }) =>
    request<Card>(`/lists/${listId}/cards`, {
      method: "POST",
      body: JSON.stringify({ title, ...extra }),
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
      checklist?: ChecklistItem[];
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

  getCardHistory: (id: string) => request<CardHistory>(`/cards/${id}/history`),

  /// Starts the browser's (or Electron's) download of the saved card as PDF.
  downloadCardPdf: (id: string) => {
    const a = document.createElement("a");
    a.href = `${BASE}/cards/${id}/pdf`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  },

  deleteCard: (id: string) =>
    request<void>(`/cards/${id}`, { method: "DELETE" }),

  createLabel: (boardId: string, name: string) =>
    request<Label>(`/boards/${boardId}/labels`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  /// `merge`: confirmed merge into a same-named label (409 without it).
  updateLabel: (id: string, name: string, merge = false) =>
    request<Label>(`/labels/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, merge }),
    }),

  reorderLabels: (boardId: string, ids: string[]) =>
    request<void>(`/boards/${boardId}/labels/order`, {
      method: "PUT",
      body: JSON.stringify({ ids }),
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

  /// The single crash-safety draft (ADR-0024), or null.
  getDraft: () => request<Draft | null>("/draft"),

  /// Replaces any draft. `keepalive`: still sent while the page unloads.
  saveDraft: (d: Draft, keepalive = false) =>
    request<void>(`/draft/${d.card_id}`, { method: "PUT", body: JSON.stringify(d), keepalive }),

  /// Only removes it if it's this card's.
  deleteDraft: (cardId: string) => request<void>(`/draft/${cardId}`, { method: "DELETE" }),

  /// Copies attachment `attId` of card `fromCard` onto `cardId` (pasting an inline image across cards).
  copyAttachment: (cardId: string, fromCard: string, attId: string) =>
    request<Attachment>(`/cards/${cardId}/attachments/copy`, {
      method: "POST",
      body: JSON.stringify({ from_card: fromCard, att_id: attId }),
    }),

  getAttachmentUrl: (cardId: string, attId: string) =>
    `${BASE}/cards/${cardId}/attachments/${attId}`,

  getAttachmentThumbUrl: (cardId: string, attId: string) =>
    `${BASE}/cards/${cardId}/attachments/${attId}/thumb`,

  deleteAttachment: (cardId: string, attId: string) =>
    request<void>(`/cards/${cardId}/attachments/${attId}`, { method: "DELETE" }),
};
