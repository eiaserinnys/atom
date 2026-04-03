export interface TrelloCardRaw {
  id: string;
  name: string;
  desc: string;
  shortUrl: string;
  labels: { name: string; color: string }[];
  members: { fullName: string }[];
  due: string | null;
  dueComplete: boolean;
  checklists: {
    name: string;
    checkItems: { name: string; state: string }[];
  }[];
}

export async function fetchTrelloCard(
  shortLink: string,
  apiKey: string,
  token: string
): Promise<TrelloCardRaw> {
  const url = `https://api.trello.com/1/cards/${shortLink}?checklists=all&members=true&key=${apiKey}&token=${token}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`[TrelloAdapter] Trello API error: ${res.status}`);
  }
  return res.json() as Promise<TrelloCardRaw>;
}
