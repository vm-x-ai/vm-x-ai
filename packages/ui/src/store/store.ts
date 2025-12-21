import { createStore } from 'zustand/vanilla';
import { persist, createJSONStorage } from 'zustand/middleware';
import { subscribeWithSelector } from 'zustand/middleware';
import { sidebarActions, SidebarActions, SidebarStore } from './sidebar.store';
import {
  aiResourceActions,
  AiResourceActions,
  AiResourceStore,
} from './ai-resource.store';

export type Store = SidebarStore & AiResourceStore;

export type AppActions = {
  setState: (state: Partial<Store>) => void;
};

export type AppStore = Store & AppActions & SidebarActions & AiResourceActions;

const initialState: Store = {
  sidebar: {
    open: false,
  },
};

export const createAppStore = (initState: Store = initialState) =>
  createStore<AppStore>()(
    subscribeWithSelector(
      persist(
        (set, get) => ({
          ...initState,
          setState: (state: Partial<Store>) => set({ ...get(), ...state }),
          ...sidebarActions(set, get),
          ...aiResourceActions(set, get),
        }),
        {
          name: 'app-store',
          partialize: (state) => {
            return {
              sidebar: state.sidebar,
            };
          },
          storage: createJSONStorage(() => window.localStorage),
        }
      )
    )
  );
