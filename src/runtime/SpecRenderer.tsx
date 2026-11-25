import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAppAI } from '../ai/appMode';
import { runAction } from '../ai/hybrid';
import type { InferenceSource } from '../ai/types';
import { componentKey } from '../spec/edit';
import { MicButton } from '../voice/MicButton';
import { VoiceChat } from '../voice/VoiceChat';
import { ReminderBlock } from '../alerts/ReminderBlock';
import { RandomCard } from '../games/RandomCard';
import { GameCard } from '../games/GameCard';
import type { AppSpec, SpecComponent } from '../spec/types';
import {
  CHECK_SEP,
  checklistCount,
  computeStat,
  dayTotal,
  daySeries,
  fillPrompt,
  firstNumber,
  formatStat,
  OP_LABEL,
  promptFields,
  RANGE_LABEL,
  type StatOp,
  type StatRange,
} from '../spec/stats';
import { addEntry, deleteEntry, listEntries, type Entry } from '../storage/store';
import { Button, Card, Chip, EmptyState, Icon, IconButton, SourceBadge, relativeTime } from '../ui/components';
import { FadeUp } from '../ui/motion';
import { stroke, radius, space, type, useTheme, type Theme } from '../ui/theme';

/**
 * Groups consecutive form fields so they render in one card, like a real form, and consecutive
 * stats so they sit side by side, like a dashboard.
 */
