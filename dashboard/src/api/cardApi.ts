import { request } from './request';
import type { CardData } from './types';

export const cardApi = {
  getCard(cardId: string): Promise<CardData> {
    return request(`/cards/${cardId}`);
  },

  updateCard(cardId: string, data: { title?: string; content?: string }): Promise<CardData> {
    return request(`/cards/${cardId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
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
