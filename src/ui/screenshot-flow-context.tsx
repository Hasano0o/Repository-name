/**
 * Screenshot Flow Context — PHASE 4C-2C-1
 *
 * In-memory state فقط — لا AsyncStorage، لا SecureStore.
 * يُحيط بشاشات app/screenshot/* فقط.
 * يُصفّر نفسه عند unmount وعند reset() الصريح.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  createConsentState,
  ScreenshotConsentState,
} from '../router-discovery/screenshot/consent';
import { ScreenshotReviewState } from '../router-discovery/screenshot/review';
import { RouterDiagnosticPackage } from '../router-discovery/types';

interface ScreenshotFlowState {
  host: string;
  consent: ScreenshotConsentState;
  rawText: string;
  reviewState: ScreenshotReviewState | null;
  finalPackage: RouterDiagnosticPackage | null;
}

interface ScreenshotFlowActions {
  setHost: (host: string) => void;
  setConsent: (state: ScreenshotConsentState) => void;
  setRawText: (text: string) => void;
  setReviewState: (state: ScreenshotReviewState) => void;
  setFinalPackage: (pkg: RouterDiagnosticPackage) => void;
  reset: () => void;
}

export interface ScreenshotFlowContextValue {
  state: ScreenshotFlowState;
  actions: ScreenshotFlowActions;
}

function initialState(host: string): ScreenshotFlowState {
  return {
    host,
    consent: createConsentState(),
    rawText: '',
    reviewState: null,
    finalPackage: null,
  };
}

const ScreenshotFlowContext = createContext<ScreenshotFlowContextValue | null>(null);

export function ScreenshotFlowProvider({
  host,
  children,
}: {
  host: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<ScreenshotFlowState>(() => initialState(host));

  const setHost = useCallback((h: string) => {
    setState((prev) => ({ ...prev, host: h }));
  }, []);

  const setConsent = useCallback((consent: ScreenshotConsentState) => {
    setState((prev) => ({ ...prev, consent }));
  }, []);

  const setRawText = useCallback((rawText: string) => {
    setState((prev) => ({ ...prev, rawText }));
  }, []);

  const setReviewState = useCallback((reviewState: ScreenshotReviewState) => {
    setState((prev) => ({ ...prev, reviewState }));
  }, []);

  const setFinalPackage = useCallback((finalPackage: RouterDiagnosticPackage) => {
    setState((prev) => ({ ...prev, finalPackage }));
  }, []);

  const reset = useCallback(() => {
    setState(initialState(host));
  }, [host]);

  const value = useMemo<ScreenshotFlowContextValue>(
    () => ({
      state,
      actions: { setHost, setConsent, setRawText, setReviewState, setFinalPackage, reset },
    }),
    [state, setHost, setConsent, setRawText, setReviewState, setFinalPackage, reset],
  );

  return (
    <ScreenshotFlowContext.Provider value={value}>
      {children}
    </ScreenshotFlowContext.Provider>
  );
}

export function useScreenshotFlow(): ScreenshotFlowContextValue {
  const ctx = useContext(ScreenshotFlowContext);
  if (!ctx) {
    throw new Error('useScreenshotFlow must be used inside ScreenshotFlowProvider');
  }
  return ctx;
}
