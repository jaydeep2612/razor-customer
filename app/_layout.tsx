import { Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { ErrorBoundary } from "../components/ErrorBoundary"; // Assuming you created this from Step 8 previously
import { SessionProvider, useSession } from "../context/SessionContext";

// ─── Ann Sathi Brand Colors ───────────────────────────────────────────────────
const ANN = {
  orange: "#fe9a54",
  red: "#f16b3f",
  blue: "#456aba",
  darkBlue: "#2a4795",
  orangeLight: "#fff4ec",
  redLight: "#fff0eb",
  blueLight: "#eef2fb",
  darkBlueLight: "#e8ecf7",
};
// ─────────────────────────────────────────────────────────────────────────────

function AppHydrationGuard() {
  const { isReady: isCustomerReady } = useSession();

  if (!isCustomerReady) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#ffffff", // Updated to match the light theme
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator size="large" color={ANN.orange} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <SessionProvider>
        <AppHydrationGuard />
      </SessionProvider>
    </ErrorBoundary>
  );
}
