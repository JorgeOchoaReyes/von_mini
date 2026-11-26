/**
 * The inspector for the app being edited.
 *
 * Two modes, one panel:
 *   - a block is selected  -> edit that block's label, text, options or AI instruction;
 *   - nothing is selected  -> edit the app itself (name, emoji, colour) and add blocks.
 *
 * Every control writes straight into the spec, so the preview updates on the keystroke. This is
 * the fastest possible edit path: no model, no network, no waiting.
 */
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  addComponent,
  componentTitle,
  moveComponent,
  removeComponent,
  setDescription,
  setEmoji,
  setLabel,
  setName,
  setOptions,
  setPlaceholder,
  setPrompt,
  setAccent,
  setText,
  setAiFill,
  setGame,
  setRandom,
  setHistoryDays,
  setKind,
  setStat,
  setTimes,
  setUnit,
  toggleMultiline,
} from '../spec/edit';
import { GAME_INFO, GAME_KINDS } from '../games/GamePlayer';
import { OP_LABEL, RANGE_LABEL, STAT_OPS, STAT_RANGES } from '../spec/stats';
import { ACCENTS, INPUT_KINDS, type Accent, type AppSpec, type ComponentType, type InputKind } from '../spec/types';
import { Button, Card, Chip, Icon, IconButton, type IconName } from '../ui/components';
import { haptics } from '../ui/haptics';
import { FadeUp } from '../ui/motion';
import { stroke, ACCENT_COLORS, alpha, radius, space, type, useTheme } from '../ui/theme';

const ADDABLE: { type: ComponentType; label: string; icon: IconName }[] = [
  { type: 'input', label: 'Text field', icon: 'create-outline' },
  { type: 'choice', label: 'Choice', icon: 'radio-button-on-outline' },
  { type: 'checklist', label: 'Checklist', icon: 'checkbox-outline' },
  { type: 'game', label: 'Game', icon: 'game-controller-outline' },
  { type: 'random', label: 'Dice & chance', icon: 'dice-outline' },
  { type: 'stat', label: 'Stat', icon: 'stats-chart-outline' },
  { type: 'chart', label: 'Chart', icon: 'bar-chart-outline' },
  { type: 'ai', label: 'AI button', icon: 'sparkles-outline' },
  { type: 'voice', label: 'Voice chat', icon: 'mic-outline' },
  { type: 'reminder', label: 'Reminders', icon: 'alarm-outline' },
  { type: 'heading', label: 'Heading', icon: 'text-outline' },
  { type: 'text', label: 'Paragraph', icon: 'reorder-four-outline' },
];

const KIND_LABEL: Record<InputKind, string> = { text: 'Text', number: 'Number', yesno: 'Yes / No', rating: 'Rating', date: 'Date' };

/** A labelled row of chips for picking one value. */
function Pick<T extends string>({
  label,
  value,
  options,
  onChange,
  theme,
}: {
  label: string;
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange(v: T): void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={{ gap: space(2) }}>
      <Text style={[type.caption, { color: theme.muted }]}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((o) => (
          <Chip key={o.value || 'none'} label={o.label} theme={theme} selected={value === o.value} onPress={() => onChange(o.value)} />
        ))}
      </View>
    </View>
  );
}

/**
 * A labelled text input.
 *
 * Deliberately uncontrolled (`defaultValue`): every keystroke writes straight into the spec and
 * straight back into the live preview, so a local draft would only fight the store. Being
 * uncontrolled also means clearing the field stays cleared while you retype, even though the spec
 * refuses to store an empty label. The parent re-keys the editor when the selection changes, so
 * the fields always start from the spec's current text.
 */
function Field({
  label,
  value,
  onChange,
  multiline,
  placeholder,
  theme,
  hint,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  multiline?: boolean;
  placeholder?: string;
  theme: ReturnType<typeof useTheme>;
  hint?: string;
}) {
  return (
    <View style={{ gap: space(1) }}>
      <Text style={[type.overline, { color: theme.subtle }]}>{label.toUpperCase()}</Text>
      <TextInput
        defaultValue={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.subtle}
        multiline={multiline}
        accessibilityLabel={label}
        style={[
          styles.input,
          type.body,
          { backgroundColor: theme.surfaceAlt, color: theme.text },
          multiline && { minHeight: 72, textAlignVertical: 'top' },
        ]}
      />
      {hint ? <Text style={[type.caption, { color: theme.subtle }]}>{hint}</Text> : null}
    </View>
  );
}

