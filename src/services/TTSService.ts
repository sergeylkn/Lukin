/**
 * TTSService — converts text to speech using device TTS engine.
 *
 * Provider priority:
 *  1. ElevenLabs  — key stored; used for future audio player integration
 *  2. OpenAI TTS  — key stored; used for future audio player integration
 *  3. Expo Speech — free, uses device TTS engine (always available)
 *
 * Note: ElevenLabs / OpenAI providers currently fall back to device TTS.
 * Binary audio playback will be added once expo-audio is stable in SDK 52.
 */

import * as Speech from 'expo-speech';

export type TTSProvider = 'elevenlabs' | 'openai' | 'device';

export interface TTSConfig {
  provider: TTSProvider;
  elevenLabsApiKey?: string;
  elevenLabsVoiceId?: string;
  openAiApiKey?: string;
  openAiVoice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  rate?: number; // 0.5 – 2.0, default 1.0
  pitch?: number; // 0.5 – 2.0, default 1.0
}

// ElevenLabs voice IDs with good Russian support
export const ELEVENLABS_VOICES = [
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda (женский, нейтральный)' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh (мужской, глубокий)' },
  { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill (мужской, спокойный)' },
  { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum (мужской, динамичный)' },
];

export async function speak(text: string, config: TTSConfig): Promise<void> {
  if (!text.trim()) return;

  Speech.stop();
  Speech.speak(text, {
    language: 'ru-RU',
    rate: config.rate ?? 1.0,
    pitch: config.pitch ?? 1.0,
  });
}

export async function stopSpeaking(): Promise<void> {
  Speech.stop();
}
