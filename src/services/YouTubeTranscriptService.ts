/**
 * YouTubeTranscriptService
 *
 * Uses YouTube's internal InnerTube API (youtubei/v1/player) to get
 * caption tracks. This is more reliable from Android than HTML scraping,
 * which YouTube blocks with bot detection.
 *
 * Translation is free via YouTube's tlang=ru parameter on the timedtext API.
 */

export interface CaptionSegment {
  start: number;       // seconds from video start
  dur: number;         // duration in seconds
  text: string;        // original text
  translation?: string; // Russian (from YouTube tlang=ru, free)
}

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

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

/**
 * Fetch player data via YouTube InnerTube API.
 * This works reliably from Android (no bot detection, returns JSON directly).
 */
async function fetchPlayerData(videoId: string): Promise<CaptionTrack[]> {
  // Try Web client first, fall back to Android client
  const clients = [
    {
      clientName: 'WEB',
      clientVersion: '2.20240101.00.00',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': '2.20240101.00.00',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    },
    {
      clientName: 'ANDROID',
      clientVersion: '18.11.34',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/18.11.34 (Linux; U; Android 11) gzip',
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': '18.11.34',
      },
    },
  ];

  let lastError: Error | null = null;

  for (const client of clients) {
    try {
      const body = JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: client.clientName,
            clientVersion: client.clientVersion,
            hl: 'en',
            gl: 'US',
          },
        },
      });

      const res = await fetch(
        'https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false',
        { method: 'POST', headers: client.headers as any, body },
      );

      if (!res.ok) {
        lastError = new Error(`InnerTube ${client.clientName} returned ${res.status}`);
        continue;
      }

      const data = await res.json();
      const tracks: any[] =
        data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

      if (tracks.length === 0) {
        lastError = new Error('no_captions');
        continue;
      }

      return tracks.map((t: any) => ({
        baseUrl: t.baseUrl as string,
        languageCode: (t.languageCode as string) ?? '',
        kind: t.kind,
      }));
    } catch (e: any) {
      lastError = e;
    }
  }

  if (lastError?.message === 'no_captions') {
    throw new Error(
      'У этого видео нет субтитров. Попробуй видео с авто-субтитрами (большинство англоязычных видео).',
    );
  }
  throw lastError ?? new Error('Не удалось получить данные видео');
}

function pickBestTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (!tracks.length) return null;
  return (
    tracks.find((t) => t.languageCode === 'en' && t.kind === 'asr') ??
    tracks.find((t) => t.languageCode === 'en') ??
    tracks.find((t) => t.languageCode.startsWith('en')) ??
    tracks[0]
  );
}

function parseXml(xml: string): { start: number; dur: number; text: string }[] {
  const results: { start: number; dur: number; text: string }[] = [];
  const regex = /<text\s+start="([\d.]+)"\s+dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(xml)) !== null) {
    const text = decodeHtml(m[3]).trim();
    if (text) results.push({ start: parseFloat(m[1]), dur: parseFloat(m[2]), text });
  }
  return results;
}

async function fetchXml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!res.ok) throw new Error(`Caption fetch returned ${res.status}`);
  return res.text();
}

/** Main entry: fetch captions + Russian translation (both from YouTube, both free) */
export async function fetchTranscript(videoId: string): Promise<CaptionSegment[]> {
  const tracks = await fetchPlayerData(videoId);
  const track = pickBestTrack(tracks);

  if (!track) {
    throw new Error(
      'У этого видео нет субтитров. Попробуй видео с авто-субтитрами.',
    );
  }

  // Strip any existing fmt/tlang params from baseUrl before adding ours
  const cleanBase = track.baseUrl.replace(/&fmt=[^&]*/g, '').replace(/&tlang=[^&]*/g, '');

  const [origXml, ruXml] = await Promise.all([
    fetchXml(cleanBase + '&fmt=xml'),
    fetchXml(cleanBase + '&fmt=xml&tlang=ru').catch(() => ''),
  ]);

  const origSegments = parseXml(origXml);
  const ruSegments = ruXml ? parseXml(ruXml) : [];

  if (!origSegments.length) throw new Error('Субтитры пустые');

  return origSegments.map((seg, i) => ({
    ...seg,
    translation: ruSegments[i]?.text ?? seg.text,
  }));
}
