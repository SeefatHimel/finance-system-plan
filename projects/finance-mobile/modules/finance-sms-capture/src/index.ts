import { requireNativeModule } from "expo-modules-core";

export type NativeSmsSenderRule = {
  id: string;
  isActive: boolean;
  matchType: string;
  pattern: string;
  sender: string;
};

export type NativeSmsBackgroundSyncStatus = {
  importedCount: number;
  message: string;
  rejectedCount: number;
  state: "idle" | "running" | "success" | "error";
  updatedAt: string;
};

export type CapturedSmsMessage = {
  body: string;
  id: string;
  receivedAt: string;
  sender: string;
};

export type SmsInboxSender = {
  latestAt: string;
  messageCount: number;
  sender: string;
};

export type NativeSmsScanOptions = {
  fromTimestamp?: number;
  includeProcessed?: boolean;
  limit?: number;
  toTimestamp?: number;
};

type FinanceSmsCaptureModule = {
  clearBackgroundSyncSessionAsync(): Promise<void>;
  clearCapturedMessagesAsync(ids: string[]): Promise<void>;
  configureBackgroundSyncAsync(
    apiBaseUrl: string,
    accessToken: string,
    refreshToken: string,
    username: string
  ): Promise<void>;
  configureSenderRulesAsync(rules: NativeSmsSenderRule[]): Promise<{ configuredCount: number }>;
  getCapturedMessagesAsync(limit?: number): Promise<CapturedSmsMessage[]>;
  getBackgroundSyncStatusAsync(): Promise<NativeSmsBackgroundSyncStatus>;
  getBackgroundSyncSessionAsync(): Promise<{ access: string; refresh: string; username: string } | null>;
  getPermissionStatusAsync(): Promise<{
    canReadSms: boolean;
    canReceiveSms: boolean;
  }>;
  listInboxSendersAsync(limit?: number): Promise<SmsInboxSender[]>;
  getSecureRawQueueAsync(): Promise<string>;
  setSecureRawQueueAsync(value: string): Promise<void>;
  enqueueBackgroundSyncAsync(): Promise<void>;
  resetTrackingStateAsync(): Promise<void>;
  scanHistoricalMessagesAsync(options?: NativeSmsScanOptions): Promise<{
    capturedCount: number;
    duplicateCount: number;
    scannedCount: number;
  }>;
};

let nativeModule: FinanceSmsCaptureModule | null | undefined;

function getNativeModule() {
  if (nativeModule !== undefined) {
    return nativeModule;
  }

  try {
    nativeModule = requireNativeModule<FinanceSmsCaptureModule>("FinanceSmsCapture");
  } catch {
    nativeModule = null;
  }

  return nativeModule;
}

export function isNativeSmsCaptureAvailable() {
  return getNativeModule() !== null;
}

export async function getNativeSmsPermissionStatus() {
  const module = getNativeModule();
  if (!module) {
    return {
      canReadSms: false,
      canReceiveSms: false
    };
  }

  return module.getPermissionStatusAsync();
}

export async function listNativeSmsInboxSenders(limit = 5000) {
  const module = getNativeModule();
  if (!module) {
    throw new Error("Native SMS capture module is unavailable. Build a custom Android dev client or APK first.");
  }

  return module.listInboxSendersAsync(limit);
}

export async function configureNativeSmsSenderRules(rules: NativeSmsSenderRule[]) {
  const module = getNativeModule();
  if (!module) {
    throw new Error("Native SMS capture module is unavailable. Build a custom Android dev client or APK first.");
  }

  return module.configureSenderRulesAsync(rules);
}

export async function getCapturedSmsMessages(limit = 50) {
  const module = getNativeModule();
  if (!module) {
    throw new Error("Native SMS capture module is unavailable. Build a custom Android dev client or APK first.");
  }

  return module.getCapturedMessagesAsync(limit);
}

export async function scanHistoricalSmsMessages(options: NativeSmsScanOptions = {}) {
  const module = getNativeModule();
  if (!module) {
    throw new Error("Native SMS capture module is unavailable. Build a custom Android dev client or APK first.");
  }

  return module.scanHistoricalMessagesAsync({ limit: 500, ...options });
}

export async function clearCapturedSmsMessages(ids: string[]) {
  const module = getNativeModule();
  if (!module || ids.length === 0) {
    return;
  }

  await module.clearCapturedMessagesAsync(ids);
}

export async function resetNativeSmsTrackingState() {
  const module = getNativeModule();
  if (!module) {
    throw new Error("Native SMS capture module is unavailable. Build a custom Android dev client or APK first.");
  }

  await module.resetTrackingStateAsync();
}

export async function getSecureRawMessageQueue() {
  const module = getNativeModule();
  if (!module) {
    return null;
  }
  return module.getSecureRawQueueAsync();
}

export async function setSecureRawMessageQueue(value: string) {
  const module = getNativeModule();
  if (!module) {
    throw new Error("Secure SMS storage requires the installed Android app.");
  }
  await module.setSecureRawQueueAsync(value);
}

export async function configureNativeSmsBackgroundSync(
  apiBaseUrl: string,
  accessToken: string,
  refreshToken: string,
  username: string
) {
  const module = getNativeModule();
  if (!module) {
    return;
  }
  await module.configureBackgroundSyncAsync(apiBaseUrl, accessToken, refreshToken, username);
}

export async function clearNativeSmsBackgroundSyncSession() {
  const module = getNativeModule();
  if (!module) {
    return;
  }
  await module.clearBackgroundSyncSessionAsync();
}

export async function enqueueNativeSmsBackgroundSync() {
  const module = getNativeModule();
  if (!module) {
    return;
  }
  await module.enqueueBackgroundSyncAsync();
}

export async function getNativeSmsBackgroundSyncStatus() {
  const module = getNativeModule();
  if (!module) {
    return null;
  }
  return module.getBackgroundSyncStatusAsync();
}

export async function getNativeSmsBackgroundSyncSession() {
  const module = getNativeModule();
  if (!module) {
    return null;
  }
  return module.getBackgroundSyncSessionAsync();
}
