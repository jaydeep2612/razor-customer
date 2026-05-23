import Constants from "expo-constants";
import * as Device from "expo-device";

type LogLevel = "INFO" | "WARN" | "ERROR";

export function logEvent(level: LogLevel, type: string, data?: any) {
  const log = {
    level,
    type,
    data: data ?? null,
    timestamp: new Date().toISOString(),
    platform: "mobile",
    deviceModel: Device.modelName || "unknown",
    os: Device.osName || "unknown",
    appVersion: Constants.expoConfig?.version || "1.0.0",
    environment: __DEV__ ? "development" : "production",
  };

  if (__DEV__) {
    console.log(`[${level}] ${type}`, log.data || "");
  }
}
