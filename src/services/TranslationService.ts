/**
 * TranslationService — translates text to Russian via Claude API.
 * Batch-translates an array of segments to reduce API calls.
 */

import { CaptionSegment } from './YouTubeTranscriptService';

const CACHE = new Map<string, string>();
const BATCH_SIZE = 30;

/** Translate a single phrase */
export async function translateToRussian(text: string, apiKey: string): Promise<string> {
  const key = text.trim();
  if (!key) return '';
  if (CACHE.has(key)) return CACHE.get(key)!;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system:
        'Translate the subtitle text to Russian. ' +
        'Output ONLY the translated text — no explanations, quotes, or comments. ' +
        'Keep it natural and conversational.',
      messages: [{ role: 'user', content: key }],
    }),
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  const translation = data.content?.[0]?.text?.trim() ?? key;
  CACHE.set(key, translation);
  return translation;
}

/** Batch-translate all segments. Calls onProgress after each batch. */
export async function translateSegments(
  segments: CaptionSegment[],
  apiKey: string,
  onProgress: (done: number, total: number) => void,
): Promise<CaptionSegment[]> {
  const result = segments.map((s) => ({ ...s }));

  for (let i = 0; i < result.length; i += BATCH_SIZE) {
    const batch = result.slice(i, i + BATCH_SIZE);

    // Build a numbered list for Claude to translate in one call
    const numbered = batch.map((s, idx) => `${idx + 1}. ${s.text}`).join('\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system:
          'You are translating YouTube subtitles to Russian. ' +
          'Translate each numbered line and return them in the same format: "1. <translation>\\n2. <translation>..." ' +
          'Output ONLY the numbered translations, nothing else.',
        messages: [{ role: 'user', content: numbered }],
      }),
    });

    if (!res.ok) {
      // Fall back to individual translation on error
      for (const seg of batch) {
        seg.translation = await translateToRussian(seg.text, apiKey);
      }
    } else {
      const data = await res.json();
      const responseText: string = data.content?.[0]?.text ?? '';
      const lines = responseText.split('\n').filter((l) => /^\d+\./.test(l));

      batch.forEach((seg, idx) => {
        const line = lines[idx];
        if (line) {
          seg.translation = line.replace(/^\d+\.\s*/, '').trim();
          CACHE.set(seg.text, seg.translation);
        } else {
          seg.translation = seg.text; // fallback
        }
      });
    }

    onProgress(Math.min(i + BATCH_SIZE, result.length), result.length);

    // Small delay to avoid rate limits
    if (i + BATCH_SIZE < result.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return result;
}
