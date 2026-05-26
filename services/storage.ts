/**
 * services/storage.ts
 *
 * Platform-aware key-value storage wrapper.
 *
 * On Native (iOS / Android):  delegates to @react-native-async-storage/async-storage
 * On Web:                      delegates to localStorage
 *
 * expo-secure-store is NOT used because it is a no-op on web — getItemAsync
 * always returns null and setItemAsync silently succeeds without storing
 * anything, which means sessions disappear on every web page refresh.
 *
 * Usage (drop-in for AsyncStorage):
 *   import { storage } from '../services/storage';
 *   await storage.getItem('sessionToken');
 *   await storage.setItem('sessionToken', token);
 *   await storage.removeItem('sessionToken');
 *   await storage.multiRemove(['sessionToken', 'cart']);
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const webStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn("localStorage.setItem failed:", e);
    }
  },

  removeItem: async (key: string): Promise<void> => {
    try {
      localStorage.removeItem(key);
    } catch {}
  },

  multiRemove: async (keys: string[]): Promise<void> => {
    try {
      keys.forEach((k) => localStorage.removeItem(k));
    } catch {}
  },

  multiSet: async (pairs: [string, string][]): Promise<void> => {
    try {
      pairs.forEach(([k, v]) => localStorage.setItem(k, v));
    } catch (e) {
      console.warn("localStorage.multiSet failed:", e);
    }
  },
};

const nativeStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
  multiRemove: (keys: string[]) => AsyncStorage.multiRemove(keys),
  multiSet: (pairs: [string, string][]) => AsyncStorage.multiSet(pairs),
};

export const storage = Platform.OS === "web" ? webStorage : nativeStorage;
