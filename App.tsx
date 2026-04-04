import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  NativeModules,
  AppState,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

const { OverlayModule } = NativeModules;

type Lang = 'ru' | 'uk';

function MainScreen() {
  const insets = useSafeAreaInsets();
  const [canOverlay, setCanOverlay] = useState(false);
  const [accessEnabled, setAccessEnabled] = useState(false);
  const [overlayRunning, setOverlayRunning] = useState(false);
  const [lang, setLang] = useState<Lang>('ru');
  const [testVideoId, setTestVideoId] = useState('');
  const [testResult, setTestResult] = useState('');
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    if (!OverlayModule) return;
    const [overlay, access] = await Promise.all([
      OverlayModule.canDrawOverlays(),
      OverlayModule.isAccessibilityEnabled(),
    ]);
    setCanOverlay(overlay);
    setAccessEnabled(access);
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const handleStart = async () => {
    if (!canOverlay) {
      await OverlayModule.openOverlaySettings();
      return;
    }
    await OverlayModule.startOverlay();
    setOverlayRunning(true);
  };

  const handleStop = async () => {
    await OverlayModule.stopOverlay();
    setOverlayRunning(false);
  };

  const handleTest = async () => {
    const videoId = testVideoId.trim().replace(/.*[?&]v=([^&]+).*/, '$1').replace(/.*youtu\.be\/([^?]+).*/, '$1');
    if (!videoId || videoId.length !== 11) {
      setTestResult('⚠ Введи корректный video ID (11 символов) или URL');
      return;
    }
    setTesting(true);
    setTestResult('⏳ Загружаю...');
    try {
      await OverlayModule.startOverlay();
      setOverlayRunning(true);
      // Send video ID to running overlay service via native module
      await OverlayModule.testVideoId(videoId);
      setTestResult(`✓ ID отправлен: ${videoId}\nСмотри результат в оверлее`);
    } catch (e: any) {
      setTestResult(`⚠ ${e?.message ?? String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>▶ YouTube Переводчик</Text>
        <Text style={styles.headerSub}>Голосовой перевод поверх любых приложений</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>

        <Text style={styles.sectionLabel}>РАЗРЕШЕНИЯ</Text>

        <PermCard
          icon="🪟"
          title="Отображение поверх приложений"
          desc="Нужно для плавающего окна с переводом"
          done={canOverlay}
          onPress={() => OverlayModule.openOverlaySettings()}
        />

        <PermCard
          icon="♿"
          title="Специальные возможности"
          desc={
            'Авто-определение видео в Chrome, Firefox\n' +
            'и YouTube. Включи «YouTube Переводчик»\n' +
            'в Настройки → Спец. возможности.'
          }
          done={accessEnabled}
          onPress={() => OverlayModule.openAccessibilitySettings()}
        />

        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>ЯЗЫК ПЕРЕВОДА</Text>

        <View style={styles.langRow}>
          {(['ru', 'uk'] as Lang[]).map((l) => (
            <TouchableOpacity
              key={l}
              style={[styles.langBtn, lang === l && styles.langBtnActive]}
              onPress={() => setLang(l)}
            >
              <Text style={[styles.langBtnText, lang === l && styles.langBtnTextActive]}>
                {l === 'ru' ? '🇷🇺  Русский' : '🇺🇦  Украинский'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>ОВЕРЛЕЙ</Text>

        {!overlayRunning ? (
          <TouchableOpacity
            style={[styles.bigBtn, !canOverlay && styles.bigBtnWarn]}
            onPress={handleStart}
          >
            <Text style={styles.bigBtnText}>
              {canOverlay ? '▶  Запустить оверлей' : '⚙  Выдать разрешение и запустить'}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.bigBtn, styles.bigBtnStop]} onPress={handleStop}>
            <Text style={styles.bigBtnText}>⏹  Остановить оверлей</Text>
          </TouchableOpacity>
        )}

        {/* ── TEST PANEL ─────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>ТЕСТ СУБТИТРОВ</Text>
        <View style={styles.testBox}>
          <Text style={styles.testHint}>
            Вставь YouTube URL или video ID (11 симв.) — оверлей попытается загрузить субтитры и покажет результат прямо в плавающем окне
          </Text>
          <TextInput
            style={styles.testInput}
            placeholder="https://youtu.be/mgnAjAebtP8 или mgnAjAebtP8"
            placeholderTextColor="#444"
            value={testVideoId}
            onChangeText={setTestVideoId}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={[styles.bigBtn, { marginTop: 8 }]}
            onPress={handleTest}
            disabled={testing}
          >
            {testing
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.bigBtnText}>🧪  Проверить субтитры</Text>}
          </TouchableOpacity>
          {testResult ? (
            <View style={styles.testResult}>
              <Text style={styles.testResultText}>{testResult}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.howTo}>
          <Text style={styles.howToTitle}>КАК ИСПОЛЬЗОВАТЬ</Text>
          {[
            'Выдай оба разрешения выше',
            'Нажми «Запустить оверлей» — появится плавающее окно',
            'Открой YouTube в Chrome/Firefox — перевод запустится сам',
            'Или нажми «Поделиться» в YouTube → «YouTube Переводчик»',
            'Нажми ▶ в оверлее одновременно с запуском видео',
            'Переключай язык кнопкой RU/UK прямо в оверлее',
          ].map((text, i) => (
            <View key={i} style={styles.howToRow}>
              <View style={styles.howToNum}>
                <Text style={styles.howToNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.howToText}>{text}</Text>
            </View>
          ))}
        </View>

      </ScrollView>
    </View>
  );
}

function PermCard({
  icon, title, desc, done, onPress,
}: {
  icon: string; title: string; desc: string; done: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[styles.card, done && styles.cardDone]} onPress={onPress}>
      <Text style={styles.cardIcon}>{icon}</Text>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardDesc}>{desc}</Text>
      </View>
      <Text style={done ? styles.cardOk : styles.cardNo}>{done ? '✓' : '→'}</Text>
    </TouchableOpacity>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MainScreen />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    paddingHorizontal: 20, paddingVertical: 20,
    borderBottomWidth: 1, borderBottomColor: '#1e1e1e',
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  headerSub: { color: '#666', fontSize: 13, marginTop: 4 },
  scroll: { padding: 16, paddingBottom: 60 },
  sectionLabel: {
    color: '#555', fontSize: 11, fontWeight: '700',
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10,
  },
  card: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#161616', borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#222',
  },
  cardDone: { borderColor: '#1a3a1a' },
  cardIcon: { fontSize: 22, marginRight: 12, paddingTop: 2 },
  cardBody: { flex: 1 },
  cardTitle: { color: '#ddd', fontSize: 14, fontWeight: '600', marginBottom: 4 },
  cardDesc: { color: '#666', fontSize: 12, lineHeight: 18 },
  cardOk: { color: '#4caf50', fontSize: 18, fontWeight: '700', marginLeft: 8 },
  cardNo: { color: '#ff5555', fontSize: 18, fontWeight: '700', marginLeft: 8 },
  langRow: { flexDirection: 'row', gap: 10 },
  langBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    backgroundColor: '#161616', alignItems: 'center',
    borderWidth: 1, borderColor: '#222',
  },
  langBtnActive: { backgroundColor: '#0d0d2e', borderColor: '#3333aa' },
  langBtnText: { color: '#666', fontSize: 14, fontWeight: '600' },
  langBtnTextActive: { color: '#fff' },
  bigBtn: {
    backgroundColor: '#0d1a0d', borderRadius: 14,
    paddingVertical: 18, alignItems: 'center',
    borderWidth: 1, borderColor: '#4caf50',
  },
  bigBtnWarn: { backgroundColor: '#1a1000', borderColor: '#ff9800' },
  bigBtnStop: { backgroundColor: '#1a0000', borderColor: '#cc0000' },
  bigBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  howTo: { marginTop: 28, backgroundColor: '#111', borderRadius: 12, padding: 16 },
  howToTitle: {
    color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 1.2,
    textTransform: 'uppercase', marginBottom: 14,
  },
  howToRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  howToNum: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#1e1e1e', alignItems: 'center', justifyContent: 'center',
    marginRight: 12, marginTop: 1,
  },
  howToNumText: { color: '#aaa', fontSize: 12, fontWeight: '700' },
  howToText: { color: '#888', fontSize: 13, flex: 1, lineHeight: 20 },
  testBox: { backgroundColor: '#111', borderRadius: 12, padding: 14, marginBottom: 10 },
  testHint: { color: '#555', fontSize: 12, lineHeight: 18, marginBottom: 12 },
  testInput: {
    backgroundColor: '#0a0a0a', borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a',
    color: '#fff', fontSize: 13, paddingHorizontal: 12, paddingVertical: 10,
  },
  testResult: { marginTop: 10, backgroundColor: '#0a0a0a', borderRadius: 8, padding: 10 },
  testResultText: { color: '#aaa', fontSize: 12, lineHeight: 18 },
});
