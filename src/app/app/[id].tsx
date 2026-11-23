/**
 * The builder: your app on one side, the ways to change it on the other.
 *
 * Wide screens show chat and preview side by side; phones stack them as tabs. Three edit paths
 * share one pipeline, and every one of them lands in the version history:
 *
 *   1. tap a block in the preview -> edit that block's properties directly (no model, instant);
 *   2. tap a quick-edit chip     -> a pure function over the spec (no model, instant);
 *   3. describe a change in words -> the model rewrites the spec, streaming as it goes.
 *
 * Paths 1 and 2 work with no network and no Gemini Nano at all, because an app here is a small
 * JSON document rather than generated code.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAI } from '../../ai/AIContext';
import { buildCustomHtml } from '../../ai/hybrid';
import { ChangeSummary, ChatPanel } from '../../chat/ChatPanel';
import { HistoryPanel } from '../../chat/HistoryPanel';
import { isBusy, notifyAppsChanged, useChatVersion } from '../../chat/chatJobs';
import { HtmlRunner } from '../../runtime/HtmlRunner';
import { SpecEditor } from '../../runtime/SpecEditor';
import { SpecRenderer } from '../../runtime/SpecRenderer';
import { describeChanges } from '../../spec/diff';
import { findIndex } from '../../spec/edit';
import type { AppSpec } from '../../spec/types';
import { deleteApp, getApp, pushVersion, saveApp, type SavedApp, type Version } from '../../storage/store';
import { Button, Card, Chip, Icon, IconButton, ModePill, SourceBadge, type IconName } from '../../ui/components';
import { haptics } from '../../ui/haptics';
import { FadeUp } from '../../ui/motion';
import { MAX_WIDTH, MAX_WIDTH_WIDE, WIDE, radius, space, type, useTheme } from '../../ui/theme';

type Tab = 'preview' | 'chat' | 'history' | 'custom';

/** How long to wait after the last keystroke in the inspector before writing a version. */
const COMMIT_MS = 700;

