import React, { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PlayerScreen } from './src/screens/PlayerScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

export default function App() {
  const [screen, setScreen] = useState<'player' | 'settings'>('player');

  return (
    <SafeAreaProvider>
      {screen === 'player' ? (
        <PlayerScreen onOpenSettings={() => setScreen('settings')} />
      ) : (
        <SettingsScreen onBack={() => setScreen('player')} />
      )}
    </SafeAreaProvider>
  );
}
