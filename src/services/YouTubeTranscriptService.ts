/**
 * YouTubeTranscriptService
 *
 * Fetches timed captions for a YouTube video without requiring an API key.
 * Uses the publicly accessible /api/timedtext endpoint.
 *
 * Translation is also free: YouTube's timedtext API accepts &tlang=ru
 * which returns Google-translated captions in Russian — no key needed.
 *
 * Flow:
 *  1. Fetch the watch page HTML to find available caption tracks
 *  2. Download original + Russian captions in parallel (both from YouTube)
 *  3. Return segments with {start, dur, text (original), translation (Russian)}
 */

export interface CaptionSegment {
  start: number;       // seconds from video start
  dur: number;         // duration in seconds
  text: string;        // original text
  translation?: string; // Russian translation (from YouTube tlang=ru)
}

/** Extract a YouTube video ID from any YouTube URL or bare ID */
export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0];
    const v = url.searchParams.get('v');
    if (v) return v;
    const shorts = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shorts) return shorts[1];
  } catch (_) {}

  const match = trimmed.match(/(?:v=|\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function decodeHtml(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, '');
}

interface CaptionTrackInfo {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

async function fetchCaptionTracks(videoId: string): Promise<CaptionTrackInfo[]> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!res.ok) throw new Error(`YouTube page returned ${res.status}`);

  const html = await res.text();
  const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:var |<\/script>)/s);
  if (!match) throw new Error('Could not find ytInitialPlayerResponse in page');

  let playerResponse: any;
  try {
    playerResponse = JSON.parse(match[1]);
  } catch {
    throw new Error('Failed to parse ytInitialPlayerResponse JSON');
  }

  const tracks: any[] =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

  return tracks.map((t: any) => ({
    baseUrl: t.baseUrl as string,
    languageCode: (t.languageCode as string) ?? '',
    kind: t.kind,
  }));
}

function pickBestTrack(tracks: CaptionTrackInfo[]): CaptionTrackInfo | null {
  if (!tracks.length) return null;
  return (
    tracks.find((t) => t.languageCode === 'en' && t.kind === 'asr') ??
    tracks.find((t) => t.languageCode === 'en') ??
    tracks.find((t) => t.languageCode.startsWith('en')) ??
    tracks[0]
  );
}

/** Parse XML caption track, return texts in order */
function parseXml(xml: string): { start: number; dur: number; text: string }[] {
  const results: { start: number; dur: number; text: string }[] = [];
  const regex = /<text\s+start="([\d.]+)"\s+dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(xml)) !== null) {
    const text = decodeHtml(m[3]).trim();
    if (text) {
      results.push({ start: parseFloat(m[1]), dur: parseFloat(m[2]), text });
    }
  }
  return results;
}

async function fetchXml(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Caption fetch returned ${res.status}`);
  return res.text();
}

/** Main entry: fetch captions + Russian translation (both from YouTube, both free) */
export async function fetchTranscript(videoId: string): Promise<CaptionSegment[]> {
  const tracks = await fetchCaptionTracks(videoId);
  const track = pickBestTrack(tracks);

  if (!track) {
    throw new Error(
      'У этого видео нет субтитров. Попробуй видео с авто-субтитрами (большинство англоязычных видео).',
    );
  }

  const baseUrl = track.baseUrl;

  // Fetch original and Russian translation in parallel — both free via YouTube
  const [origXml, ruXml] = await Promise.all([
    fetchXml(baseUrl + '&fmt=xml'),
    fetchXml(baseUrl + '&fmt=xml&tlang=ru').catch(() => ''),
  ]);

  const origSegments = parseXml(origXml);
  const ruSegments = ruXml ? parseXml(ruXml) : [];

  if (!origSegments.length) throw new Error('Субтитры пустые');

  return origSegments.map((seg, i) => ({
    ...seg,
    translation: ruSegments[i]?.text ?? seg.text,
  }));
}