export function SpecEditor({
  spec,
  index,
  onChange,
  onClose,
  style,
}: {
  spec: AppSpec;
  /** -1 means "app level" (name, emoji, colour, add blocks). */
  index: number;
  onChange(next: AppSpec, change: string): void;
  onClose?(): void;
  style?: object;
}) {
  const theme = useTheme(spec.accent);
  const c = index >= 0 ? spec.components[index] : undefined;
  const emit = (next: AppSpec, change: string) => {
    haptics.tap();
    onChange(next, change);
  };

  return (
    <FadeUp style={style} distance={8}>
      <Card theme={theme} style={{ gap: space(4) }}>
        <View style={styles.head}>
          <Icon name={c ? 'options-outline' : 'color-palette-outline'} size={16} color={theme.accent} />
          <Text style={[type.label, { color: theme.text, flex: 1 }]} numberOfLines={1}>
            {c ? componentTitle(c, index) : 'Appearance & blocks'}
          </Text>
          {onClose && <IconButton icon="close" label="Close editor" theme={theme} onPress={onClose} />}
        </View>

        {c ? (
          <BlockFields spec={spec} index={index} theme={theme} emit={emit} />
        ) : (
          <AppFields spec={spec} theme={theme} emit={emit} />
        )}
      </Card>
    </FadeUp>
  );
}

