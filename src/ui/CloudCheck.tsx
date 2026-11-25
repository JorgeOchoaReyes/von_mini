/**
 * "Test cloud AI": a one-tap diagnostic in Settings. Sends a tiny request to Gemini in the cloud
 * through Firebase AI Logic twice, without and with streaming, and reports how long each took and
 * what came back (or the exact error). Separates "the cloud is unreachable or misconfigured" from
 * "only streaming is stuck" without needing logcat.
 */
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useAI } from '../ai/AIContext';
import { engine } from '../ai/engineSelect';
import { explainCloudError, StalledError, withDeadline } from '../ai/hybrid';
import { rcString } from '../remote/remoteConfig';
import { Button, Card, Icon } from './components';
import { space, type, type Theme } from './theme';

const PROMPT = 'Reply with exactly: OK';
const LIMIT_MS = 30_000;

type Line = { ok: boolean; text: string };

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function describe(e: unknown, ms: number): string {
  if (e instanceof StalledError) return `no answer after ${secs(ms)} (no error either)`;
  return explainCloudError(e).message;
}

async function plain(): Promise<Line> {
  const t = Date.now();
  try {
    const r = await withDeadline(engine.generate(PROMPT, { mode: 'only_in_cloud' }), LIMIT_MS);
    return { ok: true, text: `answered in ${secs(Date.now() - t)}: “${r.text.trim().slice(0, 40)}”` };
  } catch (e) {
    return { ok: false, text: describe(e, Date.now() - t) };
  }
}

async function streamed(): Promise<Line> {
  const t = Date.now();
  try {
    const it = engine.stream(PROMPT, { mode: 'only_in_cloud' })[Symbol.asyncIterator]();
    const first = await withDeadline(it.next(), LIMIT_MS);
    void it.return?.(undefined);
    if (first.done) return { ok: false, text: `ended after ${secs(Date.now() - t)} without any text` };
    return { ok: true, text: `first words after ${secs(Date.now() - t)}` };
  } catch (e) {
    return { ok: false, text: describe(e, Date.now() - t) };
  }
}

export function CloudCheck({ theme }: { theme: Theme }) {
  const ai = useAI();
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<{ label: string; line: Line }[]>([]);
  const blocked = !ai.online || ai.privateMode || ai.locked;

  const run = async () => {
    setRunning(true);
    setLines([]);
    const a = await plain();
    setLines([{ label: 'Request', line: a }]);
    const b = await streamed();
    setLines([
      { label: 'Request', line: a },
      { label: 'Streaming', line: b },
    ]);
    setRunning(false);
  };

  return (
    <Card theme={theme} style={{ gap: space(3) }}>
      <Text style={[type.headline, { color: theme.text }]}>Test cloud AI</Text>
      <Text style={[type.caption, { color: theme.muted }]}>
        Sends “{PROMPT}” to {rcString('cloud_model')} in the cloud, with and without streaming, and shows what happened.
      </Text>
      {lines.map(({ label, line }) => (
        <View key={label} style={{ flexDirection: 'row', gap: space(2), alignItems: 'flex-start' }}>
          <Icon name={line.ok ? 'checkmark-circle' : 'alert-circle'} size={18} color={line.ok ? theme.success : theme.danger} />
          <Text selectable style={[type.caption, { color: theme.text, flex: 1 }]}>
            {label}: {line.text}
          </Text>
        </View>
      ))}
      <Button
        label={running ? 'Testing…' : blocked ? 'Needs the internet, private mode off' : 'Test cloud AI'}
        icon="pulse-outline"
        variant="secondary"
        theme={theme}
        loading={running}
        disabled={running || blocked}
        onPress={run}
      />
    </Card>
  );
}
