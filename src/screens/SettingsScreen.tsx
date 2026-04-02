/**
 * SettingsScreen — configure API keys, TTS provider, voice options.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  loadSettings,
  saveSettings,
  AppSettings,
} from '../services/SettingsService';
import { ELEVENLABS_VOICES, TTSProvider } from '../services/TTSService';

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings().then(setS);
  }, []);

  if (!s) return null;

  const update = (patch: Partial<AppSettings>) => setS({ ...s, ...patch });

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings(s);
      Alert.alert('Сохранено', 'Настройки сохранены успешно.');
      onBack();
    } catch (err: any) {
      Alert.alert('Ошибка', err?.message ?? 'Не удалось сохранить настройки');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={[styles.container, { paddingTop: insets.top }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Назад</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Настройки</Text>
          <View style={{ width: 80 }} />
        </View>

        {/* General */}
        <Section title="Основные">
          <Row label="Перевод включён">
            <Switch
              value={s.translationEnabled}
              onValueChange={(v) => update({ translationEnabled: v })}
              trackColor={{ true: '#ff0000' }}
            />
          </Row>
          <Row label="Показывать текст">
            <Switch
              value={s.showTextOverlay}
              onValueChange={(v) => update({ showTextOverlay: v })}
              trackColor={{ true: '#ff0000' }}
            />
          </Row>
        </Section>

        {/* Claude API */}
        <Section title="Claude API (для перевода)">
          <Text style={styles.hint}>
            Получите ключ на console.anthropic.com
          </Text>
          <TextInput
            style={styles.input}
            placeholder="sk-ant-api03-..."
            placeholderTextColor="#555"
            value={s.anthropicApiKey}
            onChangeText={(v) => update({ anthropicApiKey: v })}
            secureTextEntry
            autoCapitalize="none"
          />
        </Section>

        {/* TTS Provider */}
        <Section title="Голос (TTS)">
          {(['elevenlabs', 'openai', 'device'] as TTSProvider[]).map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.radioRow, s.ttsProvider === p && styles.radioRowActive]}
              onPress={() => update({ ttsProvider: p })}
            >
              <View style={[styles.radio, s.ttsProvider === p && styles.radioSelected]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.radioLabel}>
                  {p === 'elevenlabs' && '🎙️ ElevenLabs — лучшее качество'}
                  {p === 'openai' && '🤖 OpenAI TTS — очень хорошее'}
                  {p === 'device' && '📱 Системный голос — бесплатно'}
                </Text>
                <Text style={styles.radioHint}>
                  {p === 'elevenlabs' && 'Требует API ключ ElevenLabs'}
                  {p === 'openai' && 'Требует API ключ OpenAI'}
                  {p === 'device' && 'Использует TTS движок Android'}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </Section>

        {/* ElevenLabs */}
        {s.ttsProvider === 'elevenlabs' && (
          <Section title="ElevenLabs">
            <Text style={styles.hint}>Ключ на elevenlabs.io</Text>
            <TextInput
              style={styles.input}
              placeholder="API Key..."
              placeholderTextColor="#555"
              value={s.elevenLabsApiKey}
              onChangeText={(v) => update({ elevenLabsApiKey: v })}
              secureTextEntry
              autoCapitalize="none"
            />
            <Text style={styles.label}>Голос:</Text>
            {ELEVENLABS_VOICES.map((v) => (
              <TouchableOpacity
                key={v.id}
                style={[
                  styles.radioRow,
                  s.elevenLabsVoiceId === v.id && styles.radioRowActive,
                ]}
                onPress={() => update({ elevenLabsVoiceId: v.id })}
              >
                <View
                  style={[
                    styles.radio,
                    s.elevenLabsVoiceId === v.id && styles.radioSelected,
                  ]}
                />
                <Text style={styles.radioLabel}>{v.name}</Text>
              </TouchableOpacity>
            ))}
          </Section>
        )}

        {/* OpenAI */}
        {s.ttsProvider === 'openai' && (
          <Section title="OpenAI TTS">
            <Text style={styles.hint}>Ключ на platform.openai.com</Text>
            <TextInput
              style={styles.input}
              placeholder="sk-..."
              placeholderTextColor="#555"
              value={s.openAiApiKey}
              onChangeText={(v) => update({ openAiApiKey: v })}
              secureTextEntry
              autoCapitalize="none"
            />
            <Text style={styles.label}>Голос:</Text>
            {(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const).map(
              (v) => (
                <TouchableOpacity
                  key={v}
                  style={[
                    styles.radioRow,
                    s.openAiVoice === v && styles.radioRowActive,
                  ]}
                  onPress={() => update({ openAiVoice: v })}
                >
                  <View
                    style={[styles.radio, s.openAiVoice === v && styles.radioSelected]}
                  />
                  <Text style={styles.radioLabel}>{v}</Text>
                </TouchableOpacity>
              ),
            )}
          </Section>
        )}

        {/* Speech rate */}
        <Section title="Скорость речи">
          <View style={styles.rateRow}>
            {[0.75, 1.0, 1.25, 1.5].map((r) => (
              <TouchableOpacity
                key={r}
                style={[
                  styles.rateBtn,
                  s.speechRate === r && styles.rateBtnActive,
                ]}
                onPress={() => update({ speechRate: r })}
              >
                <Text
                  style={[
                    styles.rateBtnText,
                    s.speechRate === r && styles.rateBtnTextActive,
                  ]}
                >
                  {r}x
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Section>

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.saveBtnText}>{saving ? 'Сохранение...' : 'Сохранить'}</Text>
        </TouchableOpacity>

        <View style={{ height: insets.bottom + 20 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  content: { paddingBottom: 40 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  backBtn: { width: 80 },
  backBtnText: { color: '#ff5555', fontSize: 15 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  section: { marginTop: 24, paddingHorizontal: 16 },
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  sectionBody: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a2a',
  },
  rowLabel: { color: '#ddd', fontSize: 15 },
  hint: { color: '#666', fontSize: 12, marginBottom: 8, paddingHorizontal: 4 },
  label: { color: '#888', fontSize: 13, marginTop: 12, marginBottom: 6, paddingHorizontal: 4 },
  input: {
    backgroundColor: '#252525',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: 'monospace',
    marginHorizontal: 4,
    marginBottom: 4,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a2a',
  },
  radioRowActive: { backgroundColor: '#1f2a1f' },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#555',
  },
  radioSelected: { borderColor: '#ff0000', backgroundColor: '#ff0000' },
  radioLabel: { color: '#ddd', fontSize: 14, flex: 1 },
  radioHint: { color: '#666', fontSize: 12, marginTop: 2 },
  rateRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  rateBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#252525',
    alignItems: 'center',
  },
  rateBtnActive: { backgroundColor: '#ff0000' },
  rateBtnText: { color: '#aaa', fontSize: 15, fontWeight: '600' },
  rateBtnTextActive: { color: '#fff' },
  saveBtn: {
    marginHorizontal: 16,
    marginTop: 28,
    backgroundColor: '#ff0000',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
