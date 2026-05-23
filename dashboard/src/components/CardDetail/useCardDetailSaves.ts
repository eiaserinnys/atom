import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { parseJournalLimitDraft } from './cardDetailLogic';
import { nodeQueryKey } from '../../query/queryKeys';

interface UseCardDetailSavesArgs {
  nodeId: string | null;
  saveFailedLabel: string;
  onTitleSaved: () => void;
  onContentSaved: () => void;
  onJournalLimitSaved: () => void;
  onJournalLimitIgnored: () => void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useCardDetailSaves({
  nodeId,
  saveFailedLabel,
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

  const showSaveError = useCallback((error: unknown) => {
    alert(`${saveFailedLabel}: ${getErrorMessage(error)}`);
  }, [saveFailedLabel]);

  const saveTitle = useCallback(async (cardId: string | undefined, titleDraft: string) => {
    if (!cardId) return;
    setSaving(true);
    try {
      await api.updateCard(cardId, { title: titleDraft });
      onTitleSaved();
      invalidateNode();
    } catch (error: unknown) {
      showSaveError(error);
    } finally {
      setSaving(false);
    }
  }, [invalidateNode, onTitleSaved, showSaveError]);

  const saveContent = useCallback(async (cardId: string | undefined, contentDraft: string) => {
    if (!cardId) return;
    setSaving(true);
    try {
      await api.updateCard(cardId, { content: contentDraft });
      onContentSaved();
      invalidateNode();
    } catch (error: unknown) {
      showSaveError(error);
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
      showSaveError(error);
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
