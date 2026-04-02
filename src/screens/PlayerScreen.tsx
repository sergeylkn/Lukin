/**
 * PlayerScreen — YouTube WebView player with real-time translation.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';

import { TranslationOverlay } from '../components/TranslationOverlay';
import { YOUTUBE_INJECT_JS } from '../services/YouTubeInjection';
import { translateToRussian } from '../services/TranslationService';
import { AudioQueue } from '../services/AudioQueue';
import {
  loadSettings,
  AppSettings,
  settingsToTTSConfig,
} from '../services/SettingsService';

const YOUTUBE_URL = 'https://m.youtube.com';

export function PlayerScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const audioQueueRef = useRef<AudioQueue | null>(null);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [translatedText, setTranslatedText] = useState('');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  // Load settings on mount and configure audio
  useEffect(() => {
    (async () => {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });
      const s = await loadSettings();
      setSettings(s);
      audioQueueRef.current = new AudioQueue(settingsToTTSConfig(s));
    })();

    return () => {
      audioQueueRef.current?.stop();
    };
  }, []);

  // Reload settings when returning from settings screen
  const refreshSettings = useCallback(async () => {
    const s = await loadSettings();
    setSettings(s);
    audioQueueRef.current?.updateConfig(settingsToTTSConfig(s));
  }, []);

  const handleMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      if (!settings) return;

      let msg: { type: string; text?: string };
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }

      if (msg.type === 'READY') {
        setStatus('Субтитры подключены');
        setTimeout(() => setStatus(''), 2000);
        return;
      }

      if (msg.type === 'SUBTITLE_CLEAR') {
        setTranslatedText('');
        return;
      }

      if (msg.type !== 'SUBTITLE' || !msg.text) return;
      if (!settings.translationEnabled) return;
      if (!settings.anthropicApiKey) {
        setStatus('⚠️ Укажите API-ключ в настройках');
        return;
      }

      try {
        const translation = await translateToRussian(msg.text, settings.anthropicApiKey);
        if (settings.showTextOverlay) {
          setTranslatedText(translation);
        }
        audioQueueRef.current?.enqueue(translation);
      } catch (err: any) {
        console.warn('Translation error:', err?.message);
        setStatus('Ошибка перевода');
        setTimeout(() => setStatus(''), 3000);
      }
    },
    [settings],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor="#0f0f0f" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>YouTube · RU</Text>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => {
            onOpenSettings();
            refreshSettings();
          }}
        >
          <Text style={styles.settingsBtnText}>⚙️ Настройки</Text>
        </TouchableOpacity>
      </View>

      {/* Status bar */}
      {status ? (
        <View style={styles.statusBar}>
          <Text style={styles.statusText}>{status}</Text>
        </View>
      ) : null}

      {/* WebView */}
      <View style={styles.webViewContainer}>
        {settings && (
          <WebView
            ref={webViewRef}
            source={{ uri: YOUTUBE_URL }}
            style={styles.webView}
            injectedJavaScript={YOUTUBE_INJECT_JS}
            onMessage={handleMessage}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            userAgent="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
          />
        )}

        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#ff0000" />
            <Text style={styles.loadingText}>Загрузка YouTube...</Text>
          </View>
        )}

        {/* Translation overlay */}
        <TranslationOverlay
          text={translatedText}
          visible={settings?.showTextOverlay ?? true}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  settingsBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#2a2a2a',
    borderRadius: 20,
  },
  settingsBtnText: {
    color: '#ccc',
    fontSize: 13,
  },
  statusBar: {
    backgroundColor: '#1f1f1f',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  statusText: {
    color: '#aaa',
    fontSize: 12,
    textAlign: 'center',
  },
  webViewContainer: {
    flex: 1,
    position: 'relative',
  },
  webView: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0f0f0f',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#888',
    fontSize: 14,
  },
});
