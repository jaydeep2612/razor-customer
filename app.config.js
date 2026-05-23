import "dotenv/config";

export default {
  expo: {
    name: "REST_MENU",
    slug: "REST_MENU",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "restmenu",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.techstrota.restmenu",
    },
    android: {
      package: "com.techstrota.restmenu",
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      intentFilters: [
        {
          action: "VIEW",
          data: [{ scheme: "restmenu" }],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
    },
    web: {
      output: "single",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
          dark: { backgroundColor: "#000000" },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      BASE_URL: process.env.EXPO_PUBLIC_BASE_URL,
      API_URL: process.env.EXPO_PUBLIC_API_URL,
    },
    eas: {
      projectId: "277ed9b9-4bd0-43f9-bc6b-dc3b127111e5",
    },
  },
};