export default function AppScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ai = useAI();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const chatVersion = useChatVersion();

  const [app, setApp] = useState<SavedApp | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('preview');
  const [selected, setSelected] = useState<string | null>(null);
  const [editingApp, setEditingApp] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [lastChange, setLastChange] = useState<{ changes: string[]; prev: AppSpec } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const appRef = useRef<SavedApp | null>(null);
  const dirty = useRef<{ spec: AppSpec; changes: string[]; prev: AppSpec; origin: Version['origin'] } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    appRef.current = app ?? null;
  }, [app]);

  /**
   * Writes the pending inspector changes and records one version for the whole burst of
   * keystrokes, so typing a new label does not create fifteen versions.
   */
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const d = dirty.current;
    const current = appRef.current;
    if (!d || !current) return;
    dirty.current = null;
    await saveApp({ ...current, spec: d.spec });
    await pushVersion(current.id, d.spec, d.changes, d.origin, current.builtWith);
    notifyAppsChanged();
  }, []);

  // Reload whenever a chat job (possibly started earlier) updates this app.
  useEffect(() => {
    let alive = true;
    // Mid-edit changes win: they are newer than anything in storage.
    if (dirty.current) return;
    getApp(id).then((a) => {
      if (!alive) return;
      const before = appRef.current;
      // A chat edit lands in storage behind our back; surface the same "what changed" summary the
      // direct edits get, computed locally from the two specs so it is always accurate.
      if (a && before && before.id === a.id && JSON.stringify(before.spec) !== JSON.stringify(a.spec)) {
        const changes = describeChanges(before.spec, a.spec);
        if (changes.length) setLastChange({ changes, prev: before.spec });
      }
      setApp(a ?? null);
    });
    return () => {
      alive = false;
    };
  }, [id, chatVersion]);

  // Leaving the screen must not lose the last keystroke.
  useEffect(() => () => void flush(), [flush]);

  /** The single funnel every edit goes through. */
  const edit = useCallback(
    (next: AppSpec, change: string, origin: Version['origin'] = 'manual') => {
      const prev = appRef.current?.spec;
      if (!prev) return;
      setApp((a) => (a ? { ...a, spec: next } : a));
      appRef.current = appRef.current ? { ...appRef.current, spec: next } : null;
      const pending = dirty.current;
      const burst = {
        spec: next,
        changes: pending ? [...pending.changes, change] : [change],
        prev: pending ? pending.prev : prev,
        origin: pending ? pending.origin : origin,
      };
      dirty.current = burst;
      setLastChange({ changes: burst.changes, prev: burst.prev });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), COMMIT_MS);
    },
    [flush],
  );

  const undoLast = useCallback(() => {
    if (!lastChange) return;
    haptics.tap();
    const prev = lastChange.prev;
    setLastChange(null);
    edit(prev, 'Undid the last change.', 'restore');
    setLastChange(null);
  }, [edit, lastChange]);

  /** A restore already saved and recorded its own version, so this only syncs the screen. */
  const onRestored = useCallback((spec: AppSpec) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    dirty.current = null;
    setLastChange(null);
    setApp((a) => (a ? { ...a, spec } : a));
    notifyAppsChanged();
  }, []);

  const makeCustom = async () => {
    if (!app) return;
    setBusy(true);
    setError(null);
    setActionsOpen(false);
    try {
      const html = await buildCustomHtml(app.request, ai, app.spec);
      const next = { ...app, html };
      await saveApp(next);
      setApp(next);
      setTab('custom');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!app) return;
    const go = async () => {
      await deleteApp(app.id);
      router.back();
    };
    setActionsOpen(false);
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete ${app.spec.name} and its saved data?`)) void go();
    } else {
      Alert.alert('Delete app?', `${app.spec.name} and its saved data will be removed from this device.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void go() },
      ]);
    }
  };

  const editorIndex = useMemo(() => {
    if (editingApp) return -1;
    if (!selected || !app) return null;
    const i = findIndex(app.spec, selected);
    return i >= 0 ? i : null;
  }, [editingApp, selected, app]);

  const openApp = app && app !== undefined ? app : null;
  const appTheme = useTheme(openApp?.spec.accent);

  if (app === undefined) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
  if (app === null) {
    return (
      <View style={[styles.missing, { backgroundColor: theme.bg }]}>
        <Text style={[type.body, { color: theme.text }]}>This app no longer exists.</Text>
        <Button label="Back home" theme={theme} onPress={() => router.replace('/')} />
      </View>
    );
  }

  const canCustom = ai.online && !ai.privateMode && !ai.locked;
  const chatBusy = isBusy(app.id);

  const preview = (
    <View style={{ flex: 1, backgroundColor: appTheme.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.previewPage, wide && { maxWidth: MAX_WIDTH_WIDE }]}
        keyboardShouldPersistTaps="handled"
        // Selecting a block docks the inspector below; keep the preview from jumping.
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      >
        {lastChange && (
          <ChangeSummary
            changes={lastChange.changes}
            theme={appTheme}
            onUndo={undoLast}
            onDismiss={() => setLastChange(null)}
            onShowHistory={() => {
              setLastChange(null);
              setTab('history');
            }}
          />
        )}

        <View style={[styles.hero, { backgroundColor: appTheme.accentSoft }]}>
          <View style={[styles.heroIcon, { backgroundColor: appTheme.surface }]}>
            <Text style={styles.heroEmoji}>{app.spec.emoji}</Text>
          </View>
          <View style={{ flex: 1, gap: space(1) }}>
            <Text style={[type.title, { color: appTheme.text }]} numberOfLines={1}>
              {app.spec.name}
            </Text>
            {app.spec.description ? (
              <Text style={[type.caption, { color: appTheme.muted }]} numberOfLines={2}>
                {app.spec.description}
              </Text>
            ) : null}
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              <SourceBadge source={app.builtWith} />
              <Text style={[type.caption, { color: appTheme.subtle }]}>{app.spec.components.length} blocks</Text>
            </View>
          </View>
        </View>

        <View style={styles.row}>
          <Chip
            label="Edit appearance"
            icon="color-palette-outline"
            theme={appTheme}
            selected={editingApp}
            onPress={() => {
              setSelected(null);
              setEditingApp((v) => !v);
            }}
          />
          <Text style={[type.caption, { color: appTheme.subtle, flex: 1 }]} numberOfLines={2}>
            Tap any block to edit just that block.
          </Text>
        </View>

        {/* Keyed by app id, not by spec: editing a label must not remount the whole preview. */}
        <SpecRenderer
          key={app.id}
          appId={app.id}
          spec={app.spec}
          selectable
          selectedKey={selected}
          onSelect={(k) => {
            setEditingApp(false);
            setSelected(k);
          }}
        />

        <View style={[styles.footer, { borderColor: appTheme.border }]}>
          <Text style={[type.caption, { color: appTheme.subtle, flex: 1 }]}>
            {app.builtWith === 'starter'
              ? 'A ready-made app. Change it and it becomes yours.'
              : `Built from: “${app.request}”`}
          </Text>
          <IconButton
            icon={actionsOpen ? 'close' : 'ellipsis-horizontal'}
            label="More actions"
            theme={appTheme}
            onPress={() => setActionsOpen((v) => !v)}
          />
        </View>

        {actionsOpen && (
          <Card theme={appTheme} style={{ gap: space(3) }}>
            <ActionRow
              icon="color-wand-outline"
              title={app.html ? 'Regenerate the custom version' : 'Make it custom'}
              body={
                canCustom
                  ? 'Gemini writes a fully custom design. Its AI still runs on-device.'
                  : ai.locked
                    ? 'Needs the cloud; this build is on-device only.'
                    : 'Needs the cloud. Go online and turn off private mode.'
              }
              onPress={makeCustom}
              theme={appTheme}
              disabled={!canCustom}
              loading={busy}
            />
            {app.builtWith !== 'starter' && (
              <ActionRow icon="trash-outline" title="Delete this app" onPress={remove} theme={appTheme} danger />
            )}
            {error && <Text style={[type.caption, { color: appTheme.danger }]}>{error}</Text>}
          </Card>
        )}
      </ScrollView>

      {/*
        The inspector is docked rather than placed in the scroll content: tapping a block must
        reveal its controls immediately, wherever the user happens to be scrolled to.
      */}
      {editorIndex !== null && (
        <View style={[styles.dock, { borderColor: appTheme.border, backgroundColor: appTheme.bg }]}>
          <ScrollView style={{ maxHeight: 330 }} contentContainerStyle={styles.dockBody} keyboardShouldPersistTaps="handled">
            <SpecEditor
              // Re-key on selection so the inspector's fields start from the spec's current text.
              key={`${app.id}:${editorIndex}`}
              spec={app.spec}
              index={editorIndex}
              onChange={(next, change) => edit(next, change, 'manual')}
              onClose={() => {
                setEditingApp(false);
                setSelected(null);
              }}
            />
          </ScrollView>
        </View>
      )}
    </View>
  );

  const sidePanel = (
    <View style={[styles.side, { borderColor: appTheme.border, backgroundColor: appTheme.bg }]}>
      <View style={{ padding: space(3), paddingBottom: 0 }}>
        <Segmented_
          theme={appTheme}
          value={tab === 'history' ? 'history' : 'chat'}
          onChange={(v) => setTab(v)}
          chatDot={chatBusy}
        />
      </View>
      {tab === 'history' ? (
        <HistoryPanel appId={app.id} current={app.spec} version={chatVersion} onRestored={onRestored} />
      ) : (
        <ChatPanel
          appId={app.id}
          spec={app.spec}
          onShowApp={() => setTab('preview')}
          onLocalEdit={(next, change) => edit(next, change, 'manual')}
          onShowHistory={() => setTab('history')}
        />
      )}
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, backgroundColor: appTheme.bg }}>
        <View
          style={[
            styles.header,
            {
              paddingTop: (Platform.OS === 'web' ? 0 : insets.top) + space(2),
              borderColor: appTheme.border,
              backgroundColor: appTheme.bg,
            },
          ]}
        >
          <IconButton icon="chevron-back" label="Back" theme={appTheme} onPress={() => router.back()} />
          <Text style={[type.label, { color: appTheme.text, flex: 1 }]} numberOfLines={1}>
            {app.spec.emoji} {app.spec.name}
          </Text>
          {wide && (
            <ModePill
              status={ai.deviceStatus}
              online={ai.online}
              privateMode={ai.privateMode}
              locked={ai.locked}
              onPress={() => router.push('/settings')}
            />
          )}
          <IconButton
            icon="time-outline"
            label="Version history"
            theme={appTheme}
            filled={tab === 'history'}
            onPress={() => setTab('history')}
          />
        </View>

        {wide ? (
          <View style={styles.wide}>
            <View style={styles.widePreview}>{preview}</View>
            <View style={styles.wideSide}>{sidePanel}</View>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <View style={{ paddingHorizontal: space(4), paddingBottom: space(2) }}>
              <Tabs theme={appTheme} value={tab} onChange={setTab} hasCustom={!!app.html} chatDot={chatBusy} />
            </View>
            {tab === 'preview' && preview}
            {tab === 'chat' && <ChatPanel
              appId={app.id}
              spec={app.spec}
              onShowApp={() => setTab('preview')}
              onLocalEdit={(next, change) => edit(next, change, 'manual')}
              onShowHistory={() => setTab('history')}
            />}
            {tab === 'history' && (
              <HistoryPanel appId={app.id} current={app.spec} version={chatVersion} onRestored={onRestored} />
            )}
            {tab === 'custom' && app.html && <HtmlRunner appId={app.id} html={app.html} accent={app.spec.accent} />}
          </View>
        )}
      </View>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Small local pieces
 * ------------------------------------------------------------------ */

