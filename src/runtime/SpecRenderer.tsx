import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAI } from '../ai/AIContext';
import { runAction } from '../ai/hybrid';
import type { InferenceSource } from '../ai/types';
import type { AppSpec, SpecComponent } from '../spec/types';
import { fillTemplate } from '../spec/validate';
import { addEntry, deleteEntry, listEntries, type Entry } from '../storage/store';
import { Button, Card, Chip, EmptyState, Icon, IconButton, SourceBadge, relativeTime } from '../ui/components';
import { radius, space, type, useTheme, type Theme } from '../ui/theme';

/** Groups consecutive form fields so they render in one card, like a real form. */
function sections(components: SpecComponent[]) {
  const out: { kind: 'form' | 'single'; items: SpecComponent[] }[] = [];
  for (const c of components) {
    const isField = c.type === 'input' || c.type === 'choice';
    const last = out[out.length - 1];
    if (isField && last?.kind === 'form') last.items.push(c);
    else out.push({ kind: isField ? 'form' : 'single', items: [c] });
  }
  return out;
}

/** Renders model text: bullet lines become a list, **bold** markers are stripped. */
function RichText({ text, theme }: { text: string; theme: Theme }) {
  const lines = text.replace(/\*\*/g, '').split('\n').filter((l) => l.trim());
  return (
    <View style={{ gap: space(1) }}>
      {lines.map((line, i) => {
        const bullet = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
        const qa = line.match(/^\s*(Q|A):\s*(.*)$/);
        if (bullet) {
          return (
            <View key={i} style={styles.bulletRow}>
              <View style={[styles.bulletDot, { backgroundColor: theme.accent }]} />
              <Text selectable style={[type.body, { color: theme.text, flex: 1 }]}>{bullet[1]}</Text>
            </View>
          );
        }
        return (
          <Text key={i} selectable style={[type.body, { color: theme.text }, qa?.[1] === 'Q' && { fontWeight: '600', marginTop: i ? space(2) : 0 }]}>
            {qa ? qa[2] : line}
          </Text>
        );
      })}
    </View>
  );
}

