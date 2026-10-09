import { Platform } from 'react-native';

/**
 * Where the mini player goes on phones. iOS 26 and later show it in the tab bar itself (its
 * bottom accessory); older iOS and Android get a bar floating just above the tab bar.
 */
export const usesTabBarAccessory = Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26;

export const usesFloatingPlayer = Platform.OS !== 'web' && !usesTabBarAccessory;

/** The floating player's height, plus the gap above it that screens leave clear. */
export const FloatingPlayerHeight = 56;
export const FloatingPlayerGap = 8;
