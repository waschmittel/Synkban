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
