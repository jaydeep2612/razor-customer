import Constants from "expo-constants";
import Echo from "laravel-echo";
import Pusher from "pusher-js";

const BASE_URL =
  Constants.expoConfig?.extra?.BASE_URL || process.env.EXPO_PUBLIC_BASE_URL;

(global as any).Pusher = Pusher;

export function initEcho(token: string) {
  return new Echo({
    broadcaster: "pusher",
    key: process.env.EXPO_PUBLIC_PUSHER_APP_KEY,
    cluster: process.env.EXPO_PUBLIC_PUSHER_APP_CLUSTER,
    // 👇 FIX: Remove wsHost, wsPort, and wssPort entirely. Let Pusher handle it.
    forceTLS: true,
    authEndpoint: `${BASE_URL}/api/pusher/auth`,
    activityTimeout: 30000,
    pongTimeout: 15000,
    auth: {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    },
  });
}
