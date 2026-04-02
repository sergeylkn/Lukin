/**
 * AudioQueue — ensures translations are spoken one at a time.
 * New subtitle arrives → current speech is interrupted → new phrase starts.
 * This matches the behaviour of real-time dubbing.
 */

import { speak, stopSpeaking, TTSConfig } from './TTSService';

export class AudioQueue {
  private config: TTSConfig;
  private processing = false;
  private pendingText: string | null = null;

  constructor(config: TTSConfig) {
    this.config = config;
  }

  updateConfig(config: TTSConfig) {
    this.config = config;
  }

  /**
   * Enqueue a new phrase. If audio is playing, it will be cut off
   * and replaced by the new text (real-time translation mode).
   */
  enqueue(text: string) {
    this.pendingText = text;
    if (!this.processing) {
      void this.processNext();
    }
  }

  private async processNext() {
    if (this.pendingText === null) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const text = this.pendingText;
    this.pendingText = null;

    await stopSpeaking();
    try {
      await speak(text, this.config);
    } catch (err) {
      console.warn('AudioQueue speak error:', err);
    }

    // Check if a new phrase arrived while we were speaking
    void this.processNext();
  }

  async stop() {
    this.pendingText = null;
    await stopSpeaking();
    this.processing = false;
  }
}
