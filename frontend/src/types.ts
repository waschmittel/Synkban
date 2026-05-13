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
