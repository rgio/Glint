import * as SecureStore from 'expo-secure-store';

// iOS Keychain / Android Keystore, per the spec's security requirements.
const KEY = 'refresh_token';

export const loadRefreshToken = () => SecureStore.getItemAsync(KEY);
export const saveRefreshToken = (token: string) => SecureStore.setItemAsync(KEY, token);
export const clearRefreshToken = () => SecureStore.deleteItemAsync(KEY);