function ActionRow({
  icon,
  title,
  body,
  onPress,
  theme,
  disabled,
  loading,
  danger,
}: {
  icon: IconName;
  title: string;
  body?: string;
  onPress(): void;
  theme: ReturnType<typeof useTheme>;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
}) {
  const color = danger ? theme.danger : theme.accent;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.action, { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.actionIcon, { backgroundColor: danger ? `${theme.danger}18` : theme.accentSoft }]}>
        <Icon name={icon} size={18} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: danger ? theme.danger : theme.text }]}>{loading ? 'Working…' : title}</Text>
        {body ? <Text style={[type.caption, { color: theme.muted }]}>{body}</Text> : null}
      </View>
    </Pressable>
  );
}

/** The two-panel switcher used in the side column on wide screens. */
function Segmented_({
  value,
  onChange,
  theme,
  chatDot,
}: {
  value: 'chat' | 'history';
  onChange(v: 'chat' | 'history'): void;
  theme: ReturnType<typeof useTheme>;
  chatDot?: boolean;
}) {
  const options: { value: 'chat' | 'history'; label: string; icon: IconName; dot?: boolean }[] = [
    { value: 'chat', label: 'Chat', icon: 'chatbubble-ellipses-outline', dot: chatDot },
    { value: 'history', label: 'History', icon: 'time-outline' },
  ];
  return (
    <View style={[styles.segmented, { backgroundColor: theme.surfaceAlt }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              if (!on) haptics.tap();
              onChange(o.value);
            }}
            style={[styles.segment, on && { backgroundColor: theme.surface, boxShadow: theme.shadowSm }]}
          >
            <Icon name={o.icon} size={15} color={on ? theme.accent : theme.muted} />
            <Text style={[type.label, { color: on ? theme.text : theme.muted }]}>{o.label}</Text>
            {o.dot && <View style={[styles.dot, { backgroundColor: theme.accent }]} />}
          </Pressable>
        );
      })}
    </View>
  );
}

