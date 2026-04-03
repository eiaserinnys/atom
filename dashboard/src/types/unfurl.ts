export interface TrelloCardUnfurlData {
  id: string;
  name: string;
  desc: string;
  url: string;
  labels: { name: string; color: string }[];
  members: { fullName: string }[];
  due: string | null;
  dueComplete: boolean;
  checklists: {
    name: string;
    items: { name: string; state: string }[];
  }[];
}

export type UnfurlData = TrelloCardUnfurlData; // 향후 확장 대비
