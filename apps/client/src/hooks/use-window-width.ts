import { useSyncExternalStore } from 'react';
import { useWindowDimensions } from 'react-native';

const subscribe = () => () => {};

/**
 * The window's width, safe for the web's static rendering: the pre-rendered HTML is made with a
 * width of 0, so the first client render must use 0 too or hydration fails. The real width
 * follows straight after.
 */
export function useWindowWidth() {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const { width } = useWindowDimensions();
  return hydrated ? width : 0;
}
