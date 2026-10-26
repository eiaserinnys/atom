import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type CardData } from '../../api/client';
import { parseJournalLimitDraft } from './cardDetailLogic';
import { nodeQueryKey } from '../../query/queryKeys';

interface UseCardDetailSavesArgs {
  nodeId: string | null;
  saveFailedLabel: string;
  onSaveError: (field: 'title' | 'content' | 'journalLimit', message: string) => void;
  onTitleSaved: (card: CardData) => void;
  onContentSaved: (card: CardData) => void;
  onJournalLimitSaved: () => void;
  onJournalLimitIgnored: () => void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useCardDetailSaves({
  nodeId,
  saveFailedLabel,
  onSaveError,
  onTitleSaved,
  onContentSaved,
  onJournalLimitSaved,
  onJournalLimitIgnored,
}: UseCardDetailSavesArgs) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const invalidateNode = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: nodeQueryKey(nodeId) });
  }, [nodeId, queryClient]);

  const showSaveError = useCallback((field: 'title' | 'content' | 'journalLimit', error: unknown) => {
    onSaveError(field, `${saveFailedLabel}: ${getErrorMessage(error)}`);
  }, [onSaveError, saveFailedLabel]);

  const saveTitle = useCallback(async (cardId: string | undefined, titleDraft: string) => {
    if (!cardId) return;
    setSaving(true);
    try {
      const updatedCard = await api.updateCard(cardId, { title: titleDraft });
      onTitleSaved(updatedCard);
      invalidateNode();
    } catch (error: unknown) {
      showSaveError('title', error);
    } finally {
      setSaving(false);
    }
  }, [invalidateNode, onTitleSaved, showSaveError]);

  const saveContent = useCallback(async (cardId: string | undefined, contentDraft: string) => {
    if (!cardId) return;
    setSaving(true);
    try {
      const updatedCard = await api.updateCard(cardId, { content: contentDraft });
      onContentSaved(updatedCard);
      invalidateNode();
    } catch (error: unknown) {
      showSaveError('content', error);
    } finally {
      setSaving(false);
    }
  }, [invalidateNode, onContentSaved, showSaveError]);

  const saveJournalLimit = useCallback(async (journalLimitDraft: string) => {
    if (!nodeId) return;

    const parsed = parseJournalLimitDraft(journalLimitDraft);
    if (parsed.type === 'ignore') {
      onJournalLimitIgnored();
      return;
    }

    setSaving(true);
    try {
      await api.updateNode(nodeId, { journal_limit: parsed.value });
      onJournalLimitSaved();
      invalidateNode();
    } catch (error: unknown) {
      showSaveError('journalLimit', error);
    } finally {
      setSaving(false);
    }
  }, [invalidateNode, nodeId, onJournalLimitIgnored, onJournalLimitSaved, showSaveError]);

  return {
    saving,
    invalidateNode,
    saveTitle,
    saveContent,
    saveJournalLimit,
  };
}