/** The stacked switcher used on phones. */
function Tabs({
  value,
  onChange,
  theme,
  hasCustom,
  chatDot,
}: {
  value: Tab;
  onChange(v: Tab): void;
  theme: ReturnType<typeof useTheme>;
  hasCustom: boolean;
  chatDot?: boolean;
}) {
  const options: { value: Tab; label: string; icon: IconName; dot?: boolean }[] = [
    { value: 'preview', label: 'App', icon: 'apps-outline' },
    { value: 'chat', label: 'Edit', icon: 'chatbubble-ellipses-outline', dot: chatDot },
    { value: 'history', label: 'History', icon: 'time-outline' },
    ...(hasCustom ? [{ value: 'custom' as const, label: 'Custom', icon: 'color-wand-outline' as const }] : []),
  ];
  return (
    <FadeUp distance={4}>
      <View style={[styles.segmented, { backgroundColor: theme.surfaceAlt }]}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => {
                if (!on) haptics.tap();
                onChange(o.value);
              }}
              style={[styles.segment, on && { backgroundColor: theme.surface, boxShadow: theme.shadowSm }]}
            >
              <Icon name={o.icon} size={15} color={on ? theme.accent : theme.muted} />
              <Text style={[type.caption, { color: on ? theme.text : theme.muted, fontWeight: '600' }]}>{o.label}</Text>
              {o.dot && <View style={[styles.dot, { backgroundColor: theme.accent }]} />}
            </Pressable>
          );
        })}
      </View>
    </FadeUp>
  );
}

const styles = StyleSheet.create({
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(4), padding: space(6) },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    paddingHorizontal: space(3),
    paddingBottom: space(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  wide: { flex: 1, flexDirection: 'row' },
  widePreview: { flex: 1 },
  wideSide: { width: 420, maxWidth: '45%' },
  side: { flex: 1, borderLeftWidth: StyleSheet.hairlineWidth },
  previewPage: { padding: space(4), paddingBottom: space(12), gap: space(4), maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  hero: { flexDirection: 'row', gap: space(4), padding: space(4), borderRadius: radius.xl, alignItems: 'center' },
  heroIcon: { width: 64, height: 64, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  heroEmoji: { fontSize: 34 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space(2), borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space(3) },
  dock: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space(3), paddingTop: space(3) },
  dockBody: { paddingBottom: space(3) },
  action: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  actionIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3, gap: 3 },
  segment: {
    flex: 1,
    flexDirection: 'row',
    gap: space(1),
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    borderRadius: radius.sm,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
