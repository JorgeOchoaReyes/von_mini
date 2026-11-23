import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAI } from '../ai/AIContext';
import { runAction } from '../ai/hybrid';
import type { InferenceSource } from '../ai/types';
import type { AppSpec, SpecComponent } from '../spec/types';
import { fillTemplate } from '../spec/validate';
import { addEntry, deleteEntry, listEntries, type Entry } from '../storage/store';
import { Button, Card, SourceBadge } from '../ui/components';
import { radius, space, useTheme } from '../ui/theme';

/** Renders an AppSpec from prebuilt, native building blocks. */
export function SpecRenderer({ appId, spec }: { appId: string; spec: AppSpec }) {
  const theme = useTheme(spec.accent);
  const ai = useAI();
  const [values, setValues] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, InferenceSource>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    listEntries(appId).then(setEntries);
  }, [appId]);

  const set = (id: string, v: string) => setValues((s) => ({ ...s, [id]: v }));
  const labels = Object.fromEntries(spec.components.filter((c) => c.id).map((c) => [c.id!, c.label ?? c.id!]));

  const run = useCallback(
    async (c: SpecComponent) => {
      if (!c.id || !c.prompt) return;
      setBusy(c.id);
      setError(null);
      try {
        const result = await runAction(fillTemplate(c.prompt, values), ai);
        set(c.id, result.text.trim());
        setSources((s) => ({ ...s, [c.id!]: result.source }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [values, ai],
  );

  const save = async () => {
    const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
    if (!Object.keys(filled).length) return;
    setEntries(await addEntry(appId, filled));
    setValues({});
    setSources({});
    setSavedAt(Date.now());
  };

  return (
    <View style={{ gap: space(4) }}>
      {spec.components.map((c, i) => {
        const key = `${c.type}-${c.id ?? i}`;
        switch (c.type) {
          case 'heading':
            return <Text key={key} style={[styles.heading, { color: theme.text }]}>{c.text}</Text>;
          case 'text':
            return <Text key={key} style={[styles.body, { color: theme.muted }]}>{c.text}</Text>;
          case 'input':
            return (
              <View key={key} style={{ gap: space(2) }}>
                <Text style={[styles.label, { color: theme.text }]}>{c.label}</Text>
                <TextInput
                  value={values[c.id!] ?? ''}
                  onChangeText={(v) => set(c.id!, v)}
                  placeholder={c.placeholder}
                  placeholderTextColor={theme.muted}
                  multiline={c.multiline}
                  style={[
                    styles.input,
                    { backgroundColor: theme.input, color: theme.text, borderColor: theme.border },
                    c.multiline && { minHeight: 120, textAlignVertical: 'top' },
                  ]}
                />
              </View>
            );
          case 'choice':
            return (
              <View key={key} style={{ gap: space(2) }}>
                <Text style={[styles.label, { color: theme.text }]}>{c.label}</Text>
                <View style={styles.chips}>
                  {c.options!.map((o) => {
                    const on = values[c.id!] === o;
                    return (
                      <Pressable
                        key={o}
                        onPress={() => set(c.id!, on ? '' : o)}
                        style={[
                          styles.chip,
                          { borderColor: on ? theme.accent : theme.border, backgroundColor: on ? theme.accent : theme.card },
                        ]}
                      >
                        <Text style={{ color: on ? '#fff' : theme.text, fontWeight: '500' }}>{o}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          case 'ai':
            return (
              <View key={key} style={{ gap: space(2) }}>
                <Button
                  label={`✨ ${c.label}`}
                  theme={theme}
                  variant="secondary"
                  loading={busy === c.id}
                  disabled={!!busy}
                  onPress={() => run(c)}
                />
                {values[c.id!] ? (
                  <Card theme={theme} style={{ gap: space(2) }}>
                    <Text style={[styles.body, { color: theme.text }]} selectable>
                      {values[c.id!]}
                    </Text>
                    {sources[c.id!] && <SourceBadge source={sources[c.id!]} />}
                  </Card>
                ) : null}
              </View>
            );
          case 'save':
            return (
              <View key={key} style={{ gap: space(1) }}>
                <Button label={c.label ?? 'Save'} theme={theme} onPress={save} />
                {savedAt && <Text style={[styles.hint, { color: theme.muted }]}>Saved on this device ✓</Text>}
              </View>
            );
          case 'history':
            return (
              <View key={key} style={{ gap: space(2) }}>
                <Text style={[styles.heading, { color: theme.text }]}>{c.label}</Text>
                {entries.length === 0 && (
                  <Text style={[styles.hint, { color: theme.muted }]}>Nothing saved yet. Entries stay on this device.</Text>
                )}
                {entries.map((e) => (
                  <Card key={e.id} theme={theme} style={{ gap: space(2) }}>
                    <View style={styles.row}>
                      <Text style={[styles.hint, { color: theme.muted }]}>{new Date(e.at).toLocaleString()}</Text>
                      <Pressable onPress={async () => setEntries(await deleteEntry(appId, e.id))} hitSlop={8}>
                        <Text style={{ color: theme.danger, fontSize: 13 }}>Delete</Text>
                      </Pressable>
                    </View>
                    {Object.entries(e.values).map(([k, v]) => (
                      <View key={k} style={{ gap: 2 }}>
                        <Text style={[styles.fieldName, { color: theme.muted }]}>{labels[k] ?? k}</Text>
                        <Text style={[styles.body, { color: theme.text }]} selectable>{v}</Text>
                      </View>
                    ))}
                  </Card>
                ))}
              </View>
            );
        }
      })}
      {error && <Text style={{ color: theme.danger }}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22 },
  label: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 13 },
  fieldName: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: radius.md, padding: space(3), fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: space(3), paddingVertical: space(2) },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
