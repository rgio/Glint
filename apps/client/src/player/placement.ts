import { Platform } from 'react-native';

/**
 * Where the mini player goes on phones. iOS 26 and later show it in the tab bar itself (its
 * bottom accessory) on the tab screens; everywhere else it floats just above the tab bar, or
 * above the bottom edge on screens without one (a show or episode page).
 */
export const usesTabBarAccessory = Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26;

/** The floating player's height, plus the gap around it that screens leave clear. */
export const FloatingPlayerHeight = 56;
export const FloatingPlayerGap = 8;

/** Screens with the tab bar. */
const TAB_PATHS = new Set(['/', '/discover', '/library', '/highlights']);
/** Screens that cover the player bar: the full player and the note editor. */
const COVERING_PATHS = new Set(['/player', '/note']);

export const isTabPath = (pathname: string) => TAB_PATHS.has(pathname);

/** Whether the floating player shows on `pathname` (with something playing). */
export function showsFloatingPlayer(pathname: string) {
  if (Platform.OS === 'web' || COVERING_PATHS.has(pathname)) return false;
  return !(usesTabBarAccessory && isTabPath(pathname));
}