function BlockFields({
  spec,
  index,
  theme,
  emit,
}: {
  spec: AppSpec;
  index: number;
  theme: ReturnType<typeof useTheme>;
  emit(next: AppSpec, change: string): void;
}) {
  const c = spec.components[index];
  if (!c) return null;
  const title = componentTitle(c, index);
  // Fields on this screen another block can take a setting from (a dice count, a list to spin).
  const controlFields = spec.components.filter((f) => f.id && (f.type === 'choice' || f.type === 'input' || f.type === 'checklist'));

  return (
    <>
      {c.type === 'input' && (
        <>
          <Field label="Label" value={c.label ?? ''} onChange={(v) => emit(setLabel(spec, index, v), `Renamed the field to “${v}”.`)} theme={theme} />
          <Pick<InputKind>
            label="Holds"
            value={c.kind ?? 'text'}
            options={INPUT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
            onChange={(k) => emit(setKind(spec, index, k), `Made “${title}” a ${KIND_LABEL[k].toLowerCase()} field.`)}
            theme={theme}
          />
          {c.kind === 'number' && (
            <Field label="Unit" value={c.unit ?? ''} onChange={(v) => emit(setUnit(spec, index, v), `Changed the unit of “${title}”.`)} placeholder="kcal, $, min…" theme={theme} />
          )}
          <Field
            label="Placeholder"
            value={c.placeholder ?? ''}
            onChange={(v) => emit(setPlaceholder(spec, index, v), `Changed the placeholder for “${title}”.`)}
            placeholder="A concrete example"
            theme={theme}
          />
          {(!c.kind || c.kind === 'text') && <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: !!c.multiline }}
            onPress={() => emit(toggleMultiline(spec, index), `Made “${title}” ${c.multiline ? 'single-line' : 'multi-line'}.`)}
            style={styles.toggleRow}
          >
            <View style={[styles.check, { borderColor: c.multiline ? theme.accent : theme.border, backgroundColor: c.multiline ? theme.accent : 'transparent' }]}>
              {c.multiline && <Icon name="checkmark" size={13} color={theme.onAccent} />}
            </View>
            <Text style={[type.caption, { color: theme.text }]}>Allow long answers</Text>
          </Pressable>}
        </>
      )}

      {c.type === 'choice' && (
        <>
          <Field label="Label" value={c.label ?? ''} onChange={(v) => emit(setLabel(spec, index, v), `Renamed the choice to “${v}”.`)} theme={theme} />
          <Field
            label="Options (one per line)"
            value={(c.options ?? []).join('\n')}
            multiline
            onChange={(v) => {
              const options = v.split('\n').map((o) => o.trim()).filter(Boolean);
              if (options.length < 2) return;
              emit(setOptions(spec, index, options), `Updated the options for “${title}”.`);
            }}
            hint="Between 2 and 8 options."
            theme={theme}
          />
        </>
      )}

      {c.type === 'ai' && (
        <>
          <Field label="Button label" value={c.label ?? ''} onChange={(v) => emit(setLabel(spec, index, v), `Renamed the AI button to “${v}”.`)} theme={theme} />
          <Field
            label="What it asks the AI"
            value={c.prompt ?? ''}
            multiline
            onChange={(v) => emit(setPrompt(spec, index, v), `Changed what “${title}” asks the AI.`)}
            hint="Use {field_id} for what the user typed, {today_entries} or {entries} for what they saved before."
            theme={theme}
          />
          <Pick<string>
            label="Puts the answer in"
            value={c.fills ?? ''}
            options={[
              { value: '', label: 'Just shows it' },
              ...spec.components.filter((x) => x.type === 'input' && x.id).map((x) => ({ value: x.id!, label: x.label ?? x.id! })),
            ]}
            onChange={(f) => emit(setAiFill(spec, index, { fills: f }), `“${title}” now fills in a field.`)}
            theme={theme}
          />
          <Pick<'tap' | 'auto'>
            label="Runs"
            value={c.auto ? 'auto' : 'tap'}
            options={[
              { value: 'tap', label: 'When tapped' },
              { value: 'auto', label: 'Also on save' },
            ]}
            onChange={(v) => emit(setAiFill(spec, index, { auto: v === 'auto' }), `“${title}” ${v === 'auto' ? 'now runs when you save' : 'runs when tapped'}.`)}
            theme={theme}
          />
        </>
      )}

      {c.type === 'checklist' && (
        <>
          <Field label="Title" value={c.label ?? ''} onChange={(v) => emit(setLabel(spec, index, v), `Renamed the checklist to “${v}”.`)} theme={theme} />
          <Field
            label="Items (one per line)"
            value={(c.options ?? []).join('\n')}
            multiline
            onChange={(v) => {
              const items = v.split('\n').map((o) => o.trim()).filter(Boolean);
              if (items.length) emit(setOptions(spec, index, items), `Updated the items in “${title}”.`);
            }}
            hint="Up to 12. Each save records which ones were done."
            theme={theme}
          />
        </>
      )}

      {(c.type === 'stat' || c.type === 'chart') && (
        <>
          <Field label="Title" value={c.label ?? ''} onChange={(v) => emit(setLabel(spec, index, v), `Renamed “${title}”.`)} theme={theme} />
          <Pick<string>
            label="Counts"
            value={c.field ?? ''}
            options={[
              { value: '', label: 'Entries' },
              ...spec.components
                .filter(
                  (x) =>
                    x.id &&
                    ((x.type === 'input' && (x.kind === 'number' || x.kind === 'rating' || x.kind === 'yesno')) ||
                      x.type === 'choice' ||
                      x.type === 'checklist' ||
                      (x.type === 'ai' && !x.fills && /number|score|rate|1-10|count/i.test(x.prompt ?? ''))),
                )
                .map((x) => ({ value: x.id!, label: x.label ?? x.id! })),
            ]}
            onChange={(f) => emit(setStat(spec, index, f ? { field: f, op: c.op === 'count' ? 'sum' : c.op } : { field: '', op: 'count' }), `Changed what “${title}” counts.`)}
            theme={theme}
          />
          {c.field ? (
            <Pick
              label="How"
              value={c.op ?? 'sum'}
              options={STAT_OPS.filter((o) => c.type === 'stat' || (o !== 'latest' && o !== 'streak')).map((o) => ({ value: o, label: OP_LABEL[o] }))}
              onChange={(op) => emit(setStat(spec, index, { op }), `Changed what “${title}” counts.`)}
              theme={theme}
            />
          ) : null}
          {c.type === 'stat' && c.op !== 'streak' && (
            <Pick
              label="Over"
              value={c.range ?? 'today'}
              options={STAT_RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }))}
              onChange={(range) => emit(setStat(spec, index, { range }), `Changed what “${title}” counts.`)}
              theme={theme}
            />
          )}
          <Field label="Unit" value={c.unit ?? ''} onChange={(v) => emit(setUnit(spec, index, v), `Changed the unit of “${title}”.`)} placeholder="kcal, $, min…" theme={theme} />
        </>
      )}

      {c.type === 'random' && (
        <>
          <Field label="Button" value={c.label ?? ''} onChange={(v) => emit(setLabel(spec, index, v), `Renamed “${title}” to “${v}”.`)} theme={theme} />
          <Pick<NonNullable<typeof c.roll>>
            label="What it does"
            value={c.roll ?? 'dice'}
            options={[
              { value: 'dice', label: 'Dice' },
              { value: 'coin', label: 'Coin' },
              { value: 'pick', label: 'Spin a list' },
              { value: 'number', label: 'Number' },
            ]}
            onChange={(r) => emit(setRandom(spec, index, { roll: r }), `“${title}” now picks differently.`)}
            theme={theme}
          />
          {((c.roll ?? 'dice') === 'dice' || c.roll === 'pick') && controlFields.length > 0 && (
            <Pick<string>
              label={c.roll === 'pick' ? 'Spin from' : 'How many dice'}
              value={(c.roll === 'pick' ? c.optionsFrom : c.countFrom) ?? ''}
              options={[
                { value: '', label: c.roll === 'pick' ? 'The list below' : 'Set here' },
                ...controlFields.map((f) => ({ value: f.id!, label: `From “${f.label ?? f.id}”` })),
              ]}
              onChange={(id) =>
                emit(
                  setRandom(spec, index, c.roll === 'pick' ? { optionsFrom: id } : { countFrom: id }),
                  id ? `“${title}” now follows “${controlFields.find((f) => f.id === id)?.label ?? id}”.` : `“${title}” uses its own setting again.`,
                )
              }
              theme={theme}
            />
          )}
          {(c.roll ?? 'dice') === 'dice' && (
            <>
              <Field label="How many dice (1-6)" value={String(c.count ?? 1)} onChange={(v) => emit(setRandom(spec, index, { count: parseInt(v, 10) }), `Changed the dice in “${title}”.`)} theme={theme} />
              <Field label="Sides on each" value={String(c.sides ?? 6)} onChange={(v) => emit(setRandom(spec, index, { sides: parseInt(v, 10) }), `Changed the dice in “${title}”.`)} theme={theme} />
            </>
          )}
          {c.roll === 'number' && (
            <>
              <Field label="From" value={String(c.min ?? 1)} onChange={(v) => emit(setRandom(spec, index, { min: parseInt(v, 10) }), `Changed the range of “${title}”.`)} theme={theme} />
              <Field label="To" value={String(c.max ?? 100)} onChange={(v) => emit(setRandom(spec, index, { max: parseInt(v, 10) }), `Changed the range of “${title}”.`)} theme={theme} />
            </>
          )}
          {c.roll === 'pick' && (
            <Field
              label="Options (one per line)"
              value={(c.options ?? []).join('\n')}
              multiline
              onChange={(v) => emit(setOptions(spec, index, v.split('\n')), `Updated the options in “${title}”.`)}
              hint="At least 2, up to 20."
              theme={theme}
            />
          )}
        </>
      )}
      {c.type === 'game' && (
        <>
          <Field label="Title" value={c.label ?? ''} onChange={(v) => emit(setLabel(spec, index, v), `Renamed the game to “${v}”.`)} theme={theme} />
          <Pick<NonNullable<typeof c.game>>
            label="Game"
            value={c.game}
            options={GAME_KINDS.map((g) => ({ value: g, label: GAME_INFO[g].name }))}
            onChange={(g) => emit(setGame(spec, index, { game: g }), `Made “${title}” a ${GAME_INFO[g].name.toLowerCase()} game.`)}
            theme={theme}
          />
          <Pick<NonNullable<typeof c.speed>>
            label="Speed"
            value={c.speed ?? 'normal'}
            options={[
              { value: 'slow', label: 'Relaxed' },
              { value: 'normal', label: 'Normal' },
              { value: 'fast', label: 'Fast' },
            ]}
            onChange={(sp) => emit(setGame(spec, index, { speed: sp }), `Changed the speed of “${title}”.`)}
            theme={theme}
          />
          {GAME_INFO[c.game ?? 'runner'].player ? (
            <Field
              label="Player (emoji)"
              value={c.player ?? ''}
              onChange={(v) => emit(setGame(spec, index, { player: v }), `Changed the look of “${title}”.`)}
              placeholder={GAME_INFO[c.game ?? 'runner'].player}
              theme={theme}
            />
          ) : null}
          {GAME_INFO[c.game ?? 'runner'].item ? (
            <Field
              label={c.game === 'snake' ? 'Food (emoji)' : c.game === 'catch' ? 'Good catch (emoji)' : c.game === 'whack' ? 'Target (emoji)' : 'Enemy or obstacle (emoji)'}
              value={c.item ?? ''}
              onChange={(v) => emit(setGame(spec, index, { item: v }), `Changed the look of “${title}”.`)}
              placeholder={GAME_INFO[c.game ?? 'runner'].item}
              theme={theme}
            />
          ) : null}
        </>
      )}

      {c.type === 'voice' && (
        <>
          <Field label="Title" value={c.label ?? ''} onChange={(v) => emit(setLabel(spec, index, v), `Renamed the voice chat to “${v}”.`)} theme={theme} />
          <Field
            label="Who the AI plays"
            value={c.prompt ?? ''}
            multiline
            onChange={(v) => emit(setPrompt(spec, index, v), `Changed who the AI plays in “${title}”.`)}
            hint="Its role and goal, e.g. a tough interviewer. Use {field_id} to insert what the user typed."
            theme={theme}
          />
          <Field
            label="Opening line"
            value={c.text ?? ''}
            multiline
            onChange={(v) => emit(setText(spec, index, v), `Changed how “${title}” opens.`)}
            hint="What the AI says first. Leave empty to let the user speak first."
            theme={theme}
          />
        </>
      )}

      {c.type === 'reminder' && (
        <>
          <Field label="Title" value={c.label ?? ''} onChange={(v) => emit(setLabel(spec, index, v), `Renamed the reminder to “${v}”.`)} theme={theme} />
          <Field
            label="Notification message"
            value={c.text ?? ''}
            onChange={(v) => emit(setText(spec, index, v), 'Changed the reminder message.')}
            theme={theme}
          />
          <Field
            label="Times"
            value={(c.times ?? []).join(', ')}
            onChange={(v) => emit(setTimes(spec, index, v), 'Changed the reminder times.')}
            hint="Daily, 24-hour or am/pm, separated by commas: 8:00, 1pm, 19:30. Up to 6."
            theme={theme}
          />
        </>
      )}

      {(c.type === 'heading' || c.type === 'text') && (
        <Field
          label="Text"
          value={c.text ?? ''}
          multiline
          onChange={(v) => emit(setText(spec, index, v), `Reworded the ${c.type}.`)}
          theme={theme}
        />
      )}

      {(c.type === 'save' || c.type === 'history') && (
        <Field label="Label" value={c.label ?? ''} onChange={(v) => emit(setLabel(spec, index, v), `Renamed “${title}”.`)} theme={theme} />
      )}

      {c.type === 'history' && (
        <Pick<string>
          label="Group by day, with a daily total of"
          value={c.total ?? (c.groupBy === 'day' ? '-' : '')}
          options={[
            { value: '', label: 'Don’t group' },
            { value: '-', label: 'Just group' },
            ...spec.components
              .filter((x) => x.id && ((x.type === 'input' && x.kind === 'number') || x.type === 'checklist'))
              .map((x) => ({ value: x.id!, label: x.label ?? x.id! })),
          ]}
          onChange={(v) =>
            emit(setHistoryDays(spec, index, v === '' ? { byDay: false, total: '' } : v === '-' ? { byDay: true, total: '' } : { total: v }), 'Changed how history is grouped.')
          }
          theme={theme}
        />
      )}

      <View style={styles.row}>
        <Button
          label="Move up"
          icon="arrow-up"
          variant="secondary"
          size="sm"
          theme={theme}
          disabled={index === 0}
          onPress={() => emit(moveComponent(spec, index, -1), `Moved “${title}” up.`)}
        />
        <Button
          label="Move down"
          icon="arrow-down"
          variant="secondary"
          size="sm"
          theme={theme}
          disabled={index === spec.components.length - 1}
          onPress={() => emit(moveComponent(spec, index, 1), `Moved “${title}” down.`)}
        />
        <View style={{ flex: 1 }} />
        <Button label="Delete" icon="trash-outline" variant="danger" size="sm" theme={theme} onPress={() => emit(removeComponent(spec, index), `Removed the “${title}” block.`)} />
      </View>
    </>
  );
}

