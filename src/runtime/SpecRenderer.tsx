import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAI } from '../ai/AIContext';
import { runAction } from '../ai/hybrid';
import type { InferenceSource } from '../ai/types';
import { componentKey } from '../spec/edit';
import { MicButton } from '../voice/MicButton';
import { VoiceChat } from '../voice/VoiceChat';
import { ReminderBlock } from '../alerts/ReminderBlock';
import type { AppSpec, SpecComponent } from '../spec/types';
import { fillTemplate } from '../spec/validate';
import { addEntry, deleteEntry, listEntries, type Entry } from '../storage/store';
import { Button, Card, Chip, EmptyState, Icon, IconButton, SourceBadge, relativeTime } from '../ui/components';
import { FadeUp } from '../ui/motion';
import { stroke, radius, space, type, useTheme, type Theme } from '../ui/theme';

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
export function RichText({ text, theme }: { text: string; theme: Theme }) {
  const lines = useMemo(() => text.replace(/\*\*/g, '').split('\n').filter((l) => l.trim()), [text]);
  return (
    <View style={{ gap: space(1) }}>
      {lines.map((line, i) => {
        const bullet = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
        const qa = line.match(/^\s*(Q|A):\s*(.*)$/);
        if (bullet) {
          return (
            <View key={i} style={styles.bulletRow}>
              <View style={[styles.bulletDot, { backgroundColor: theme.accent }]} />
              <Text selectable style={[type.body, { color: theme.text, flex: 1 }]}>
                {bullet[1]}
              </Text>
            </View>
          );
        }
        return (
          <Text
            key={i}
            selectable
            style={[type.body, { color: theme.text }, qa?.[1] === 'Q' && { fontWeight: '600', marginTop: i ? space(2) : 0 }]}
          >
            {qa ? qa[2] : line}
          </Text>
        );
      })}
    </View>
  );
}

/**
 * The saved-entries list. Kept as its own memoized component: it is the heaviest part of a
 * rendered app, and typing in a field must not re-render it.
 */
const HistoryList = memo(function HistoryList({
  appId,
  label,
  entries,
  fieldIds,
  labels,
  theme,
  onChange,
}: {
  appId: string;
  label: string;
  entries: Entry[];
  fieldIds: string[];
  labels: Record<string, string>;
  theme: Theme;
  onChange(next: Entry[]): void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  // Rendering every entry would cost more the longer an app is used; show the newest slice.
  const [limit, setLimit] = useState(25);
  const shown = entries.slice(0, limit);

  return (
    <View style={{ gap: space(3), marginTop: space(2) }}>
      <View style={styles.row}>
        <Text style={[type.headline, { color: theme.text, flex: 1 }]}>{label}</Text>
        {entries.length > 0 && <Text style={[type.caption, { color: theme.subtle }]}>{entries.length}</Text>}
      </View>
      {entries.length === 0 ? (
        <EmptyState icon="file-tray-outline" title="Nothing saved yet" body="Your entries stay on this device." theme={theme} />
      ) : (
        <>
          {shown.map((e) => {
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
                      {rest.length > 0 && (
                        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={theme.subtle} />
                      )}
                    </View>
                    <Text style={[type.body, { color: theme.text }]} numberOfLines={expanded ? undefined : 2}>
                      {e.values[firstField]}
                    </Text>
                  </Pressable>
                  <IconButton
                    icon="trash-outline"
                    label="Delete entry"
                    theme={theme}
                    onPress={async () => onChange(await deleteEntry(appId, e.id))}
                  />
                </View>
                {expanded &&
                  rest.map((k) => (
                    <View key={k} style={{ gap: 2 }}>
                      <Text style={[type.overline, { color: theme.subtle }]}>{(labels[k] ?? k).toUpperCase()}</Text>
                      <RichText text={e.values[k]} theme={theme} />
                    </View>
                  ))}
              </Card>
            );
          })}
          {entries.length > limit && (
            <Button label={`Show ${Math.min(25, entries.length - limit)} more`} theme={theme} variant="secondary" onPress={() => setLimit((l) => l + 25)} />
          )}
        </>
      )}
    </View>
  );
});

/**
 * Renders an AppSpec from prebuilt, native building blocks.
 *
 * In `selectable` mode every block becomes tappable so the builder can offer direct editing of
 * that block — no model call needed, because the spec is structured data.
 */
