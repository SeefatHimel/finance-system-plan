import { requireNativeModule } from "expo-modules-core";

export type NativeSmsSenderRule = {
  id: string;
  matchType: string;
  sender: string;
};

export type CapturedSmsMessage = {
  body: string;
  id: string;
  receivedAt: string;
  sender: string;
};

type FinanceSmsCaptureModule = {
  clearCapturedMessagesAsync(ids: string[]): Promise<void>;
  configureSenderRulesAsync(rules: NativeSmsSenderRule[]): Promise<{ configuredCount: number }>;
  getCapturedMessagesAsync(limit?: number): Promise<CapturedSmsMessage[]>;
  getPermissionStatusAsync(): Promise<{
    canReadSms: boolean;
    canReceiveSms: boolean;
  }>;
  scanHistoricalMessagesAsync(limit?: number): Promise<{
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

export async function scanHistoricalSmsMessages(limit = 500) {
  const module = getNativeModule();
  if (!module) {
    throw new Error("Native SMS capture module is unavailable. Build a custom Android dev client or APK first.");
  }

  return module.scanHistoricalMessagesAsync(limit);
}

export async function clearCapturedSmsMessages(ids: string[]) {
  const module = getNativeModule();
  if (!module || ids.length === 0) {
    return;
  }

  await module.clearCapturedMessagesAsync(ids);
}