function AppFields({
  spec,
  theme,
  emit,
}: {
  spec: AppSpec;
  theme: ReturnType<typeof useTheme>;
  emit(next: AppSpec, change: string): void;
}) {
  return (
    <>
      <View style={styles.row}>
        <View style={{ width: 84 }}>
          <Field
            label="Emoji"
            value={spec.emoji}
            onChange={(v) => emit(setEmoji(spec, v), 'Updated the look.')}
            theme={theme}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Name" value={spec.name} onChange={(v) => emit(setName(spec, v), `Renamed the app to “${v}”.`)} theme={theme} />
        </View>
      </View>
      <Field
        label="One-line description"
        value={spec.description}
        onChange={(v) => emit(setDescription(spec, v), 'Reworded the description.')}
        placeholder="What does this app do for you?"
        theme={theme}
      />
      <View style={{ gap: space(2) }}>
        <Text style={[type.overline, { color: theme.subtle }]}>COLOUR</Text>
        <View style={styles.row}>
          {ACCENTS.map((a) => {
            const on = a === spec.accent;
            const color = ACCENT_COLORS[a][theme.scheme];
            return (
              <Pressable
                key={a}
                accessibilityRole="button"
                accessibilityLabel={`Use the ${a} colour`}
                accessibilityState={{ selected: on }}
                onPress={() => emit(setAccent(spec, a as Accent), 'Updated the look.')}
                style={[
                  styles.swatch,
                  { backgroundColor: color, borderColor: on ? theme.text : 'transparent', transform: [{ scale: on ? 1.1 : 1 }] },
                ]}
              >
                {on && <Icon name="checkmark" size={14} color="#fff" />}
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={{ gap: space(2) }}>
        <Text style={[type.overline, { color: theme.subtle }]}>ADD A BLOCK</Text>
        <View style={styles.row}>
          {ADDABLE.map((a) => (
            <Chip
              key={a.type}
              label={a.label}
              icon={a.icon}
              theme={theme}
              disabled={spec.components.length >= 12}
              onPress={() => emit(addComponent(spec, a.type), `Added a ${a.label.toLowerCase()}.`)}
            />
          ))}
        </View>
      </View>
      <Text style={[type.caption, { color: theme.subtle }]}>
        These edits are applied instantly on this device — no AI call needed, so they work offline.
      </Text>
      <View style={[styles.hintRow, { backgroundColor: alpha(theme.accent, 0.08) }]}>
        <Icon name="information-circle-outline" size={15} color={theme.accent} />
        <Text style={[type.caption, { color: theme.muted, flex: 1 }]}>
          Tip: tap any block in the preview to edit just that block.
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  head: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2), flexWrap: 'wrap' },
  input: { borderRadius: radius.md, paddingHorizontal: space(3), paddingVertical: space(2) },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  check: { width: 20, height: 20, borderRadius: 6, borderWidth: stroke, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 32, height: 32, borderRadius: radius.pill, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: space(2), padding: space(3), borderRadius: radius.md },
});
