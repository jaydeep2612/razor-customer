import * as Updates from "expo-updates";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { THEME } from "../constants/theme";
import { logEvent } from "../utils/logger";

export class ErrorBoundary extends React.Component<any, { hasError: boolean }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, info: any) {
    logEvent("ERROR", "APP_CRASH", {
      error: error.message,
      stack: info.componentStack,
    });
  }

  handleRestart = async () => {
    await Updates.reloadAsync();
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong.</Text>
          <Text style={styles.subtitle}>
            A critical error occurred. Please restart.
          </Text>

          <TouchableOpacity onPress={this.handleRestart} style={styles.button}>
            <Text style={styles.buttonText}>Restart App</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: THEME.background,
  },
  title: { fontSize: 20, fontWeight: "bold", color: THEME.textPrimary },
  subtitle: {
    fontSize: 14,
    color: THEME.textSecondary,
    marginTop: 8,
    marginBottom: 24,
  },
  button: {
    backgroundColor: THEME.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
});
