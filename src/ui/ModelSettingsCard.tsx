/**
 * Settings > Models: which Gemini model chats and which writes apps and games, on this phone.
 * "Default" follows Remote Config (set for everyone from the Firebase console).
 */
import { Text, View } from 'react-native';

import { modelOverride, rcRemoteString, setModelOverride, useRemoteConfig, type ModelKey } from '../remote/remoteConfig';
import { Segmented } from './components';
import { haptics } from './haptics';
import { space, type, type Theme } from './theme';

/** The models offered; anything else can still be set for everyone in Remote Config. */
const MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Fast', note: 'quickest and cheapest' },
  { id: 'gemini-3.8-flash', label: 'Strong', note: 'smarter, better code and games; slower, about 1.5× the cost' },
];

const ROWS: { key: ModelKey; title: string }[] = [
  { key: 'cloud_model', title: 'Chat and AI answers' },
  { key: 'html_model', title: 'Building and changing apps and games' },
];

export function ModelSettingsCard({ theme }: { theme: Theme }) {
  useRemoteConfig(); // re-render when a choice or Remote Config changes
  return (
    <View style={{ gap: space(4) }}>
      {ROWS.map(({ key, title }) => {
        const chosen = modelOverride(key);
        const value = chosen && MODELS.some((m) => m.id === chosen) ? chosen : 'default';
        const inUse = chosen ?? rcRemoteString(key);
        const note = MODELS.find((m) => m.id === inUse)?.note;
        return (
          <View key={key} style={{ gap: space(2) }}>
            <Text style={[type.label, { color: theme.text }]}>{title}</Text>
            <Segmented
              theme={theme}
              value={value}
              onChange={(v) => {
                haptics.tap();
                setModelOverride(key, v === 'default' ? undefined : v);
              }}
              options={[{ value: 'default', label: 'Default' }, ...MODELS.map((m) => ({ value: m.id, label: m.label }))]}
            />
            <Text style={[type.caption, { color: theme.muted }]}>
              {chosen ? 'Chosen on this phone' : 'Default (from Remote Config)'}: {inUse}
              {note ? ` · ${note}` : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
