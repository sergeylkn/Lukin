/**
 * SettingsService — persists user settings on the device.
 */

import * as SecureStore from 'expo-secure-store';
import { TTSConfig } from './TTSService';

export interface AppSettings {
  speechRate: number;
  speechPitch: number;
  showTextOverlay: boolean;
}

const DEFAULTS: AppSettings = {
  speechRate: 1.0,
  speechPitch: 1.0,
  showTextOverlay: true,
};

const KEY = 'app_settings_v2';

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) } as AppSettings;
  } catch (_) {}
  return { ...DEFAULTS };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(settings));
}

export function settingsToTTSConfig(s: AppSettings): TTSConfig {
  return {
    provider: 'device',
    rate: s.speechRate,
    pitch: s.speechPitch,
  };
}
