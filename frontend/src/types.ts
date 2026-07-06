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
}

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

export interface ListWithCards {
  id: string;
  board_id: string;
  title: string;
  position: number;
  created_at: string;
  cards: Card[];
}

export interface BoardDetail {
  id: string;
  title: string;
  created_at: string;
  color?: string;
  labels: Label[];
  lists: ListWithCards[];
}

export interface Settings {
  startup_view: "overview" | "last";
  last_board_id: string | null;
  /** Effective data dir of the running server (may come from CLI/env). */
  data_dir: string;
  /** data_dir as stored in synkban.toml, if set. */
  configured_data_dir: string | null;
  default_data_dir: string;
}

export interface UpdateSettingsPayload {
  startup_view?: "overview" | "last";
  /** null clears the stored id; absent leaves it unchanged. */
  last_board_id?: string | null;
  /** null reverts to the default dir; absent leaves it unchanged. */
  data_dir?: string | null;
}
