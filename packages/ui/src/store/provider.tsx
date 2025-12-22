'use client';

import { AppStore, createAppStore } from '@/store/store';
import { createContext, useContext, useRef } from 'react';
import { useStore } from 'zustand';

export type ZustandStoreProviderProps = {
  children: React.ReactNode;
};

export type AppStoreApi = ReturnType<typeof createAppStore>;

export const AppStoreContext = createContext<AppStoreApi | undefined>(
  undefined
);

export const ZustandStoreProvider = ({
  children,
}: ZustandStoreProviderProps) => {
  const storeRef = useRef<AppStoreApi | null>(null);
  if (!storeRef.current) {
    storeRef.current = createAppStore();
  }

  return (
    <AppStoreContext.Provider value={storeRef.current}>
      {children}
    </AppStoreContext.Provider>
  );
};

export const useAppStore = <T,>(selector: (state: AppStore) => T) => {
  const storeContex = useContext(AppStoreContext);
  if (!storeContex) {
    throw new Error('useAppStore must be used within a StoreProvider');
  }
  return useStore(storeContex, selector);
};
