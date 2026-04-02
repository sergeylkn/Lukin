/**
 * YouTubeTranscriptService
 *
 * Fetches timed captions for a YouTube video without requiring an API key.
 * Uses the publicly accessible /api/timedtext endpoint that YouTube serves
 * to its web player.
 *
 * Flow:
 *  1. Fetch the watch page HTML to find available caption tracks
 *  2. Download the XML caption track (prefer English, fall back to any)
 *  3. Return an array of {start, dur, text} segments
 */

export interface CaptionSegment {
  start: number;   // seconds from video start
  dur: number;     // duration in seconds
  text: string;    // original text
  translation?: string; // filled in later
}

/** Extract a YouTube video ID from any YouTube URL or bare ID */
export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();

  // Already a bare ID (11 chars, alphanumeric + _ -)
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    // youtu.be/VIDEO_ID
    if (url.hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0];
    // youtube.com/watch?v=VIDEO_ID
    const v = url.searchParams.get('v');
    if (v) return v;
    // youtube.com/shorts/VIDEO_ID
    const shorts = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shorts) return shorts[1];
  } catch (_) {}

  // Fallback regex
  const match = trimmed.match(/(?:v=|\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

/** Decode HTML entities in caption text */
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
  name: string;
  kind?: string;
}

/**
 * Parse available caption tracks from the YouTube watch page HTML.
 * YouTube embeds caption metadata in a JSON blob called ytInitialPlayerResponse.
 */
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

  // Extract the JSON blob containing player response
  const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:var |<\/script>)/s);
  if (!match) throw new Error('Could not find ytInitialPlayerResponse in page');

  let playerResponse: any;
  try {
    playerResponse = JSON.parse(match[1]);
  } catch {
    throw new Error('Failed to parse ytInitialPlayerResponse JSON');
  }

  const tracks: CaptionTrackInfo[] =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

  return tracks.map((t: any) => ({
    baseUrl: t.baseUrl as string,
    languageCode: (t.languageCode as string) ?? '',
    name: t.name?.simpleText ?? t.name?.runs?.[0]?.text ?? '',
    kind: t.kind,
  }));
}

/** Choose the best track: prefer English ASR, then English manual, then anything */
function pickBestTrack(tracks: CaptionTrackInfo[]): CaptionTrackInfo | null {
  if (!tracks.length) return null;
  return (
    tracks.find((t) => t.languageCode === 'en' && t.kind === 'asr') ??
    tracks.find((t) => t.languageCode === 'en') ??
    tracks.find((t) => t.languageCode.startsWith('en')) ??
    tracks[0]
  );
}

/** Download and parse the XML caption track */
async function fetchCaptionXml(baseUrl: string): Promise<CaptionSegment[]> {
  const url = baseUrl + '&fmt=xml';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Caption XML returned ${res.status}`);

  const xml = await res.text();

  const segments: CaptionSegment[] = [];
  const regex = /<text\s+start="([\d.]+)"\s+dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(xml)) !== null) {
    const text = decodeHtml(m[3]).trim();
    if (text) {
      segments.push({
        start: parseFloat(m[1]),
        dur: parseFloat(m[2]),
        text,
      });
    }
  }

  return segments;
}

/** Main entry: fetch all timed captions for a video */
export async function fetchTranscript(videoId: string): Promise<CaptionSegment[]> {
  const tracks = await fetchCaptionTracks(videoId);
  const track = pickBestTrack(tracks);

  if (!track) {
    throw new Error(
      'У этого видео нет субтитров. Попробуй видео с авто-субтитрами (большинство англоязычных видео).',
    );
  }

  const segments = await fetchCaptionXml(track.baseUrl);
  if (!segments.length) throw new Error('Субтитры пустые');

  return segments;
}
