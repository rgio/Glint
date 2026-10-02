/**
 * Durable async key-value storage for client state. Implementations:
 * kv.native.ts (expo-sqlite kv-store) and kv.web.ts (IndexedDB). The shape
 * matches zustand's `StateStorage`, so stores can persist through it directly.
 */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