function sections(components: SpecComponent[]) {
  const out: { kind: 'form' | 'stats' | 'single'; items: SpecComponent[] }[] = [];
  for (const c of components) {
    const kind = c.type === 'input' || c.type === 'choice' ? 'form' : c.type === 'stat' ? 'stats' : 'single';
    const last = out[out.length - 1];
    if (kind !== 'single' && last?.kind === kind) last.items.push(c);
    else out.push({ kind, items: [c] });
  }
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = (t: number) => new Date(t).toDateString();
function dayTitle(t: number) {
  const k = dayKey(t);
  if (k === dayKey(Date.now())) return 'Today';
  if (k === dayKey(Date.now() - DAY_MS)) return 'Yesterday';
  return new Date(t).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
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
  byDay,
  total,
  units,
  kinds,
}: {
  appId: string;
  label: string;
  entries: Entry[];
  fieldIds: string[];
  labels: Record<string, string>;
  theme: Theme;
  onChange(next: Entry[]): void;
  /** Group entries under day headers. */
  byDay?: boolean;
  /** A field totalled on each day's header, with its unit and whether it's a checklist. */
  total?: { field: string; unit?: string; checklist: boolean };
  /** Units of number fields, so "4.5" reads "$4.50" in the summary line. */
  units?: Record<string, string>;
  /** Field kinds, so a rating reads "★ 4/5" and a yes/no reads "✓ Worked out?". */
  kinds?: Record<string, string>;
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
          {shown.map((e, idx) => {
            const keys = Object.keys(e.values);
            // Day header before the first entry of each day (entries are newest first).
            const newDay = byDay && (idx === 0 || dayKey(shown[idx - 1].at) !== dayKey(e.at));
            const dayEntries = newDay ? entries.filter((x) => dayKey(x.at) === dayKey(e.at)) : [];
            const dayValue = newDay && total ? dayTotal(dayEntries, total.field, total.checklist) : null;
            const header = newDay ? (
              <View key={`d-${e.id}`} style={[styles.row, { marginTop: idx ? space(2) : 0 }]}>
                <Text style={[type.label, { color: theme.text, flex: 1 }]}>{dayTitle(e.at)}</Text>
                <Text style={[type.caption, { color: theme.muted }]}>
                  {dayValue !== null ? `${formatStat(dayValue, total?.unit)}${total?.checklist ? ' done' : ''} · ` : ''}
                  {dayEntries.length} {dayEntries.length === 1 ? 'entry' : 'entries'}
                </Text>
              </View>
            ) : null;
            const firstField = keys.find((k) => fieldIds.includes(k)) ?? keys[0];
            const expanded = open === e.id;
            const rest = keys.filter((k) => k !== firstField);
            // Short values (amounts, ratings, picks, AI tags) as one line, so a tracker's entry is
            // readable without expanding it.
            const summary = rest
              .filter((k) => fieldIds.includes(k) || labels[k])
              .map((k) => {
                const v = e.values[k]?.trim() ?? '';
                if (!v || v.length > 28 || v.includes('\n')) return null;
                if (kinds?.[k] === 'rating') return `★ ${v}/5`;
                if (kinds?.[k] === 'yesno') return `${/^yes$/i.test(v) ? '✓' : '✗'} ${(labels[k] ?? k).replace(/\?$/, '')}`;
                const n = units?.[k] !== undefined ? firstNumber(v) : null;
                return n !== null ? formatStat(n, units?.[k] || undefined) : v;
              })
              .filter(Boolean)
              .join(' · ');
            return [
              header,
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
                      <Text style={[type.caption, { color: theme.subtle }]}>
                      {byDay ? new Date(e.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : relativeTime(e.at)}
                    </Text>
                      {rest.length > 0 && (
                        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={theme.subtle} />
                      )}
                    </View>
                    <Text style={[type.body, { color: theme.text }]} numberOfLines={expanded ? undefined : 2}>
                      {units?.[firstField] !== undefined && firstNumber(e.values[firstField]) !== null
                        ? formatStat(firstNumber(e.values[firstField]), units[firstField] || undefined)
                        : e.values[firstField]}
                    </Text>
                    {!expanded && summary ? (
                      <Text style={[type.caption, { color: theme.muted }]} numberOfLines={1}>
                        {summary}
                      </Text>
                    ) : null}
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
              </Card>,
            ];
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
  const ai = useAppAI();
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
    // A game's entries hold its score, so they read "Score" rather than the button's label.
    () =>
      Object.fromEntries(
        spec.components
          .filter((c) => c.id)
          .flatMap((c) => (c.type === 'game' ? [[c.id!, 'Score'], [`${c.id}_by`, 'Player']] : [[c.id!, c.label ?? c.id!]])),
      ),
    [spec.components],
  );
  const fieldIds = useMemo(
    // A voice chat's transcript and a checklist's ticks are saved like any typed field.
    () =>
      spec.components
        .filter((c) => c.type === 'input' || c.type === 'choice' || c.type === 'voice' || c.type === 'checklist' || c.type === 'game')
        .map((c) => c.id!),
    [spec.components],
  );
  const byId = useMemo(() => new Map(spec.components.filter((c) => c.id).map((c) => [c.id!, c])), [spec.components]);
  const units = useMemo(
    () =>
      Object.fromEntries(
        spec.components.filter((c) => c.type === 'input' && c.kind === 'number' && c.id).map((c) => [c.id!, c.unit ?? '']),
      ),
    [spec.components],
  );
  const kinds = useMemo(
    () => Object.fromEntries(spec.components.filter((c) => c.type === 'input' && c.kind && c.id).map((c) => [c.id!, c.kind!])),
    [spec.components],
  );
  const isChecklist = useCallback((id?: string) => !!id && byId.get(id)?.type === 'checklist', [byId]);
  const hasInput = fieldIds.some((id) => values[id]?.trim());
  /** Fills a prompt with what's typed, plus saved entries and the date for {entries}/{today_entries}/{today}. */
  const fill = useCallback((t: string, vals: Record<string, string> = values) => fillPrompt(t, vals, { entries, labels }), [values, entries, labels]);
  /** An AI button can run once the fields its prompt reads have something in them (or it reads none). */
  const canRun = (c: SpecComponent) => {
    const refs = promptFields(c.prompt).filter((id) => byId.has(id));
    return refs.length === 0 || refs.some((id) => values[id]?.trim());
  };

  /**
   * Runs an AI block against `vals` and returns the values with its answer added. When the block
   * fills a field, the answer goes there too (a number field gets just the number).
   */
  const run = useCallback(
    async (c: SpecComponent, vals: Record<string, string> = values): Promise<Record<string, string>> => {
      if (!c.id || !c.prompt) return vals;
      setBusy(c.id);
      setErrors((e) => ({ ...e, [c.id!]: '' }));
      try {
        const target = c.fills ? byId.get(c.fills) : undefined;
        // A number field takes a number: ask for just that, so "400 + 50 = 450" can't land as 400.
        const ask = target?.kind === 'number' && !/just the number|only the number/i.test(c.prompt) ? `${c.prompt}\nReply with just the number.` : c.prompt;
        const result = await runAction(fill(ask, vals), ai);
        const text = result.text.trim();
        const answer: Record<string, string> = { [c.id]: text };
        if (c.fills) {
          const n = target?.kind === 'number' ? firstNumber(text) : null;
          answer[c.fills] = n !== null ? String(n) : text;
        }
        const next = { ...vals, ...answer };
        // Merge only the answer: anything typed while the AI was thinking stays.
        setValues((s) => ({ ...s, ...answer }));
        setSources((s) => ({ ...s, [c.id!]: result.source }));
        return next;
      } catch (e) {
        setErrors((x) => ({ ...x, [c.id!]: e instanceof Error ? e.message : String(e) }));
        return vals;
      } finally {
        setBusy(null);
      }
    },
    [values, ai, fill, byId],
  );

  const [saving, setSaving] = useState(false);
  // The form as it is right now, for a save that waited on AI and must not drop later typing.
  const latest = useRef(values);
  useEffect(() => {
    latest.current = values;
  }, [values]);
  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      // AI blocks marked auto run first (e.g. "estimate calories" on save), if they haven't yet and
      // the fields they read have something in them. A failed run still saves what was typed.
      let vals = values;
      const answers: Record<string, string> = {};
      for (const c of spec.components) {
        if (c.type !== 'ai' || !c.auto || !c.id) continue;
        const done = c.fills ? vals[c.fills]?.trim() : vals[c.id]?.trim();
        const refs = promptFields(c.prompt).filter((id) => byId.has(id));
        const ready = refs.length ? refs.some((id) => vals[id]?.trim()) : Object.values(vals).some((v) => v?.trim());
        if (!done && ready) {
          const before = vals;
          vals = await run(c, vals);
          for (const k of Object.keys(vals)) if (vals[k] !== before[k]) answers[k] = vals[k];
        }
      }
      // Save what's in the form now (it may have been edited while the AI ran), plus the answers.
      if (Object.keys(answers).length) vals = { ...latest.current, ...answers };
      const filled = Object.fromEntries(Object.entries(vals).filter(([, v]) => v?.trim()));
      if (!Object.keys(filled).length) return;
      setEntries(await addEntry(appId, filled));
      setValues({});
      setSources({});
      setJustSaved(true);
      setSaveCount((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }, [appId, values, spec.components, run, saving, byId]);

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
        {c.type === 'input' && c.kind === 'yesno' ? (
          <View style={styles.chips}>
            {['Yes', 'No'].map((o) => (
              <Chip key={o} label={o} theme={theme} selected={values[c.id!] === o} onPress={() => set(c.id!, values[c.id!] === o ? '' : o)} />
            ))}
          </View>
        ) : c.type === 'input' && c.kind === 'rating' ? (
          <View style={styles.row} accessibilityRole="adjustable" accessibilityLabel={`${c.label}: ${values[c.id!] || 'not rated'} of 5`}>
            {[1, 2, 3, 4, 5].map((n) => {
              const on = Number(values[c.id!] || 0) >= n;
              return (
                <Pressable key={n} hitSlop={6} onPress={() => set(c.id!, values[c.id!] === String(n) ? '' : String(n))} accessibilityLabel={`${n} of 5`}>
                  <Icon name={on ? 'star' : 'star-outline'} size={30} color={on ? theme.accent : theme.subtle} />
                </Pressable>
              );
            })}
          </View>
        ) : c.type === 'input' && c.kind === 'date' ? (
          <View style={styles.row}>
            <TextInput
              value={values[c.id!] ?? ''}
              onChangeText={(v) => set(c.id!, v)}
              placeholder={c.placeholder || 'e.g. Mon, Nov 24'}
              placeholderTextColor={theme.subtle}
              accessibilityLabel={c.label}
              style={[styles.input, type.body, { flex: 1, backgroundColor: theme.surfaceAlt, color: theme.text }]}
            />
            <Chip
              label="Today"
              icon="calendar-outline"
              theme={theme}
              onPress={() => set(c.id!, new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))}
            />
          </View>
        ) : c.type === 'input' && c.kind === 'number' ? (
          <View style={styles.row}>
            <TextInput
              value={values[c.id!] ?? ''}
              onChangeText={(v) => set(c.id!, v.replace(/[^0-9.,-]/g, ''))}
              placeholder={c.placeholder || '0'}
              placeholderTextColor={theme.subtle}
              keyboardType="decimal-pad"
              accessibilityLabel={c.label}
              style={[styles.input, type.body, { flex: 1, backgroundColor: theme.surfaceAlt, color: theme.text }]}
            />
            {c.unit ? <Text style={[type.label, { color: theme.muted }]}>{c.unit}</Text> : null}
          </View>
        ) : c.type === 'choice' ? (
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
              disabled={!!busy || !canRun(c)}
              onPress={() => void run(c)}
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
                    {c.fills && values[c.fills] ? (
                      <View style={styles.row}>
                        <Icon name="arrow-forward-circle-outline" size={16} color={theme.accent} />
                        <Text style={[type.caption, { color: theme.text }]}>
                          Filled “{labels[c.fills] ?? c.fills}”: {values[c.fills]}
                        </Text>
                      </View>
                    ) : null}
                    {sources[c.id!] && <SourceBadge source={sources[c.id!]} />}
                  </>
                )}
              </View>
            )}
            {c.auto && !result && !loading ? (
              <Text style={[type.caption, { color: theme.subtle }]}>Runs by itself when you save.</Text>
            ) : null}
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
          <VoiceChat
            key={`${c.id}:${saveCount}`}
            c={c}
            values={values}
            fill={fill}
            theme={theme}
            onTranscript={(t) => set(c.id!, t)}
          />
        );
        return selectable ? selectable_(c, i, node, c.label, 'corner') : node;
      }
      case 'game': {
        const node = (
          <GameCard
            key={c.id}
            c={c}
            theme={theme}
            entries={entries}
            onFinish={async (score, by) => {
              setEntries(await addEntry(appId, { [c.id!]: String(score), ...(by ? { [`${c.id}_by`]: by } : {}) }));
            }}
          />
        );
        return selectable ? selectable_(c, i, node, c.label, 'corner') : node;
      }
      case 'random': {
        const node = (
          <RandomCard
            key={c.id}
            c={c}
            theme={theme}
            entries={entries}
            onResult={async (value) => {
              setEntries(await addEntry(appId, { [c.id!]: value }));
            }}
          />
        );
        return selectable ? selectable_(c, i, node, c.label, 'corner') : node;
      }
      case 'reminder': {
        const node = <ReminderBlock key={c.id} appId={appId} appName={spec.name} appEmoji={spec.emoji} c={c} theme={theme} />;
        return selectable ? selectable_(c, i, node, c.label, 'corner') : node;
      }
      case 'chart': {
        const series = daySeries(c, entries, c.days ?? 7, Date.now(), isChecklist(c.field));
        const max = Math.max(0, ...series.map((d) => d.value ?? 0));
        const known = series.filter((d) => d.value !== null);
        const today = series[series.length - 1]?.value ?? null;
        const avg = known.length ? known.reduce((a, d) => a + (d.value ?? 0), 0) / known.length : null;
        const node = (
          <Card key={c.id} theme={theme} style={{ gap: space(3) }}>
            <View style={styles.row}>
              <Icon name="bar-chart-outline" size={16} color={theme.accent} />
              <Text style={[type.label, { color: theme.text, flex: 1 }]}>{c.label}</Text>
              <Text style={[type.caption, { color: theme.muted }]}>
                Today {formatStat(today, c.unit)} · avg {formatStat(avg, c.unit)}
              </Text>
            </View>
            <View style={styles.chart} accessibilityLabel={`${c.label}: ${known.length} days with data`}>
              {series.map((d, k) => (
                <View key={d.day} style={styles.chartCol}>
                  <View
                    style={{
                      width: '70%',
                      height: d.value && max ? Math.max(6, (d.value / max) * 96) : 4,
                      borderRadius: 4,
                      backgroundColor: d.value ? (k === series.length - 1 ? theme.accent : theme.accentSoft) : theme.surfaceAlt,
                      borderWidth: d.value ? 1 : 0,
                      borderColor: theme.accent,
                    }}
                  />
                  {series.length <= 14 && (
                    <Text style={[type.caption, { color: theme.subtle, fontSize: 11 }]}>
                      {new Date(d.day).toLocaleDateString(undefined, { weekday: 'narrow' })}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          </Card>
        );
        return selectable ? selectable_(c, i, node, c.label, 'corner') : node;
      }
      case 'checklist': {
        const ticked = (values[c.id!] ?? '').split(CHECK_SEP).filter(Boolean);
        const toggle = (item: string) => {
          const next = ticked.includes(item) ? ticked.filter((t) => t !== item) : [...ticked, item];
          // Keep the list's own order so saved values read naturally.
          set(c.id!, (c.options ?? []).filter((o) => next.includes(o)).join(CHECK_SEP));
        };
        const node = (
          <Card key={c.id} theme={theme} style={{ gap: space(2) }}>
            <View style={styles.row}>
              <Text style={[type.label, { color: theme.text, flex: 1 }]}>{c.label}</Text>
              <Text style={[type.caption, { color: theme.muted }]}>
                {checklistCount(values[c.id!])}/{c.options?.length ?? 0} done
              </Text>
            </View>
            {(c.options ?? []).map((item) => {
              const on = ticked.includes(item);
              return (
                <Pressable
                  key={item}
                  onPress={() => toggle(item)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={[styles.row, { paddingVertical: space(1) }]}
                >
                  <Icon name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? theme.accent : theme.subtle} />
                  <Text style={[type.body, { color: theme.text, flexShrink: 1 }, on && { opacity: 0.6, textDecorationLine: 'line-through' }]}>
                    {item}
                  </Text>
                </Pressable>
              );
            })}
          </Card>
        );
        return selectable ? selectable_(c, i, node, c.label, 'corner') : node;
      }
      case 'save': {
        const node = (
          <View key="save" style={{ gap: space(2) }}>
            <Button
              label={saving && busy ? 'Thinking…' : (c.label ?? 'Save')}
              icon="checkmark"
              theme={theme}
              loading={saving}
              disabled={!hasInput || saving || !!busy}
              onPress={save}
            />
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
            byDay={c.groupBy === 'day'}
            units={units}
            kinds={kinds}
            total={c.total ? { field: c.total, unit: byId.get(c.total)?.unit, checklist: isChecklist(c.total) } : undefined}
          />
        );
        return selectable ? selectable_(c, i, node, c.label, 'corner') : node;
      }
      default:
        return null;
    }
  };

  const stat = (c: SpecComponent, i: number): ReactNode => {
    const op = (c.op ?? 'sum') as StatOp;
    const { value, n } = computeStat(c, entries, Date.now(), isChecklist(c.field));
    const node = (
      <View key={c.id} style={[styles.stat, { backgroundColor: theme.surface, borderColor: theme.border, boxShadow: theme.shadowSm }]}>
        <Text style={[type.overline, { color: theme.accent }]} numberOfLines={1}>
          {(c.label ?? '').toUpperCase()}
        </Text>
        <Text style={[type.title, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit>
          {op === 'streak' ? `${value ?? 0} ${value === 1 ? 'day' : 'days'}` : formatStat(value, c.unit)}
        </Text>
        <Text style={[type.caption, { color: theme.muted }]} numberOfLines={2}>
          {op === 'streak' ? 'in a row' : op === 'count' ? RANGE_LABEL[(c.range ?? 'today') as StatRange] : `${OP_LABEL[op]} · ${RANGE_LABEL[(c.range ?? 'today') as StatRange]}${n ? ` · ${n} ${n === 1 ? 'entry' : 'entries'}` : ''}`}
        </Text>
      </View>
    );
    return selectable ? selectable_(c, i, node, c.label, 'corner') : node;
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
        if (s.kind === 'stats') {
          const start = cursor;
          cursor += s.items.length;
          return (
            <FadeUp key={`s-${i}`} distance={6} style={styles.stats}>
              {s.items.map((c, j) => (
                <View key={c.id ?? j} style={styles.statCell}>
                  {stat(c, start + j)}
                </View>
              ))}
            </FadeUp>
          );
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
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space(3) },
  statCell: { flexGrow: 1, flexBasis: 140 },
  stat: { borderWidth: stroke, borderRadius: radius.lg, padding: space(4), gap: 2 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 2 },
  chartCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: space(1), height: '100%' },
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
