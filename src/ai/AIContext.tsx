import NetInfo from '@react-native-community/netinfo';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { onDeviceOnly } from '../config';
import { engine } from './engine';
import type { RouteContext } from './hybrid';
import type { DeviceStatus } from './types';

interface AIState extends RouteContext {
  /** True when the build forces on-device only (EXPO_PUBLIC_ON_DEVICE_ONLY). */
  locked: boolean;
  deviceStatus: DeviceStatus;
  downloadProgress: number | null;
  setPrivateMode(v: boolean): void;
  refreshStatus(): Promise<void>;
  downloadModel(): Promise<void>;
}

const Ctx = createContext<AIState | null>(null);

export function AIProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(true);
  const [privateMode, setPrivateModeState] = useState(onDeviceOnly);
  const setPrivateMode = useCallback((v: boolean) => setPrivateModeState(onDeviceOnly || v), []);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>('unavailable');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  useEffect(
    () => NetInfo.addEventListener((s) => setOnline(s.isConnected !== false && s.isInternetReachable !== false)),
    [],
  );

  const refreshStatus = useCallback(async () => setDeviceStatus(await engine.status()), []);
  useEffect(() => {
    let alive = true;
    engine.status().then((s) => alive && setDeviceStatus(s));
    return () => {
      alive = false;
    };
  }, []);

  const downloadModel = useCallback(async () => {
    setDownloadProgress(0);
    try {
      const status = await engine.download((done, total) => setDownloadProgress(total > 0 ? done / total : null));
      setDeviceStatus(status);
    } finally {
      setDownloadProgress(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      online,
      privateMode,
      locked: onDeviceOnly,
      deviceStatus,
      downloadProgress,
      setPrivateMode,
      refreshStatus,
      downloadModel,
    }),
    [online, privateMode, deviceStatus, downloadProgress, setPrivateMode, refreshStatus, downloadModel],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAI(): AIState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAI must be used inside <AIProvider>');
  return v;
}
