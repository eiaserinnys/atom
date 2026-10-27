import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type CardData } from '../../api/client';
import { parseJournalLimitDraft } from './cardDetailLogic';
import { nodeQueryKey } from '../../query/queryKeys';
import { VersionConflictError } from '../../api/request';

interface UseCardDetailSavesArgs {
  nodeId: string | null;
  editBaseVersion: number | null;
  onSavingChange: (field: 'title' | 'content' | 'journalLimit', saving: boolean) => void;
  onVersionConflict: (currentVersion: number) => void;
  saveFailedLabel: string;
  onSaveError: (field: 'title' | 'content' | 'journalLimit', message: string) => void;
  onTitleSaved: (card: CardData, savedTitle: string) => void;
  onContentSaved: (card: CardData, savedContent: string) => void;
  onJournalLimitSaved: () => void;
  onJournalLimitIgnored: () => void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useCardDetailSaves({
  nodeId,
  editBaseVersion,
  onSavingChange,
  onVersionConflict,
  saveFailedLabel,
  onSaveError,
  onTitleSaved,
  onContentSaved,
  onJournalLimitSaved,
  onJournalLimitIgnored,
}: UseCardDetailSavesArgs) {
  const queryClient = useQueryClient();

  const invalidateNode = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: nodeQueryKey(nodeId) });
  }, [nodeId, queryClient]);

  const showSaveError = useCallback((field: 'title' | 'content' | 'journalLimit', error: unknown) => {
    if (error instanceof VersionConflictError) {
      onVersionConflict(error.currentVersion);
      return;
    }
    onSaveError(field, `${saveFailedLabel}: ${getErrorMessage(error)}`);
  }, [onSaveError, onVersionConflict, saveFailedLabel]);

  const saveTitle = useCallback(async (cardId: string | undefined, titleDraft: string) => {
    if (!cardId) return;
    onSavingChange('title', true);
    try {
      const updatedCard = await api.updateCard(cardId, { title: titleDraft, expected_version: editBaseVersion ?? undefined });
      onTitleSaved(updatedCard, titleDraft);
      invalidateNode();
    } catch (error: unknown) {
      showSaveError('title', error);
    } finally {
      onSavingChange('title', false);
    }
  }, [editBaseVersion, invalidateNode, onSavingChange, onTitleSaved, showSaveError]);

  const saveContent = useCallback(async (cardId: string | undefined, contentDraft: string) => {
    if (!cardId) return;
    onSavingChange('content', true);
    try {
      const updatedCard = await api.updateCard(cardId, { content: contentDraft, expected_version: editBaseVersion ?? undefined });
      onContentSaved(updatedCard, contentDraft);
      invalidateNode();
    } catch (error: unknown) {
      showSaveError('content', error);
    } finally {
      onSavingChange('content', false);
    }
  }, [editBaseVersion, invalidateNode, onSavingChange, onContentSaved, showSaveError]);

  const saveJournalLimit = useCallback(async (journalLimitDraft: string) => {
    if (!nodeId) return;

    const parsed = parseJournalLimitDraft(journalLimitDraft);
    if (parsed.type === 'ignore') {
      onJournalLimitIgnored();
      return;
    }

    onSavingChange('journalLimit', true);
    try {
      await api.updateNode(nodeId, { journal_limit: parsed.value });
      onJournalLimitSaved();
      invalidateNode();
    } catch (error: unknown) {
      showSaveError('journalLimit', error);
    } finally {
      onSavingChange('journalLimit', false);
    }
  }, [invalidateNode, nodeId, onJournalLimitIgnored, onJournalLimitSaved, onSavingChange, showSaveError]);

  return {
    invalidateNode,
    saveTitle,
    saveContent,
    saveJournalLimit,
  };
}
