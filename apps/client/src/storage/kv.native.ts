import Storage from 'expo-sqlite/kv-store';

import type { KeyValueStorage } from './types';

export const kv: KeyValueStorage = {
  getItem: (key) => Storage.getItem(key),
  setItem: (key, value) => Storage.setItem(key, value),
  removeItem: (key) => Storage.removeItem(key),
};
