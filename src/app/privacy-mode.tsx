/**
 * "Hide amounts on screen."
 *
 * A finance app gets opened on a bus, in a queue, across a desk. Every figure
 * being legible at a glance is exactly what you do not want in those moments,
 * and locking the whole app behind a passcode is a heavier answer than the
 * problem needs.
 *
 * Read by `MoneyText`, which is the single component every amount in the app
 * renders through — which is the reason it exists rather than each screen
 * calling `formatMoney` itself.
 *
 * **This is a shoulder-surfing measure, not security.** The numbers are still
 * in IndexedDB, in the DOM's accessibility tree if a screen reader asks, and
 * one toggle away. It is deliberately *not* persisted for the same reason: a
 * hidden state that survives a restart looks like data loss, and someone who
 * turned it on for one glance in a queue does not want to find their dashboard
 * blank tomorrow.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface PrivacyModeContextValue {
  isHidden: boolean;
  setIsHidden: (hidden: boolean) => void;
  toggle: () => void;
}

const PrivacyModeContext = createContext<PrivacyModeContextValue | null>(null);

export function PrivacyModeProvider({children}: {children: ReactNode}) {
  const [isHidden, setIsHidden] = useState(false);

  const toggle = useCallback(() => setIsHidden((current) => !current), []);

  const value = useMemo(
    () => ({isHidden, setIsHidden, toggle}),
    [isHidden, toggle],
  );

  return (
    <PrivacyModeContext.Provider value={value}>{children}</PrivacyModeContext.Provider>
  );
}

/**
 * Falls back to "not hidden" outside a provider rather than throwing.
 *
 * `MoneyText` is used in tests and could plausibly be rendered in isolation;
 * an amount showing when it should be masked is a worse failure than a crash
 * only in the sense that it is silent, but a crash in every unit test that
 * renders a row is a worse trade. The provider is mounted at the app root, so
 * the fallback only applies where there is no app.
 */
export function usePrivacyMode(): PrivacyModeContextValue {
  return (
    useContext(PrivacyModeContext) ?? {
      isHidden: false,
      setIsHidden: () => {},
      toggle: () => {},
    }
  );
}
