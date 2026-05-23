import { authApi } from './authApi';
import { cardApi } from './cardApi';
import { compileApi } from './compileApi';
import { configApi } from './configApi';
import { searchApi } from './searchApi';
import { systemApi } from './systemApi';
import { treeApi } from './treeApi';
import { unfurlApi } from './unfurlApi';

export type * from './types';

export const api = {
  getTree: treeApi.getTree,
  getNode: treeApi.getNode,
  compile: compileApi.compile,
  getAdapters: unfurlApi.getAdapters,
  compileWithRefs: compileApi.compileWithRefs,
  search: searchApi.search,
  getCard: cardApi.getCard,
  updateCard: cardApi.updateCard,
  updateNode: treeApi.updateNode,
  createCard: cardApi.createCard,
  deleteNode: treeApi.deleteNode,
  moveNode: treeApi.moveNode,
  listChildren: treeApi.listChildren,
  getAuthStatus: authApi.getAuthStatus,
  logout: authApi.logout,
};

export { configApi, systemApi };
