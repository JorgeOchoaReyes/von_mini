/**
 * Which Gemini Nano build to ask the on-device runtime for.
 *
 * The env var sets the default; the settings screen can override it at runtime and the choice is
 * remembered on the device. Nano 4 is published by Firebase AI Logic as the *preview* model
 * options, so it is worth being able to fall back to the stable model if a device rejects it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { deviceModel as envDefault } from '../config';

export type DeviceModel = 'nano4' | 'nano4_fast' | 'stable';

export const DEVICE_MODELS: { value: DeviceModel; label: string; detail: string }[] = [
  { value: 'nano4', label: 'Nano 4', detail: 'Newest on-device model. Best quality.' },
  { value: 'nano4_fast', label: 'Nano 4 Fast', detail: 'Lower latency, slightly simpler answers.' },
  { value: 'stable', label: 'Stable', detail: 'The older default Nano. Use if Nano 4 is rejected.' },
];

const KEY = 'vm:deviceModel';

let override: DeviceModel | null = null;

export const isDeviceModel = (v: unknown): v is DeviceModel => v === 'nano4' || v === 'nano4_fast' || v === 'stable';

/** The model to request right now (runtime override, else the build-time default). */
export const getDeviceModel = (): DeviceModel => override ?? envDefault;

let chosenByUser = false;

/** Reads a previously saved choice. Called once at startup. */
export async function loadDeviceModel(): Promise<DeviceModel> {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (isDeviceModel(saved)) {
      override = saved;
      chosenByUser = true;
    }
  } catch {
    // A missing or unreadable preference just means "use the default".
  }
  return getDeviceModel();
}

/** True when the user picked a model in Settings (automatic fallbacks then leave it alone). */
export const deviceModelChosenByUser = () => chosenByUser;

/** Switches model for this session only, without saving: used for the automatic fallback. */
export function setSessionDeviceModel(model: DeviceModel) {
  override = model;
}

export async function setDeviceModel(model: DeviceModel): Promise<void> {
  override = model;
  chosenByUser = true;
  try {
    await AsyncStorage.setItem(KEY, model);
  } catch {
    // Not fatal: the choice still applies for this session.
  }
}
