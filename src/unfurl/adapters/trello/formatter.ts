import type { UnfurlResult } from "../../interface.js";
import type { TrelloCardRaw } from "./api.js";

export interface TrelloCardUnfurlData extends Record<string, unknown> {
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

export function formatTrelloCard(card: TrelloCardRaw): UnfurlResult {
  const unfurlData: TrelloCardUnfurlData = {
    id: card.id,
    name: card.name,
    desc: card.desc,
    url: card.shortUrl,
    labels: (card.labels ?? []).map((l) => ({ name: l.name, color: l.color })),
    members: (card.members ?? []).map((m) => ({ fullName: m.fullName })),
    due: card.due ?? null,
    dueComplete: card.dueComplete,
    checklists: (card.checklists ?? []).map((cl) => ({
      name: cl.name,
      items: cl.checkItems.map((item) => ({ name: item.name, state: item.state })),
    })),
  };

  const lines: string[] = [];
  lines.push(`**${unfurlData.name}**`);
  if (unfurlData.desc) lines.push(unfurlData.desc);
  if (unfurlData.labels.length > 0)
    lines.push(`Labels: ${unfurlData.labels.map((l) => l.name || l.color).join(", ")}`);
  if (unfurlData.members.length > 0)
    lines.push(`Members: ${unfurlData.members.map((m) => m.fullName).join(", ")}`);
  if (unfurlData.due)
    lines.push(`Due: ${unfurlData.due}${unfurlData.dueComplete ? " ✅" : ""}`);
  for (const cl of unfurlData.checklists) {
    lines.push(`\n**${cl.name}**`);
    for (const item of cl.items) {
      lines.push(`- [${item.state === "complete" ? "x" : " "}] ${item.name}`);
    }
  }

  return {
    text: lines.join("\n"),
    snapshot: JSON.stringify(unfurlData),
    unfurlData,
  };
}
