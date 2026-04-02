/**
 * PlayerScreen — companion YouTube translator.
 *
 * The user watches YouTube in the native YouTube app while this screen:
 *  1. Accepts a YouTube URL
 *  2. Fetches + pre-translates all captions
 *  3. On "Старт" — plays back translated audio in sync with video timestamps
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Audio } from 'expo-av';

import {
  parseVideoId,
  fetchTranscript,
  CaptionSegment,
} from '../services/YouTubeTranscriptService';
import { translateSegments } from '../services/TranslationService';
import { AudioQueue } from '../services/AudioQueue';
import {
  loadSettings,
  AppSettings,
  settingsToTTSConfig,
} from '../services/SettingsService';

type Stage =
  | 'idle'           // waiting for URL input
  | 'loading'        // fetching captions
  | 'translating'    // translating segments
  | 'ready'          // ready to start playback
  | 'playing'        // playing back translation
  | 'paused'         // paused
  | 'done';          // finished

export function PlayerScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const insets = useSafeAreaInsets();

  const [urlInput, setUrlInput] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [segments, setSegments] = useState<CaptionSegment[]>([]);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [elapsed, setElapsed] = useState(0); // seconds since START pressed

  const audioQueueRef = useRef<AudioQueue | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scheduledRef = useRef<Set<number>>(new Set());

  // Load settings on mount
  useEffect(() => {
    (async () => {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });
      const s = await loadSettings();
      setSettings(s);
      audioQueueRef.current = new AudioQueue(settingsToTTSConfig(s));
    })();
    return () => stopPlayback();
  }, []);

  // ── Paste URL ──────────────────────────────────────────────────────────────

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setUrlInput(text);
  };

  // ── Load & translate ───────────────────────────────────────────────────────

  const handleLoad = useCallback(async () => {
    if (!settings?.anthropicApiKey) {
      Alert.alert('Нет API ключа', 'Укажи Claude API ключ в Настройках');
      return;
    }

    const videoId = parseVideoId(urlInput);
    if (!videoId) {
      Alert.alert('Неверная ссылка', 'Вставь ссылку на YouTube видео');
      return;
    }

    try {
      setStage('loading');
      setProgress({ done: 0, total: 0 });
      setSegments([]);
      setCurrentIdx(-1);

      const rawSegments = await fetchTranscript(videoId);

      setStage('translating');
      setProgress({ done: 0, total: rawSegments.length });

      const translated = await translateSegments(
        rawSegments,
        settings.anthropicApiKey,
        (done, total) => setProgress({ done, total }),
      );

      setSegments(translated);
      setStage('ready');
    } catch (err: any) {
      setStage('idle');
      Alert.alert('Ошибка', err?.message ?? 'Не удалось загрузить субтитры');
    }
  }, [urlInput, settings]);

  // ── Playback ───────────────────────────────────────────────────────────────

  const stopPlayback = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    scheduledRef.current.clear();
    audioQueueRef.current?.stop();
  }, []);

  const startPlayback = useCallback(() => {
    if (!segments.length) return;

    stopPlayback();
    startTimeRef.current = Date.now();
    scheduledRef.current = new Set();
    setCurrentIdx(-1);
    setElapsed(0);
    setStage('playing');

    // Tick every 100ms — schedule segments when their time arrives
    timerRef.current = setInterval(() => {
      const elapsedSec = (Date.now() - startTimeRef.current) / 1000;
      setElapsed(elapsedSec);

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (!scheduledRef.current.has(i) && elapsedSec >= seg.start - 0.1) {
          scheduledRef.current.add(i);
          setCurrentIdx(i);
          const text = seg.translation ?? seg.text;
          if (text && audioQueueRef.current) {
            audioQueueRef.current.enqueue(text);
          }
        }
      }

      // Done when past the last segment
      const last = segments[segments.length - 1];
      if (elapsedSec > last.start + last.dur + 1) {
        if (timerRef.current) clearInterval(timerRef.current);
        setStage('done');
      }
    }, 100);
  }, [segments, stopPlayback]);

  const handlePause = () => {
    stopPlayback();
    setStage('paused');
  };

  const handleResume = () => {
    // Shift start time to account for pause
    startTimeRef.current = Date.now() - elapsed * 1000;
    setStage('playing');

    timerRef.current = setInterval(() => {
      const elapsedSec = (Date.now() - startTimeRef.current) / 1000;
      setElapsed(elapsedSec);

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (!scheduledRef.current.has(i) && elapsedSec >= seg.start - 0.1) {
          scheduledRef.current.add(i);
          setCurrentIdx(i);
          const text = seg.translation ?? seg.text;
          if (text && audioQueueRef.current) {
            audioQueueRef.current.enqueue(text);
          }
        }
      }

      const last = segments[segments.length - 1];
      if (elapsedSec > last.start + last.dur + 1) {
        if (timerRef.current) clearInterval(timerRef.current);
        setStage('done');
      }
    }, 100);
  };

  const handleReset = () => {
    stopPlayback();
    setStage('ready');
    setCurrentIdx(-1);
    setElapsed(0);
    scheduledRef.current = new Set();
  };

  const handleOpenYouTube = () => {
    const videoId = parseVideoId(urlInput);
    if (videoId) Linking.openURL(`https://www.youtube.com/watch?v=${videoId}`);
  };

  // ── Render helpers ─────────────────────────────────────────────────────────

  const currentSeg = currentIdx >= 0 ? segments[currentIdx] : null;
  const progressPct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>▶ YouTube → RU</Text>
        <TouchableOpacity style={styles.settingsBtn} onPress={onOpenSettings}>
          <Text style={styles.settingsBtnText}>⚙️</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* URL input */}
        <View style={styles.card}>
          <Text style={styles.label}>Ссылка на YouTube видео</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="https://youtube.com/watch?v=..."
              placeholderTextColor="#555"
              value={urlInput}
              onChangeText={setUrlInput}
              autoCapitalize="none"
              autoCorrect={false}
              editable={stage === 'idle' || stage === 'ready' || stage === 'done'}
            />
            <TouchableOpacity style={styles.pasteBtn} onPress={handlePaste}>
              <Text style={styles.pasteBtnText}>Вставить</Text>
            </TouchableOpacity>
          </View>

          {(stage === 'idle' || stage === 'done') && (
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              onPress={handleLoad}
              disabled={!urlInput.trim()}
            >
              <Text style={styles.btnText}>Загрузить субтитры</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Loading */}
        {stage === 'loading' && (
          <View style={styles.card}>
            <ActivityIndicator size="large" color="#ff0000" />
            <Text style={styles.statusText}>Загружаем субтитры...</Text>
          </View>
        )}

        {/* Translating */}
        {stage === 'translating' && (
          <View style={styles.card}>
            <ActivityIndicator size="large" color="#ff0000" />
            <Text style={styles.statusText}>
              Переводим... {progress.done}/{progress.total} ({progressPct}%)
            </Text>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
            </View>
          </View>
        )}

        {/* Ready */}
        {(stage === 'ready' || stage === 'paused' || stage === 'playing' || stage === 'done') && (
          <View style={styles.card}>
            <Text style={styles.readyTitle}>
              ✅ Переведено {segments.length} фраз
            </Text>

            {stage === 'ready' && (
              <>
                <Text style={styles.instructions}>
                  1. Нажми «Открыть в YouTube» ниже{'\n'}
                  2. Запусти видео с начала{'\n'}
                  3. Сразу нажми «СТАРТ» здесь
                </Text>
                <TouchableOpacity style={[styles.btn, styles.btnYt]} onPress={handleOpenYouTube}>
                  <Text style={styles.btnText}>▶ Открыть в YouTube</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, styles.btnGreen]} onPress={startPlayback}>
                  <Text style={styles.btnText}>🎙️ СТАРТ (запускай одновременно с видео)</Text>
                </TouchableOpacity>
              </>
            )}

            {stage === 'playing' && (
              <>
                <Text style={styles.timerText}>{formatTime(elapsed)}</Text>
                {currentSeg && (
                  <View style={styles.currentSegBox}>
                    <Text style={styles.originalText}>{currentSeg.text}</Text>
                    <Text style={styles.translatedText}>{currentSeg.translation}</Text>
                  </View>
                )}
                <TouchableOpacity style={[styles.btn, styles.btnOrange]} onPress={handlePause}>
                  <Text style={styles.btnText}>⏸ Пауза</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={handleReset}>
                  <Text style={styles.btnTextGhost}>↺ Сначала</Text>
                </TouchableOpacity>
              </>
            )}

            {stage === 'paused' && (
              <>
                <Text style={styles.timerText}>{formatTime(elapsed)} — пауза</Text>
                <TouchableOpacity style={[styles.btn, styles.btnGreen]} onPress={handleResume}>
                  <Text style={styles.btnText}>▶ Продолжить</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={handleReset}>
                  <Text style={styles.btnTextGhost}>↺ Сначала</Text>
                </TouchableOpacity>
              </>
            )}

            {stage === 'done' && (
              <>
                <Text style={styles.statusText}>✅ Видео завершено</Text>
                <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleReset}>
                  <Text style={styles.btnText}>↺ Смотреть снова</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* Transcript preview */}
        {segments.length > 0 && stage !== 'loading' && stage !== 'translating' && (
          <View style={styles.card}>
            <Text style={styles.label}>Первые фразы перевода:</Text>
            {segments.slice(0, 5).map((seg, i) => (
              <View key={i} style={styles.segRow}>
                <Text style={styles.segTime}>{formatTime(seg.start)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.segOriginal}>{seg.text}</Text>
                  <Text style={styles.segTranslation}>{seg.translation}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  settingsBtn: { padding: 8 },
  settingsBtnText: { fontSize: 22 },
  scroll: { padding: 16, gap: 16, paddingBottom: 60 },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  label: { color: '#888', fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
  inputRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: '#252525',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
  },
  pasteBtn: {
    backgroundColor: '#333',
    borderRadius: 8,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  pasteBtnText: { color: '#ccc', fontSize: 13 },
  btn: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: '#cc0000' },
  btnGreen: { backgroundColor: '#1a7a1a' },
  btnYt: { backgroundColor: '#1a1a7a' },
  btnOrange: { backgroundColor: '#7a4a00' },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#444',
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnTextGhost: { color: '#888', fontSize: 14 },
  statusText: { color: '#aaa', textAlign: 'center', fontSize: 14 },
  progressBar: {
    height: 6,
    backgroundColor: '#333',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#cc0000' },
  readyTitle: { color: '#4caf50', fontSize: 15, fontWeight: '700' },
  instructions: {
    color: '#bbb',
    fontSize: 14,
    lineHeight: 22,
    backgroundColor: '#252525',
    borderRadius: 8,
    padding: 12,
  },
  timerText: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '700',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  currentSegBox: {
    backgroundColor: '#252525',
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  originalText: { color: '#888', fontSize: 13 },
  translatedText: { color: '#fff', fontSize: 18, fontWeight: '500', lineHeight: 26 },
  segRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a2a',
  },
  segTime: { color: '#555', fontSize: 12, width: 36, paddingTop: 2 },
  segOriginal: { color: '#666', fontSize: 12 },
  segTranslation: { color: '#ccc', fontSize: 14 },
});
