/**
 * SettingsScreen — speech rate and display options.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadSettings, saveSettings, AppSettings } from '../services/SettingsService';

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
      Alert.alert('Сохранено', 'Настройки сохранены.');
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

        {/* About */}
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            Перевод бесплатный — субтитры переводятся напрямую через YouTube (Google Translate).{'\n'}
            API ключи не нужны.
          </Text>
        </View>

        {/* Display */}
        <Section title="Отображение">
          <Row label="Показывать текст">
            <Switch
              value={s.showTextOverlay}
              onValueChange={(v) => update({ showTextOverlay: v })}
              trackColor={{ true: '#ff0000' }}
            />
          </Row>
        </Section>

        {/* Speech rate */}
        <Section title="Скорость речи">
          <View style={styles.rateRow}>
            {[0.75, 1.0, 1.25, 1.5].map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.rateBtn, s.speechRate === r && styles.rateBtnActive]}
                onPress={() => update({ speechRate: r })}
              >
                <Text style={[styles.rateBtnText, s.speechRate === r && styles.rateBtnTextActive]}>
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
  infoBox: {
    margin: 16,
    padding: 14,
    backgroundColor: '#1a2a1a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a4a2a',
  },
  infoText: { color: '#7aaa7a', fontSize: 13, lineHeight: 20 },
  section: { marginTop: 24, paddingHorizontal: 16 },
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  sectionBody: { backgroundColor: '#1a1a1a', borderRadius: 12, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowLabel: { color: '#ddd', fontSize: 15 },
  rateRow: { flexDirection: 'row', gap: 10, padding: 12 },
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
