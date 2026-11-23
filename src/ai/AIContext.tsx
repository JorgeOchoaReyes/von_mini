import NetInfo from '@react-native-community/netinfo';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { onDeviceOnly } from '../config';
import { getDeviceModel, loadDeviceModel, setDeviceModel as persistDeviceModel, type DeviceModel } from './deviceModel';
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
      const [status, name] = await Promise.all([engine.status(), engine.modelName?.() ?? Promise.resolve('')]);
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
    } finally {
      setDownloadProgress(null);
    }
  }, []);

  /**
   * Loads the model into memory. Called when the user first interacts with the builder, because
   * both platforms require a user gesture before touching the on-device model. It is fire-and-
   * forget: warm-up failing must never block or fail a real request.
   */
  const warmUp = useCallback(() => {
    if (warmed) return;
    setWarmed(true);
    void engine.warmUp?.().catch(() => false);
  }, [warmed]);

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
