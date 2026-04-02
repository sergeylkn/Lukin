/**
 * SettingsService — persists user settings securely on the device.
 */

import * as SecureStore from 'expo-secure-store';
import { TTSConfig, TTSProvider } from './TTSService';

export interface AppSettings {
  anthropicApiKey: string;
  ttsProvider: TTSProvider;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  openAiApiKey: string;
  openAiVoice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  speechRate: number;
  speechPitch: number;
  translationEnabled: boolean;
  showTextOverlay: boolean;
}

const DEFAULTS: AppSettings = {
  anthropicApiKey: '',
  ttsProvider: 'device',
  elevenLabsApiKey: '',
  elevenLabsVoiceId: 'XrExE9yKIg1WjnnlVkGX',
  openAiApiKey: '',
  openAiVoice: 'nova',
  speechRate: 1.0,
  speechPitch: 1.0,
  translationEnabled: true,
  showTextOverlay: true,
};

const KEY = 'app_settings_v1';

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) {
      return { ...DEFAULTS, ...JSON.parse(raw) } as AppSettings;
    }
  } catch (_) {}
  return { ...DEFAULTS };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(settings));
}

export function settingsToTTSConfig(s: AppSettings): TTSConfig {
  return {
    provider: s.ttsProvider,
    elevenLabsApiKey: s.elevenLabsApiKey,
    elevenLabsVoiceId: s.elevenLabsVoiceId,
    openAiApiKey: s.openAiApiKey,
    openAiVoice: s.openAiVoice,
    rate: s.speechRate,
    pitch: s.speechPitch,
  };
}