/** Renders an AppSpec from prebuilt, native building blocks. */
export function SpecRenderer({ appId, spec }: { appId: string; spec: AppSpec }) {
  const theme = useTheme(spec.accent);
  const ai = useAI();
  const [values, setValues] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, InferenceSource>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [entries, setEntries] = useState<Entry[]>([]);
  const [justSaved, setJustSaved] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listEntries(appId).then((e) => alive && setEntries(e));
    return () => {
      alive = false;
    };
  }, [appId]);

  const set = (id: string, v: string) => {
    setValues((s) => ({ ...s, [id]: v }));
    setJustSaved(false);
  };
  const labels = Object.fromEntries(spec.components.filter((c) => c.id).map((c) => [c.id!, c.label ?? c.id!]));
  const fieldIds = spec.components.filter((c) => c.type === 'input' || c.type === 'choice').map((c) => c.id!);
  const hasInput = fieldIds.some((id) => values[id]?.trim());

  const run = useCallback(
    async (c: SpecComponent) => {
      if (!c.id || !c.prompt) return;
      setBusy(c.id);
      setErrors((e) => ({ ...e, [c.id!]: '' }));
      try {
        const result = await runAction(fillTemplate(c.prompt, values), ai);
        setValues((s) => ({ ...s, [c.id!]: result.text.trim() }));
        setSources((s) => ({ ...s, [c.id!]: result.source }));
      } catch (e) {
        setErrors((x) => ({ ...x, [c.id!]: e instanceof Error ? e.message : String(e) }));
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
    setJustSaved(true);
  };

  const field = (c: SpecComponent): ReactNode => (
    <View key={c.id} style={{ gap: space(2) }}>
      <Text style={[type.label, { color: theme.text }]}>{c.label}</Text>
      {c.type === 'choice' ? (
        <View style={styles.chips}>
          {c.options!.map((o) => (
            <Chip key={o} label={o} theme={theme} selected={values[c.id!] === o} onPress={() => set(c.id!, values[c.id!] === o ? '' : o)} />
          ))}
        </View>
      ) : (
        <TextInput
          value={values[c.id!] ?? ''}
          onChangeText={(v) => set(c.id!, v)}
          placeholder={c.placeholder}
          placeholderTextColor={theme.subtle}
          multiline={c.multiline}
          accessibilityLabel={c.label}
          style={[
            styles.input,
            type.body,
            { backgroundColor: theme.surfaceAlt, color: theme.text },
            c.multiline && { minHeight: 120, textAlignVertical: 'top' },
          ]}
        />
      )}
    </View>
  );

  const block = (c: SpecComponent, i: number): ReactNode => {
    switch (c.type) {
      case 'heading':
        return <Text key={i} style={[type.headline, { color: theme.text }]}>{c.text}</Text>;
      case 'text':
        return <Text key={i} style={[type.body, { color: theme.muted }]}>{c.text}</Text>;
      case 'ai': {
        const result = values[c.id!];
        const loading = busy === c.id;
        return (
          <View key={c.id} style={{ gap: space(2) }}>
            <Button
              label={c.label!}
              icon="sparkles"
              theme={theme}
              variant="secondary"
              disabled={!!busy || !hasInput}
              onPress={() => run(c)}
            />
            {(loading || result) && (
              <View style={[styles.result, { backgroundColor: theme.accentSoft, borderLeftColor: theme.accent }]}>
                <Text style={[type.overline, { color: theme.accent }]}>{c.label}</Text>
                {loading ? (
                  <View style={styles.row}>
                    <ActivityIndicator size="small" color={theme.accent} />
                    <Text style={[type.caption, { color: theme.muted }]}>Thinking on-device…</Text>
                  </View>
                ) : (
                  <>
                    <RichText text={result} theme={theme} />
                    {sources[c.id!] && <SourceBadge source={sources[c.id!]} />}
                  </>
                )}
              </View>
            )}
            {errors[c.id!] ? (
              <View style={styles.row}>
                <Icon name="alert-circle-outline" size={16} color={theme.danger} />
                <Text style={[type.caption, { color: theme.danger, flex: 1 }]}>{errors[c.id!]}</Text>
              </View>
            ) : null}
          </View>
        );
      }
      case 'save':
        return (
          <View key="save" style={{ gap: space(2) }}>
            <Button label={c.label ?? 'Save'} icon="checkmark" theme={theme} disabled={!hasInput} onPress={save} />
            {justSaved && (
              <View style={[styles.row, { justifyContent: 'center' }]}>
                <Icon name="checkmark-circle" size={16} color={theme.success} />
                <Text style={[type.caption, { color: theme.muted }]}>Saved on this device</Text>
              </View>
            )}
          </View>
        );
      case 'history':
        return (
          <View key="history" style={{ gap: space(3), marginTop: space(2) }}>
            <View style={styles.row}>
              <Text style={[type.headline, { color: theme.text, flex: 1 }]}>{c.label}</Text>
              {entries.length > 0 && <Text style={[type.caption, { color: theme.subtle }]}>{entries.length}</Text>}
            </View>
            {entries.length === 0 ? (
              <EmptyState icon="file-tray-outline" title="Nothing saved yet" body="Your entries stay on this device." theme={theme} />
            ) : (
              entries.map((e) => {
                const keys = Object.keys(e.values);
                const firstField = keys.find((k) => fieldIds.includes(k)) ?? keys[0];
                const expanded = open === e.id;
                const rest = keys.filter((k) => k !== firstField);
                return (
                  <Card key={e.id} theme={theme} style={{ gap: space(2), padding: space(3) }}>
                    <View style={[styles.row, { alignItems: 'flex-start' }]}>
                      {/* Expand toggle and delete are siblings: a button can't contain another button. */}
                      <Pressable
                        onPress={() => setOpen(expanded ? null : e.id)}
                        style={{ flex: 1, gap: space(1) }}
                        accessibilityRole="button"
                        accessibilityState={{ expanded }}
                      >
                        <View style={styles.row}>
                          <Text style={[type.caption, { color: theme.subtle }]}>{relativeTime(e.at)}</Text>
                          {rest.length > 0 && <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={theme.subtle} />}
                        </View>
                        <Text style={[type.body, { color: theme.text }]} numberOfLines={expanded ? undefined : 2}>
                          {e.values[firstField]}
                        </Text>
                      </Pressable>
                      <IconButton
                        icon="trash-outline"
                        label="Delete entry"
                        theme={theme}
                        onPress={async () => setEntries(await deleteEntry(appId, e.id))}
                      />
                    </View>
                    {expanded &&
                      rest.map((k) => (
                        <View key={k} style={{ gap: 2 }}>
                          <Text style={[type.overline, { color: theme.subtle }]}>{labels[k] ?? k}</Text>
                          <RichText text={e.values[k]} theme={theme} />
                        </View>
                      ))}
                  </Card>
                );
              })
            )}
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <View style={{ gap: space(4) }}>
      {sections(spec.components).map((s, i) =>
        s.kind === 'form' ? (
          <Card key={`form-${i}`} theme={theme} style={{ gap: space(4) }}>
            {s.items.map(field)}
          </Card>
        ) : (
          block(s.items[0], i)
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  input: { borderRadius: radius.md, paddingHorizontal: space(3), paddingVertical: space(3) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  result: { borderRadius: radius.md, borderLeftWidth: 3, padding: space(4), gap: space(2) },
  bulletRow: { flexDirection: 'row', gap: space(2), alignItems: 'flex-start' },
  bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
});
