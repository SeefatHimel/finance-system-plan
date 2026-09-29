import * as SecureStore from "expo-secure-store";

import {
  getSecureRawMessageQueue,
  isNativeSmsCaptureAvailable,
  setSecureRawMessageQueue
} from "../modules/finance-sms-capture/src";

const fallbackQueueKey = "finance.sms.rawQueue.secure.v1";

export async function loadSecureSmsQueue(): Promise<string | null> {
  if (isNativeSmsCaptureAvailable()) {
    return getSecureRawMessageQueue();
  }
  if (!(await SecureStore.isAvailableAsync())) {
    return null;
  }
  return SecureStore.getItemAsync(fallbackQueueKey);
}

export async function saveSecureSmsQueue(value: string): Promise<void> {
  if (isNativeSmsCaptureAvailable()) {
    await setSecureRawMessageQueue(value);
    return;
  }
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error("Secure local storage is unavailable on this device.");
  }
  await SecureStore.setItemAsync(fallbackQueueKey, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  });
}
