import { createJSONStorage, type StateStorage } from 'zustand/middleware';

import { kv } from './kv';

const lastWritten = new Map<string, string>();

/**
 * zustand's `persist` writes on every `set`, including the player's progress
 * ticks. Skipping writes whose serialized value hasn't changed keeps that to
 * real changes only.
 */
const dedupedKv: StateStorage = {
  async getItem(key) {
    const value = await kv.getItem(key);
    if (value !== null) lastWritten.set(key, value);
    return value;
  },
  async setItem(key, value) {
    if (lastWritten.get(key) === value) return;
    lastWritten.set(key, value);
    await kv.setItem(key, value);
  },
  async removeItem(key) {
    lastWritten.delete(key);
    await kv.removeItem(key);
  },
};

export const persistStorage = <S>() => createJSONStorage<S>(() => dedupedKv);