export function SpecRenderer({
  appId,
  spec,
  selectable,
  selectedKey,
  onSelect,
}: {
  appId: string;
  spec: AppSpec;
  selectable?: boolean;
  selectedKey?: string | null;
  onSelect?(key: string | null): void;
}) {
  const theme = useTheme(spec.accent);
  const ai = useAI();
  const [values, setValues] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, InferenceSource>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [entries, setEntries] = useState<Entry[]>([]);
  const [justSaved, setJustSaved] = useState(false);
  /** Bumped on save so voice chats start a fresh conversation for the next entry. */
  const [saveCount, setSaveCount] = useState(0);

  useEffect(() => {
    let alive = true;
    listEntries(appId).then((e) => alive && setEntries(e));
    return () => {
      alive = false;
    };
  }, [appId]);

  const set = useCallback((id: string, v: string) => {
    setValues((s) => ({ ...s, [id]: v }));
    setJustSaved(false);
  }, []);

  const layout = useMemo(() => sections(spec.components), [spec.components]);
  const labels = useMemo(
    () => Object.fromEntries(spec.components.filter((c) => c.id).map((c) => [c.id!, c.label ?? c.id!])),
    [spec.components],
  );
  const fieldIds = useMemo(
    // A voice chat's transcript is saved like any typed field.
    () => spec.components.filter((c) => c.type === 'input' || c.type === 'choice' || c.type === 'voice').map((c) => c.id!),
    [spec.components],
  );
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

  const save = useCallback(async () => {
    const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
    if (!Object.keys(filled).length) return;
    setEntries(await addEntry(appId, filled));
    setValues({});
    setSources({});
    setJustSaved(true);
    setSaveCount((n) => n + 1);
  }, [appId, values]);

  /**
   * Wraps a block with the tap-to-select affordance when the builder asks for it.
   *
   * Three modes, because the right gesture differs per block:
   *   - `tap`    static text: the whole block is the tap target;
   *   - `corner` blocks that are themselves buttons (AI actions, save, history): a pencil in the
   *              corner, so selecting never competes with pressing the button;
   *   - `ring`   form fields: the field's own label carries the pencil, so the wrapper only draws
   *              the selection ring (and never nests interactive elements).
   */
  const selectable_ = (
    c: SpecComponent,
    i: number,
    node: ReactNode,
    label?: string,
    mode: 'tap' | 'corner' | 'ring' = 'tap',
  ) => {
    if (!selectable) return node;
    const key = componentKey(c, i);
    const on = selectedKey === key;
    const ring = on && { borderColor: theme.accent, backgroundColor: theme.accentSoft, borderStyle: 'solid' as const };
    const tag = on && (
      <View style={[styles.selectTag, { backgroundColor: theme.accent }]}>
        <Icon name="create-outline" size={11} color={theme.onAccent} />
        <Text style={styles.selectTagText}>Editing</Text>
      </View>
    );
    const toggle = () => onSelect?.(on ? null : key);

    if (mode === 'corner' || mode === 'ring') {
      return (
        <View key={key} style={[styles.selectable, ring]}>
          {node}
          {mode === 'corner' && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit ${label ?? c.type}`}
              accessibilityState={{ selected: on }}
              onPress={toggle}
              hitSlop={8}
              style={[styles.editCorner, { backgroundColor: on ? theme.accent : theme.surface, borderColor: theme.border }]}
            >
              <Icon name="create-outline" size={14} color={on ? theme.onAccent : theme.muted} />
            </Pressable>
          )}
          {tag}
        </View>
      );
    }

    return (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${label ?? c.type}`}
        accessibilityState={{ selected: on }}
        onPress={toggle}
        style={[styles.selectable, ring]}
      >
        {node}
        {tag}
      </Pressable>
    );
  };

  const field = (c: SpecComponent, i: number): ReactNode => {
    const key = componentKey(c, i);
    const on = selectedKey === key;
    // The label is the tap target for selecting a field: wrapping the input itself would nest
    // interactive elements (invalid on web, and it would swallow taps meant for typing).
    const label = selectable ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit ${c.label}`}
        accessibilityState={{ selected: on }}
        onPress={() => onSelect?.(on ? null : key)}
        style={styles.fieldLabel}
      >
        <Text style={[type.label, { color: theme.text, flex: 1 }]}>{c.label}</Text>
        <Icon name="create-outline" size={14} color={on ? theme.accent : theme.subtle} />
      </Pressable>
    ) : (
      <Text style={[type.label, { color: theme.text }]}>{c.label}</Text>
    );

    const node = (
      <View key={c.id} style={{ gap: space(2) }}>
        {label}
        {c.type === 'choice' ? (
          <View style={styles.chips}>
            {c.options!.map((o) => (
              <Chip
                key={o}
                label={o}
                theme={theme}
                selected={values[c.id!] === o}
                onPress={() => set(c.id!, values[c.id!] === o ? '' : o)}
              />
            ))}
          </View>
        ) : (
          <View style={styles.inputWrap}>
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
                { backgroundColor: theme.surfaceAlt, color: theme.text, paddingRight: space(12) },
                c.multiline && { minHeight: 120, textAlignVertical: 'top' },
              ]}
            />
            {/* Dictate instead of typing: speech-to-text, on-device where the platform allows. */}
            <View style={styles.inputMic}>
              <MicButton
                theme={theme}
                size={34}
                label={`Dictate ${c.label}`}
                onFinal={(t) => set(c.id!, [values[c.id!]?.trim(), t].filter(Boolean).join(' '))}
              />
            </View>
          </View>
        )}
      </View>
    );
    return selectable ? selectable_(c, i, node, c.label, 'ring') : node;
  };

  const block = (c: SpecComponent, i: number): ReactNode => {
    switch (c.type) {
      case 'heading': {
        const node = (
          <Text key={`h${i}`} style={[type.headline, { color: theme.text }]}>
            {c.text}
          </Text>
        );
        return selectable ? selectable_(c, i, node, c.text) : node;
      }
      case 'text': {
        const node = (
          <Text key={`t${i}`} style={[type.body, { color: theme.muted }]}>
            {c.text}
          </Text>
        );
        return selectable ? selectable_(c, i, node, c.text) : node;
      }
      case 'ai': {
        const result = values[c.id!];
        const loading = busy === c.id;
        const node = (
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
                <Text style={[type.overline, { color: theme.accent }]}>{c.label?.toUpperCase()}</Text>
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
        return selectable ? selectable_(c, i, node, c.label, 'corner') : node;
      }
      case 'voice': {
        const node = (
          <VoiceChat key={`${c.id}:${saveCount}`} c={c} values={values} theme={theme} onTranscript={(t) => set(c.id!, t)} />
        );
        return selectable ? selectable_(c, i, node, c.label, 'corner') : node;
      }
      case 'reminder': {
        const node = <ReminderBlock key={c.id} appId={appId} appName={spec.name} appEmoji={spec.emoji} c={c} theme={theme} />;
        return selectable ? selectable_(c, i, node, c.label, 'corner') : node;
      }
      case 'save': {
        const node = (
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
        return selectable ? selectable_(c, i, node, c.label, 'corner') : node;
      }
      case 'history': {
        const node = (
          <HistoryList
            key="history"
            appId={appId}
            label={c.label ?? 'History'}
            entries={entries}
            fieldIds={fieldIds}
            labels={labels}
            theme={theme}
            onChange={setEntries}
          />
        );
        return selectable ? selectable_(c, i, node, c.label, 'corner') : node;
      }
      default:
        return null;
    }
  };

  // Track a running index across the grouped layout so selection keys stay stable.
  let cursor = 0;
  return (
    <View style={{ gap: space(4) }}>
      {layout.map((s, i) => {
        if (s.kind === 'form') {
          const start = cursor;
          cursor += s.items.length;
          const node = (
            <Card key={`form-${i}`} theme={theme} style={{ gap: space(4) }}>
              {s.items.map((c, j) => field(c, start + j))}
            </Card>
          );
          return node;
        }
        const idx = cursor++;
        return (
          <FadeUp key={`b-${i}`} distance={6}>
            {block(s.items[0], idx)}
          </FadeUp>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  input: { borderRadius: radius.md, paddingHorizontal: space(3), paddingVertical: space(3) },
  inputWrap: { position: 'relative' },
  inputMic: { position: 'absolute', right: space(2), top: space(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  fieldLabel: { flexDirection: 'row', alignItems: 'center', gap: space(2), minHeight: 24 },
  result: { borderRadius: radius.md, borderLeftWidth: 3, padding: space(4), gap: space(2) },
  bulletRow: { flexDirection: 'row', gap: space(2), alignItems: 'flex-start' },
  bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  selectable: {
    borderWidth: stroke,
    borderStyle: 'dashed',
    borderColor: 'transparent',
    borderRadius: radius.md,
    padding: space(2),
    marginHorizontal: -space(2),
  },
  selectTag: {
    position: 'absolute',
    top: -9,
    left: space(3),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    zIndex: 1,
  },
  selectTagText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  editCorner: {
    position: 'absolute',
    top: -space(2),
    right: 0,
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: stroke,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
});
