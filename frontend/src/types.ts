export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Attachment {
  id: string;
  filename: string;
  size: number;
  content_type: string;
  created_at: string;
}

export interface Board {
  id: string;
  title: string;
  created_at: string;
  color?: string;
  archived: boolean;
  archived_at?: string;
  position: number;
  mode: BoardMode;
  /** Only from `listBoards` (home tiles). */
  stats?: BoardStats;
}

export interface BoardStats {
  /** Active cards. */
  cards: number;
  /** Active cards due before the client's today. */
  overdue: number;
  /** Newest file change in the board, ms since the epoch. */
  edited_at: number;
}

/// Board layout (ADR-0022): lists side by side, or one list at a time with the
/// selected card edited beside it.
export type BoardMode = "kanban" | "notes";

export interface Card {
  id: string;
  list_id: string;
  title: string;
  description: string;
  description_text: string;
  position: number;
  created_at: string;
  label_ids: string[];
  archived: boolean;
  archived_at?: string;
  attachments: Attachment[];
  due_date?: string;
  checklist: ChecklistItem[];
}

/** Editable card content tracked by the change history. Attachments by name only. */
export interface CardContent {
  title: string;
  description: string;
  label_ids: string[];
  due_date: string | null;
  checklist: ChecklistItem[];
  attachments: string[];
}

export interface HistoryEntry extends CardContent {
  /** When this version became current, `YYYY-MM-DD HH:MM:SS` UTC. */
  at: string;
}

export interface CardHistory {
  current: CardContent;
  /** Recorded versions, newest first (at most 100). */
  entries: HistoryEntry[];
}

export interface ListWithCards {
  id: string;
  board_id: string;
  title: string;
  position: number;
  created_at: string;
  /** Shown as a narrow strip in the board view. */
  collapsed: boolean;
  cards: Card[];
}

export interface BoardDetail {
  id: string;
  title: string;
  created_at: string;
  color?: string;
  labels: Label[];
  mode: BoardMode;
  lists: ListWithCards[];
}

/** Card content normalised for comparison (CardDetail): label ids sorted
 *  and joined with NUL, checklist and description as JSON strings. */
export interface DraftContent {
  title: string;
  description: string;
  labels: string;
  due: string;
  checklist: string;
}

/** Unsaved card edits kept across app restarts (ADR-0024). */
export interface Draft {
  card_id: string;
  board_id: string;
  /** The stored card content the edits started from. */
  base: DraftContent;
  /** The edited content. */
  draft: DraftContent;
  /** ms since the epoch. */
  saved_at: number;
}

export type Theme = "system" | "light" | "dark";

export type MirrorSchedule = "off" | "daily" | "weekly";

export interface MirrorStatus {
  running: boolean;
  last_succeeded_at?: number | null;
  last_attempt_at?: number | null;
  last_error?: string | null;
  cards_mirrored?: number | null;
}

export interface Settings {
  startup_view: "overview" | "last";
  theme: Theme;
  last_board_id: string | null;
  /** Effective data dir of the running server (may come from CLI/env). */
  data_dir: string;
  /** data_dir as stored in synkban.toml, if set. */
  configured_data_dir: string | null;
  default_data_dir: string;
  /** Desktop-only readable mirror folder (null in Web Mode or when unset). */
  mirror_dir: string | null;
  /** Desktop-only readable mirror schedule ("off" in Web Mode). */
  mirror_schedule: MirrorSchedule;
  /** Desktop-only readable mirror status (null in Web Mode). */
  mirror_status: MirrorStatus | null;
}

export interface UpdateSettingsPayload {
  startup_view?: "overview" | "last";
  /** absent leaves the current theme unchanged. */
  theme?: Theme;
  /** null clears the stored id; absent leaves it unchanged. */
  last_board_id?: string | null;
  /** null reverts to the default dir; absent leaves it unchanged. */
  data_dir?: string | null;
  /** Desktop-only: null clears the mirror folder; absent leaves it unchanged. */
  mirror_dir?: string | null;
  /** Desktop-only: "off" | "daily" | "weekly". */
  mirror_schedule?: MirrorSchedule;
}
