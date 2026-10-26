import { request } from './request';
import type { CardData } from './types';

interface UpdateCardResponse {
  card: CardData;
  conflict: false;
}

export const cardApi = {
  getCard(cardId: string): Promise<CardData> {
    return request(`/cards/${cardId}`);
  },

  async updateCard(cardId: string, data: { title?: string; content?: string; expected_version?: number }): Promise<CardData> {
    const result = await request<UpdateCardResponse>(`/cards/${cardId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return result.card;
  },

  createCard(data: {
    card_type: 'structure' | 'knowledge';
    title: string;
    content?: string;
    parent_node_id?: string | null;
    position?: number;
  }): Promise<CardData & { node_id: string }> {
    return request('/cards', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};
