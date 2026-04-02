/**
 * TTSService — converts text to speech.
 *
 * Provider priority:
 *  1. ElevenLabs  — highest quality Russian voice (requires API key)
 *  2. OpenAI TTS  — very good quality (requires API key)
 *  3. Expo Speech — free, uses device TTS engine (always available)
 */

import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';

export type TTSProvider = 'elevenlabs' | 'openai' | 'device';

export interface TTSConfig {
  provider: TTSProvider;
  elevenLabsApiKey?: string;
  elevenLabsVoiceId?: string; // default: high-quality Russian voice
  openAiApiKey?: string;
  openAiVoice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  rate?: number; // 0.5 – 2.0, default 1.0
  pitch?: number; // 0.5 – 2.0, default 1.0
}

// ElevenLabs voice IDs with good Russian support
// "Voz" is a multilingual model that speaks Russian natively
export const ELEVENLABS_VOICES = [
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda (женский, нейтральный)' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh (мужской, глубокий)' },
  { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill (мужской, спокойный)' },
  { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum (мужской, динамичный)' },
];

const DEFAULT_ELEVENLABS_VOICE = 'XrExE9yKIg1WjnnlVkGX';

let soundObject: Audio.Sound | null = null;

async function stopCurrentAudio() {
  if (soundObject) {
    try {
      await soundObject.stopAsync();
      await soundObject.unloadAsync();
    } catch (_) {
      // ignore
    }
    soundObject = null;
  }
  Speech.stop();
}

async function speakElevenLabs(text: string, config: TTSConfig): Promise<void> {
  const voiceId = config.elevenLabsVoiceId ?? DEFAULT_ELEVENLABS_VOICE;
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': config.elevenLabsApiKey!,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    },
  );

  if (!response.ok) {
    const msg = await response.text();
    throw new Error(`ElevenLabs error ${response.status}: ${msg}`);
  }

  // Decode audio data from ArrayBuffer
  const arrayBuffer = await response.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);
  const uri = `data:audio/mpeg;base64,${base64}`;

  await stopCurrentAudio();
  const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
  soundObject = sound;
}

async function speakOpenAI(text: string, config: TTSConfig): Promise<void> {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openAiApiKey}`,
    },
    body: JSON.stringify({
      model: 'tts-1-hd',
      input: text,
      voice: config.openAiVoice ?? 'nova',
      speed: config.rate ?? 1.0,
    }),
  });

  if (!response.ok) {
    const msg = await response.text();
    throw new Error(`OpenAI TTS error ${response.status}: ${msg}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);
  const uri = `data:audio/mpeg;base64,${base64}`;

  await stopCurrentAudio();
  const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
  soundObject = sound;
}

function speakDevice(text: string, config: TTSConfig): void {
  Speech.stop();
  Speech.speak(text, {
    language: 'ru-RU',
    rate: config.rate ?? 1.0,
    pitch: config.pitch ?? 1.0,
  });
}

export async function speak(text: string, config: TTSConfig): Promise<void> {
  if (!text.trim()) return;

  try {
    if (config.provider === 'elevenlabs' && config.elevenLabsApiKey) {
      await speakElevenLabs(text, config);
      return;
    }
    if (config.provider === 'openai' && config.openAiApiKey) {
      await speakOpenAI(text, config);
      return;
    }
  } catch (err) {
    console.warn('Primary TTS failed, falling back to device TTS:', err);
  }

  speakDevice(text, config);
}

export async function stopSpeaking(): Promise<void> {
  await stopCurrentAudio();
}

// ── Utility ───────────────────────────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
