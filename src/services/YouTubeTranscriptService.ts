/**
 * YouTubeTranscriptService
 *
 * Uses YouTube's InnerTube API to get caption tracks.
 * Tries multiple clients in order of reliability.
 * Translation via YouTube's tlang=ru (free, Google Translate built-in).
 */

export interface CaptionSegment {
  start: number;
  dur: number;
  text: string;
  translation?: string;
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

// InnerTube clients in order of preference
// Each has different bot detection behaviour; IOS/TVHTML5 bypass most restrictions
const INNERTUBE_CLIENTS = [
  // IOS client — no API key needed, minimal bot detection
  {
    name: 'IOS',
    url: 'https://www.youtube.com/youtubei/v1/player',
    context: { clientName: 'IOS', clientVersion: '19.09.3', deviceModel: 'iPhone14,3', osName: 'iPhone', osVersion: '16.1.0' },
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 16_1 like Mac OS X)',
      'X-YouTube-Client-Name': '5',
      'X-YouTube-Client-Version': '19.09.3',
    },
  },
  // WEB client with public API key
  {
    name: 'WEB',
    url: 'https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    context: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en', gl: 'US' },
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20240101.00.00',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://www.youtube.com',
    },
  },
  // TVHTML5 embedded — very permissive, often bypasses geo/age restrictions
  {
    name: 'TV',
    url: 'https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    context: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', clientScreen: 'EMBED' },
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1',
      'X-YouTube-Client-Name': '85',
    },
  },
];

async function fetchPlayerData(videoId: string): Promise<CaptionTrack[]> {
  let lastError: Error = new Error('Не удалось получить данные видео');

  for (const client of INNERTUBE_CLIENTS) {
    try {
      const res = await fetch(client.url, {
        method: 'POST',
        headers: client.headers as any,
        body: JSON.stringify({ videoId, context: { client: client.context } }),
      });

      if (!res.ok) {
        lastError = new Error(`InnerTube ${client.name} вернул ${res.status}`);
        continue;
      }

      const data = await res.json();
      const tracks: any[] =
        data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

      if (tracks.length > 0) {
        return tracks.map((t: any) => ({
          baseUrl: t.baseUrl as string,
          languageCode: (t.languageCode as string) ?? '',
          kind: t.kind,
        }));
      }

      // Video exists but has no captions — don't try other clients
      const title = data?.videoDetails?.title;
      if (title) {
        throw new Error(
          `Видео "${title}" не имеет субтитров. Попробуй другое видео с авто-субтитрами.`,
        );
      }

      // Bot-detected / unexpected response — try next client
      lastError = new Error(`${client.name}: нет субтитров в ответе`);
    } catch (e: any) {
      if (e.message?.includes('Видео') && e.message?.includes('субтитров')) throw e;
      lastError = e;
    }
  }

  throw lastError;
}

function pickBestTrack(tracks: CaptionTrack[]): CaptionTrack {
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
  const res = await fetch(url, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
  if (!res.ok) throw new Error(`Caption fetch returned ${res.status}`);
  return res.text();
}

export async function fetchTranscript(videoId: string): Promise<CaptionSegment[]> {
  const tracks = await fetchPlayerData(videoId);
  const track = pickBestTrack(tracks);

  const cleanBase = track.baseUrl
    .replace(/&fmt=[^&]*/g, '')
    .replace(/&tlang=[^&]*/g, '');

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
