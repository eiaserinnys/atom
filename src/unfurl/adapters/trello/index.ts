import type { UnfurlAdapter, UnfurlCredentials, UnfurlResult, CredentialField } from "../../interface.js";
import { fetchTrelloCard } from "./api.js";
import { formatTrelloCard } from "./formatter.js";

export type { TrelloCardUnfurlData } from "./formatter.js";

export class TrelloAdapter implements UnfurlAdapter {
  readonly sourceType = "trello";
  readonly credentialFields: CredentialField[] = [
    { key: "apiKey", label: "API Key", secret: false },
    { key: "token", label: "Token", secret: true },
  ];

  async resolve(ref: string, credentials: UnfurlCredentials): Promise<UnfurlResult> {
    const { apiKey, token } = credentials;
    if (!apiKey || !token) {
      throw new Error("[TrelloAdapter] apiKey and token are required");
    }

    // ref는 Trello card URL 또는 shortLink
    // "https://trello.com/c/SHORTLINK" 또는 "SHORTLINK" 형식 지원
    const shortLink = ref.includes("trello.com/c/")
      ? ref.split("trello.com/c/")[1].split("/")[0]
      : ref;

    const card = await fetchTrelloCard(shortLink, apiKey, token);
    return formatTrelloCard(card);
  }
}

export const trelloAdapter = new TrelloAdapter();
