export interface Board {
  id: string;
  title: string;
  created_at: string;
}

export interface Card {
  id: string;
  list_id: string;
  title: string;
  description: string;
  position: number;
  created_at: string;
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
  lists: ListWithCards[];
}

export interface GitSyncConfig {
  enabled: boolean;
  remote_url: string;
  branch: string;
  sync_interval_secs: number;
  author_name: string;
  author_email: string;
}

export interface SyncStatus {
  enabled: boolean;
  initialized: boolean;
  last_commit: string | null;
  last_push: string | null;
  last_pull: string | null;
  pending_changes: boolean;
  error: string | null;
}
