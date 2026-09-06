// App level error boundary, mounted once in app/_layout.tsx. A render crash
// shows a reload screen instead of a blank app; the error is also logged so
// it shows up in the Metro output. Do not mount additional boundaries.

import { reloadAppAsync } from "expo";
import { Component, type ErrorInfo, type PropsWithChildren } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

type ErrorBoundaryState = { error: Error | null };

export class ErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Render crash caught by ErrorBoundary:", error, info);
  }

  reset = () => {
    this.setState({ error: null });
    reloadAppAsync().catch(() => {});
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <ScrollView style={styles.scroll} contentContainerStyle={{ padding: 16 }}>
            <Text style={styles.message}>{String(this.state.error?.message ?? this.state.error)}</Text>
          </ScrollView>
          <Pressable style={styles.button} onPress={this.reset}>
            <Text style={styles.buttonText}>Reload app</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFF0F6", alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  title: { fontSize: 20, fontWeight: "800", color: "#3D1F2E" },
  scroll: { maxHeight: 220, alignSelf: "stretch", backgroundColor: "#FFFFFF", borderRadius: 12, borderWidth: 1, borderColor: "#F7D4E5" },
  message: { fontSize: 13, color: "#A8768F", lineHeight: 19 },
  button: { backgroundColor: "#EC4899", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  buttonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
});
