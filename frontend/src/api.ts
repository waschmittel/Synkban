import { createSignal } from "solid-js";
import type { Attachment, Board, BoardDetail, BoardMode, Card, CardHistory, ChecklistItem, Draft, Label, ListWithCards, Settings, UpdateSettingsPayload } from "./types";

const BASE = "/api";

export const NETWORK_ERROR_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

export class ApiError extends Error {
  readonly status: number;
  readonly network: boolean;

  constructor(
    message: string,
    status: number,
    options?: { network?: boolean; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ApiError";
    this.status = status;
    this.network =
      options?.network ??
      (status === 0 || status === 502 || status === 503 || status === 504);
  }
}

export function isNetworkError(err: unknown): boolean {
  return (err instanceof ApiError && err.network) || err instanceof TypeError;
}

export function isNotFoundError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

export function errorMessage(err: unknown, fallback = "Request failed"): string {
  if (isNetworkError(err)) return NETWORK_ERROR_MESSAGE;
  return err instanceof Error && err.message ? err.message : fallback;
}

const [serverUnreachable, setServerUnreachable] = createSignal(false);
const [actionError, setActionError] = createSignal<string | null>(null);
let actionErrorIsNetwork = false;
let requestSeq = 0;
let lastFailureSeq = 0;
const reconnectListeners = new Set<() => void>();

export { serverUnreachable, actionError };

export function onReconnect(fn: () => void): () => void {
  reconnectListeners.add(fn);
  return () => reconnectListeners.delete(fn);
}

export function triggerReconnect(): void {
  for (const fn of reconnectListeners) fn();
}

function markReachable(seq: number, keepalive?: boolean): void {
  if (keepalive || seq <= lastFailureSeq) return;
  if (serverUnreachable()) {
    setServerUnreachable(false);
    if (actionErrorIsNetwork) {
      actionErrorIsNetwork = false;
      setActionError(null);
    }
    triggerReconnect();
  }
}

function markUnreachable(seq: number, keepalive?: boolean): void {
  if (keepalive) return;
  if (seq > lastFailureSeq) lastFailureSeq = seq;
  setServerUnreachable(true);
}

export function reportActionError(err: unknown, prefix?: string): void {
  const detail = errorMessage(err);
  const msg = prefix ? `${prefix}: ${detail}` : detail;
  actionErrorIsNetwork = isNetworkError(err);
  if (actionErrorIsNetwork) {
    lastFailureSeq = ++requestSeq;
    setServerUnreachable(true);
  }
  setActionError(msg);
}

export function clearActionError(): void {
  actionErrorIsNetwork = false;
  setActionError(null);
}

export function resetNetworkState(): void {
  requestSeq = 0;
  lastFailureSeq = 0;
  setServerUnreachable(false);
  clearActionError();
}

if (typeof window !== "undefined") {
  window.addEventListener("offline", () => {
    lastFailureSeq = ++requestSeq;
    setServerUnreachable(true);
  });
  window.addEventListener("online", () => triggerReconnect());
}

async function fetchResponse(url: string, init: RequestInit, seq: number): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (cause) {
    markUnreachable(seq, init.keepalive);
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0, { network: true, cause });
  }
  if (!res.ok) {
    let bodyError: string | undefined;
    try {
      const data = await res.json();
      if (data && typeof data.error === "string" && data.error) bodyError = data.error;
    } catch {
      /* non-JSON error body */
    }
    const isGatewayOrDeadProxy =
      res.status === 502 ||
      res.status === 503 ||
      res.status === 504 ||
      (res.status >= 500 && !bodyError && !res.statusText);
    if (isGatewayOrDeadProxy) markUnreachable(seq, init.keepalive);
    else markReachable(seq, init.keepalive);
    const message = bodyError || res.statusText || NETWORK_ERROR_MESSAGE;
    throw new ApiError(message, res.status, { network: isGatewayOrDeadProxy });
  }
  return res;
}

async function parseJson<T>(res: Response, seq: number, keepalive?: boolean): Promise<T> {
  try {
    const data = await res.json();
    markReachable(seq, keepalive);
    return data;
  } catch (cause) {
    markUnreachable(seq, keepalive);
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0, { network: true, cause });
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const seq = ++requestSeq;
  const init: RequestInit = {
    headers: { "Content-Type": "application/json" },
    ...options,
  };
  const res = await fetchResponse(`${BASE}${path}`, init, seq);
  if (res.status === 204) {
    markReachable(seq, init.keepalive);
    return undefined as T;
  }
  return parseJson<T>(res, seq, init.keepalive);
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
    const seq = ++requestSeq;
    const res = await fetchResponse(
      `${BASE}/cards/${cardId}/attachments?filename=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      },
      seq,
    );
    return parseJson<Attachment>(res, seq);
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
