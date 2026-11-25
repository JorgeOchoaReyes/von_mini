import NetInfo from '@react-native-community/netinfo';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { onDeviceOnly } from '../config';
import {
  deviceModelChosenByUser,
  getDeviceModel,
  loadDeviceModel,
  setDeviceModel as persistDeviceModel,
  setSessionDeviceModel,
  type DeviceModel,
} from './deviceModel';
import { engine } from './engineSelect';
import type { RouteContext } from './hybrid';
import type { DeviceStatus } from './types';

interface AIState extends RouteContext {
  /** True when the build forces on-device only (EXPO_PUBLIC_ON_DEVICE_ONLY). */
  locked: boolean;
  deviceStatus: DeviceStatus;
  /** The concrete on-device model in use, e.g. "nano-v4-full". Empty when unknown. */
  modelName: string;
  /** Which Nano build is requested from the on-device runtime. */
  deviceModel: DeviceModel;
  downloadProgress: number | null;
  /** True once the on-device model has been loaded ahead of the first request. */
  warmed: boolean;
  setPrivateMode(v: boolean): void;
  setDeviceModel(v: DeviceModel): void;
  refreshStatus(): Promise<void>;
  downloadModel(): Promise<void>;
  /** Loads the on-device model so the first real request is fast. Safe to call often. */
  warmUp(): void;
}

const Ctx = createContext<AIState | null>(null);

export function AIProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(true);
  const [privateMode, setPrivateModeState] = useState(onDeviceOnly);
  const setPrivateMode = useCallback((v: boolean) => setPrivateModeState(onDeviceOnly || v), []);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>('unavailable');
  const [modelName, setModelName] = useState('');
  const [deviceModel, setDeviceModelState] = useState<DeviceModel>(getDeviceModel);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [warmed, setWarmed] = useState(false);

  useEffect(
    () => NetInfo.addEventListener((s) => setOnline(s.isConnected !== false && s.isInternetReachable !== false)),
    [],
  );

  const loadStatus = useCallback(async () => {
    const [status, name] = await Promise.all([engine.status(), engine.modelName?.() ?? Promise.resolve('')]);
    setDeviceStatus(status);
    setModelName(name);
  }, []);

  const refreshStatus = useCallback(async () => {
    await loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const saved = await loadDeviceModel();
      if (alive) setDeviceModelState(saved);
      let [status, name] = await Promise.all([engine.status(), engine.modelName?.() ?? Promise.resolve('')]);
      // Nano 4 is a preview that AICore doesn't offer on every Nano phone. If it's unavailable,
      // try the stable Nano before concluding this phone has no on-device model at all.
      if (status === 'unavailable' && saved !== 'stable' && !deviceModelChosenByUser() && engine.runtime === 'android-aicore') {
        setSessionDeviceModel('stable');
        const [s2, n2] = await Promise.all([engine.status(), engine.modelName?.() ?? Promise.resolve('')]);
        if (s2 !== 'unavailable') {
          [status, name] = [s2, n2];
          if (alive) setDeviceModelState('stable');
        } else {
          setSessionDeviceModel(saved);
        }
      }
      if (!alive) return;
      setDeviceStatus(status);
      setModelName(name);
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** Switching model changes what the runtime reports, so re-read the status afterwards. */
  const setDeviceModel = useCallback(
    (m: DeviceModel) => {
      setDeviceModelState(m);
      setWarmed(false);
      void persistDeviceModel(m).then(loadStatus);
    },
    [loadStatus],
  );

  const downloadModel = useCallback(async () => {
    setDownloadProgress(0);
    try {
      const status = await engine.download((done, total) => setDownloadProgress(total > 0 ? done / total : null));
      setDeviceStatus(status);
    } catch {
      // AICore refused or the download failed: the status card keeps the manual button.
      setDeviceStatus(await engine.status());
    } finally {
      setDownloadProgress(null);
    }
  }, []);
  /**
   * The phone supports Nano but hasn't downloaded it: fetch it once on Wi-Fi (it's large), so
   * on-device AI and offline use just work. On mobile data the Download button stays.
   */
  const autoDownloadTried = useRef(false);
  useEffect(() => {
    if (deviceStatus !== 'downloadable' || autoDownloadTried.current || engine.runtime !== 'android-aicore') return;
    autoDownloadTried.current = true;
    void NetInfo.fetch().then((net) => {
      const expensive = (net.details as { isConnectionExpensive?: boolean } | null)?.isConnectionExpensive;
      if (net.type === 'wifi' && !expensive) void downloadModel();
    });
  }, [deviceStatus, downloadModel]);

  /**
   * Loads the model into memory. Called when the user first interacts with the builder, because
   * both platforms require a user gesture before touching the on-device model. It is fire-and-
   * forget: warm-up failing must never block or fail a real request.
   */
  const warmUp = useCallback(() => {
    // Only warm a model that is already on the device: warming a "downloadable" model starts the
    // multi-GB download behind the user's back, bypassing the explicit download button.
    if (warmed || deviceStatus !== 'available') return;
    setWarmed(true);
    void engine.warmUp?.().catch(() => false);
  }, [warmed, deviceStatus]);

  const value = useMemo(
    () => ({
      online,
      privateMode,
      locked: onDeviceOnly,
      deviceStatus,
      modelName,
      deviceModel,
      downloadProgress,
      warmed,
      setPrivateMode,
      setDeviceModel,
      refreshStatus,
      downloadModel,
      warmUp,
    }),
    [
      online,
      privateMode,
      deviceStatus,
      modelName,
      deviceModel,
      downloadProgress,
      warmed,
      setPrivateMode,
      setDeviceModel,
      refreshStatus,
      downloadModel,
      warmUp,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAI(): AIState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAI must be used inside <AIProvider>');
  return v;
}
