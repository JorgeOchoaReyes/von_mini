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
  setTimes,
  toggleMultiline,
} from '../spec/edit';
import { ACCENTS, type Accent, type AppSpec, type ComponentType } from '../spec/types';
import { Button, Card, Chip, Icon, IconButton, type IconName } from '../ui/components';
import { haptics } from '../ui/haptics';
import { FadeUp } from '../ui/motion';
import { ACCENT_COLORS, alpha, radius, space, type, useTheme } from '../ui/theme';

const ADDABLE: { type: ComponentType; label: string; icon: IconName }[] = [
  { type: 'input', label: 'Text field', icon: 'create-outline' },
  { type: 'choice', label: 'Choice', icon: 'radio-button-on-outline' },
  { type: 'ai', label: 'AI button', icon: 'sparkles-outline' },
  { type: 'voice', label: 'Voice chat', icon: 'mic-outline' },
  { type: 'reminder', label: 'Reminders', icon: 'alarm-outline' },
  { type: 'heading', label: 'Heading', icon: 'text-outline' },
  { type: 'text', label: 'Paragraph', icon: 'reorder-four-outline' },
];

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
      <Text style={[type.overline, { color: theme.subtle }]}>{label}</Text>
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

  return (
    <>
      {c.type === 'input' && (
        <>
          <Field label="Label" value={c.label ?? ''} onChange={(v) => emit(setLabel(spec, index, v), `Renamed the field to “${v}”.`)} theme={theme} />
          <Field
            label="Placeholder"
            value={c.placeholder ?? ''}
            onChange={(v) => emit(setPlaceholder(spec, index, v), `Changed the placeholder for “${title}”.`)}
            placeholder="A concrete example"
            theme={theme}
          />
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: !!c.multiline }}
            onPress={() => emit(toggleMultiline(spec, index), `Made “${title}” ${c.multiline ? 'single-line' : 'multi-line'}.`)}
            style={styles.toggleRow}
          >
            <View style={[styles.check, { borderColor: c.multiline ? theme.accent : theme.border, backgroundColor: c.multiline ? theme.accent : 'transparent' }]}>
              {c.multiline && <Icon name="checkmark" size={13} color={theme.onAccent} />}
            </View>
            <Text style={[type.caption, { color: theme.text }]}>Allow long answers</Text>
          </Pressable>
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
            hint="Use {field_id} to insert what the user typed."
            theme={theme}
          />
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
        <Text style={[type.overline, { color: theme.subtle }]}>Colour</Text>
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
        <Text style={[type.overline, { color: theme.subtle }]}>Add a block</Text>
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
  head: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2), flexWrap: 'wrap' },
  input: { borderRadius: radius.md, paddingHorizontal: space(3), paddingVertical: space(2) },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  check: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 32, height: 32, borderRadius: radius.pill, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: space(2), padding: space(3), borderRadius: radius.md },
});
