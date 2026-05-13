export interface Label {
  id: string;
  name: string;
  color: string;
}

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
  label_ids: string[];
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
  labels: Label[];
  lists: ListWithCards[];
}
