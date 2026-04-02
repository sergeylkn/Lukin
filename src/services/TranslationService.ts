/**
 * TranslationService — translates text to Russian via Claude API.
 * Maintains an LRU cache to avoid redundant API calls for identical phrases.
 */

const CACHE_SIZE = 200;
const cache = new Map<string, string>();

function cacheSet(key: string, value: string) {
  if (cache.size >= CACHE_SIZE) {
    // Evict oldest entry
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, value);
}

export async function translateToRussian(
  text: string,
  apiKey: string,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return '';

  const cached = cache.get(trimmed);
  if (cached) return cached;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
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
        'You are a translator. Translate the given subtitle text to Russian. ' +
        'Output ONLY the translated text — no explanations, no quotes, no comments. ' +
        'Keep the tone natural and conversational.',
      messages: [{ role: 'user', content: trimmed }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Translation API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const translation: string = data.content?.[0]?.text?.trim() ?? trimmed;
  cacheSet(trimmed, translation);
  return translation;
}
