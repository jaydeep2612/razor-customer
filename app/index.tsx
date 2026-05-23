import { MaterialIcons } from "@expo/vector-icons";
import {
  router,
  useLocalSearchParams,
  useRootNavigationState,
} from "expo-router";
import * as Updates from "expo-updates";
import {
  default as React,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { THEME } from "../constants/theme";
import { useSession } from "../context/SessionContext";
import { initEcho } from "../services/echo";
import { SessionService } from "../services/session.service";

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
  textPrimary: "#1e293b",
  textSecondary: "#64748b",
  border: "#e2e8f0",
};
// ─────────────────────────────────────────────────────────────────────────────

export default function JoinScreen() {
  const rootNavigationState = useRootNavigationState();

  const {
    startSession,
    customerName,
    setCustomerName,
    sessionToken,
    setTableData,
    tableData,
    joinStatus,
    setJoinStatus,
    clearSession,
    activateRoomSession,
  } = useSession();

  const { r, t, token, type } = useLocalSearchParams<{
    r: string;
    t: string;
    token: string;
    type?: string;
  }>();

  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);

  const [isSessionVerified, setIsSessionVerified] = useState(false);

  const [isTableFull, setIsTableFull] = useState(false);
  const [isTableReserved, setIsTableReserved] = useState(false);
  const [existingHostName, setExistingHostName] = useState<string | null>(null);
  const [showJoinChoice, setShowJoinChoice] = useState(false);
  const [selectedMode, setSelectedMode] = useState<"new" | "join">("new");

  const [tableDisplayNumber, setTableDisplayNumber] = useState<string | null>(
    null,
  );

  // ─── 1. VERIFY STORED SESSION ON MOUNT ───
  useEffect(() => {
    let isMounted = true;

    const verifyLocalSession = async () => {
      if (isSessionVerified || !sessionToken || !tableData) {
        if (isMounted) setIsSessionVerified(true);
        return;
      }

      if (r && t && token) {
        if (tableData.tId !== t || tableData.token !== token) {
          await clearSession();
          if (isMounted) setIsSessionVerified(true);
          return;
        }
      }

      try {
        await SessionService.validateSessionToken(sessionToken);
        if (isMounted) setIsSessionVerified(true);
      } catch (e: any) {
        if (e.status === 401 || e.status === 403 || e.status === 404) {
          await clearSession();
        }
        if (isMounted) setIsSessionVerified(true);
      }
    };

    verifyLocalSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const initTable = useCallback(async () => {
    if (r && t && token) {
      if (tableData?.tId !== t || tableData?.token !== token) {
        setTableData({ rId: r, tId: t, token });
      }
      try {
        // 👇 CHECK: If this is a Room QR, validate and fast-track login
        if (type === "room") {
          const roomData = await SessionService.validateRoom(r, t, token);

          if (roomData.is_room && roomData.session_token) {
            await activateRoomSession(roomData, r, t, token);
            return;
          }
        }

        // 👇 FALLBACK: Standard Restaurant Table Logic
        const data = await SessionService.validateTable(r, t, token);

        if (data.table_number) {
          setTableDisplayNumber(data.table_number);
        }

        if (data.is_reserved) {
          setIsTableReserved(true);
          setValidating(false);
          return;
        }

        if (data.is_full) {
          setIsTableFull(true);
          setValidating(false);
          return;
        }

        if (data.has_active_host) {
          setExistingHostName(data.host_name);
          setShowJoinChoice(true);
          setSelectedMode("join");
        } else {
          setShowJoinChoice(false);
          setSelectedMode("new");
        }
      } catch (e: any) {
        const isAbort =
          e.name === "AbortError" || e.message?.toLowerCase().includes("abort");
        if (!isAbort) {
          console.error("Validation failed", e);

          if (type === "room" && e.status === 403) {
            Alert.alert(
              "Room Inactive",
              "This room is not currently checked in.",
            );
          }
        }
      } finally {
        setValidating(false);
      }
    } else {
      setValidating(false);
    }
  }, [r, t, token, type, tableData, setTableData, activateRoomSession]);

  useEffect(() => {
    initTable();
  }, [initTable]);

  const echoRef = useRef<any>(null);
  const isMountedRef = useRef(true);

  // HYBRID WEBSOCKET + POLLING FALLBACK SYSTEM
  useEffect(() => {
    isMountedRef.current = true;
    let channel: any = null;
    let pollInterval: ReturnType<typeof setInterval>;

    const setupRealtime = async () => {
      if (joinStatus === "pending" && tableData && sessionToken) {
        try {
          await SessionService.checkSessionStatus(
            tableData.rId,
            tableData.tId,
            tableData.token,
            sessionToken,
          );
          if (isMountedRef.current) setJoinStatus("approved");
        } catch (e: any) {
          const sessionId = e.data?.session?.id;
          if (
            e.status === 403 &&
            e.data?.join_status === "pending" &&
            sessionId
          ) {
            if (!echoRef.current) echoRef.current = initEcho(sessionToken);
            echoRef.current.leaveAllChannels();

            channel = echoRef.current.private(`session.${sessionId}`);
            channel.listen(".JoinRequestResponded", (event: any) => {
              if (!isMountedRef.current) return;
              if (event.status === "approved") {
                setJoinStatus("approved");
              } else if (event.status === "rejected") {
                setJoinStatus("rejected");
              }
            });

            pollInterval = setInterval(async () => {
              try {
                await SessionService.checkSessionStatus(
                  tableData.rId,
                  tableData.tId,
                  tableData.token,
                  sessionToken,
                );
                if (isMountedRef.current) setJoinStatus("approved");
              } catch (err: any) {
                if (
                  err?.data?.join_status === "rejected" &&
                  isMountedRef.current
                ) {
                  setJoinStatus("rejected");
                }
              }
            }, 3000);
          } else if (e.status === 404 || e.data?.join_status === "rejected") {
            if (isMountedRef.current) setJoinStatus("rejected");
          }
        }
      }
    };

    setupRealtime();

    return () => {
      isMountedRef.current = false;
      if (pollInterval) clearInterval(pollInterval);
      if (echoRef.current) {
        echoRef.current.disconnect();
        echoRef.current = null;
      }
    };
  }, [joinStatus, sessionToken, tableData]);

  // ─── 2. SAFE AUTO-REDIRECT TO MENU ───
  useEffect(() => {
    if (!isSessionVerified) return;

    if (
      sessionToken &&
      (joinStatus === "active" || joinStatus === "approved")
    ) {
      router.replace("/(tabs)/menu");
    }
  }, [sessionToken, joinStatus, isSessionVerified]);

  const handleJoin = useCallback(async () => {
    if (!customerName.trim()) return;
    setLoading(true);
    try {
      await startSession(customerName, selectedMode);
    } catch (e: any) {
      if (
        e?.data?.message === "TABLE_RESERVED" ||
        e?.message?.includes("TABLE_RESERVED")
      ) {
        setIsTableReserved(true);
      } else {
        console.error(e);
        Alert.alert("Error", "Could not join table. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [customerName, selectedMode, startSession]);

  const renderWithBackground = (content: React.ReactNode) => (
    <View style={styles.mainWrapper}>
      <Image
        source={require("../assets/images/bg.png")}
        style={styles.bgImage}
      />
      <View style={styles.bgOverlay} />
      {content}
    </View>
  );

  if (!rootNavigationState?.key || validating || !isSessionVerified) {
    return renderWithBackground(
      <SafeAreaView style={styles.centerContainer}>
        <ActivityIndicator size="large" color={ANN.orange} />
        <Text
          style={{ marginTop: 16, color: ANN.darkBlue, fontWeight: "bold" }}
        >
          Connecting...
        </Text>
      </SafeAreaView>,
    );
  }

  if (!r || !t || !token) {
    return renderWithBackground(
      <SafeAreaView style={styles.centerContainer}>
        <View style={{ alignItems: "center", marginBottom: 40, marginTop: 40 }}>
          <View style={styles.logoWrapperBig}>
            <Image
              source={require("../assets/images/ann-sathi.png")}
              style={styles.logoImageBig}
            />
          </View>
        </View>
        <Text style={[styles.welcomeTitle, { textAlign: "center" }]}>
          Welcome to AnnSathi!
        </Text>
        <Text
          style={[styles.subtitle, { marginBottom: 32, textAlign: "center" }]}
        >
          Please scan the QR code on your table to view the menu and place your
          order.
        </Text>
      </SafeAreaView>,
    );
  }

  if (isTableReserved) {
    return renderWithBackground(
      <SafeAreaView style={styles.centerContainer}>
        <MaterialIcons name="calendar-today" size={80} color={ANN.red} />
        <Text style={styles.welcomeTitle}>Table Reserved</Text>
        <Text style={styles.subtitle}>
          This table is currently reserved for upcoming guests. Please scan the
          QR code on a different available table.
        </Text>
        <TouchableOpacity
          onPress={async () => await Updates.reloadAsync()}
          style={[
            styles.joinButton,
            { width: "80%", marginTop: 32, backgroundColor: ANN.darkBlue },
          ]}
        >
          <Text style={styles.joinButtonText}>Check Again</Text>
        </TouchableOpacity>
      </SafeAreaView>,
    );
  }

  if (joinStatus === "rejected") {
    return renderWithBackground(
      <SafeAreaView style={styles.centerContainer}>
        <MaterialIcons name="cancel" size={80} color={THEME.danger} />
        <Text style={styles.welcomeTitle}>Access Denied</Text>
        <Text style={styles.subtitle}>
          The Host has declined your request to join this table.
        </Text>
        <TouchableOpacity
          onPress={clearSession}
          style={[
            styles.joinButton,
            { width: "80%", marginTop: 24, backgroundColor: ANN.darkBlue },
          ]}
        >
          <Text style={styles.joinButtonText}>Start Over</Text>
        </TouchableOpacity>
      </SafeAreaView>,
    );
  }

  if (isTableFull) {
    return renderWithBackground(
      <SafeAreaView style={styles.centerContainer}>
        <MaterialIcons name="event-seat" size={80} color={ANN.orange} />
        <Text style={styles.welcomeTitle}>Table is Full</Text>
        <Text style={styles.subtitle}>
          Sorry, this table has reached its maximum seating capacity. Please
          speak to the staff.
        </Text>
        <TouchableOpacity
          onPress={async () => await Updates.reloadAsync()}
          style={[
            styles.joinButton,
            { width: "80%", marginTop: 24, backgroundColor: ANN.darkBlue },
          ]}
        >
          <Text style={styles.joinButtonText}>Refresh Status</Text>
        </TouchableOpacity>
      </SafeAreaView>,
    );
  }

  if (joinStatus === "pending") {
    return renderWithBackground(
      <SafeAreaView style={styles.centerContainer}>
        <ActivityIndicator size="large" color={ANN.orange} />
        <Text style={styles.welcomeTitle}>Waiting...</Text>
        <Text style={styles.subtitle}>
          Waiting for{" "}
          <Text style={{ fontWeight: "bold", color: ANN.darkBlue }}>
            {existingHostName || "Host"}
          </Text>{" "}
          to approve you.
        </Text>
        <TouchableOpacity onPress={clearSession} style={{ marginTop: 32 }}>
          <Text
            style={{ color: THEME.danger, fontWeight: "bold", fontSize: 16 }}
          >
            Cancel Request
          </Text>
        </TouchableOpacity>
      </SafeAreaView>,
    );
  }

  const isButtonDisabled = !customerName.trim() || loading;

  return renderWithBackground(
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.iconCircle}>
          <MaterialIcons name="restaurant" size={24} color={ANN.darkBlue} />
        </View>
        <Text style={styles.headerTitle}>Ann Sathi</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        <Text style={styles.welcomeTitle}>Welcome!</Text>

        <View style={styles.tableBadge}>
          <MaterialIcons name="local-activity" size={18} color={ANN.red} />
          <Text style={styles.tableBadgeText}>
            Table {tableDisplayNumber || tableData?.tId || "?"}
          </Text>
        </View>

        {showJoinChoice ? (
          <View style={{ width: "100%", marginBottom: 24 }}>
            <Text
              style={[styles.subtitle, { textAlign: "left", marginBottom: 12 }]}
            >
              Hosted by{" "}
              <Text style={{ fontWeight: "900", color: ANN.darkBlue }}>
                {existingHostName}
              </Text>
              . How do you want to order?
            </Text>
            <TouchableOpacity
              style={[
                styles.choiceCard,
                selectedMode === "join" && styles.choiceCardActive,
              ]}
              onPress={() => setSelectedMode("join")}
            >
              <MaterialIcons
                name="group"
                size={28}
                color={selectedMode === "join" ? "#FFF" : ANN.darkBlue}
              />
              <View style={{ marginLeft: 16 }}>
                <Text
                  style={[
                    styles.choiceTitle,
                    selectedMode === "join" && { color: "#FFF" },
                  ]}
                >
                  Join the Table
                </Text>
                <Text
                  style={[
                    styles.choiceDesc,
                    selectedMode === "join" && {
                      color: "rgba(255,255,255,0.8)",
                    },
                  ]}
                >
                  Orders added to {existingHostName}'s bill
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.choiceCard,
                selectedMode === "new" && styles.choiceCardActive,
              ]}
              onPress={() => setSelectedMode("new")}
            >
              <MaterialIcons
                name="receipt-long"
                size={28}
                color={selectedMode === "new" ? "#FFF" : ANN.darkBlue}
              />
              <View style={{ marginLeft: 16 }}>
                <Text
                  style={[
                    styles.choiceTitle,
                    selectedMode === "new" && { color: "#FFF" },
                  ]}
                >
                  Separate Bill
                </Text>
                <Text
                  style={[
                    styles.choiceDesc,
                    selectedMode === "new" && {
                      color: "rgba(255,255,255,0.8)",
                    },
                  ]}
                >
                  Start your own separate tab
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={[styles.subtitle, { marginBottom: 32 }]}>
            Enter your name to start ordering.
          </Text>
        )}

        <View style={styles.formArea}>
          <Text style={styles.label}>Your Name</Text>
          <View style={styles.inputContainer}>
            <MaterialIcons
              name="person"
              size={24}
              color={ANN.darkBlue}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="e.g. John Doe"
              placeholderTextColor="#94A3B8"
              value={customerName}
              onChangeText={setCustomerName}
            />
          </View>
          <TouchableOpacity
            style={[
              styles.joinButton,
              isButtonDisabled && { opacity: 0.6 },
              Platform.OS === "web" && ({ cursor: "pointer" } as any),
            ]}
            onPress={handleJoin}
            disabled={isButtonDisabled}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.joinButtonText}>
                {showJoinChoice && selectedMode === "join"
                  ? "Request to Join"
                  : "Start Session"}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>,
  );
}

const styles = StyleSheet.create({
  mainWrapper: { flex: 1, backgroundColor: "#ffffff" },
  bgImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
    resizeMode: "cover",
    opacity: 0.15,
  },
  bgOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255, 255, 255, 0.85)",
  },
  container: { flex: 1, maxWidth: 480, width: "100%", alignSelf: "center" },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  logoWrapperBig: {
    width: 120,
    height: 120,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  logoImageBig: { width: "100%", height: "100%", resizeMode: "contain" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(42, 71, 149, 0.1)",
    backgroundColor: "transparent",
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: ANN.blueLight,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: { fontSize: 18, fontWeight: "900", color: ANN.darkBlue },
  content: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  welcomeTitle: {
    fontSize: 36,
    fontWeight: "900",
    color: ANN.darkBlue,
    marginBottom: 8,
    marginTop: 16,
  },
  subtitle: {
    fontSize: 16,
    color: ANN.textSecondary,
    textAlign: "center",
    lineHeight: 24,
    fontWeight: "500",
  },
  tableBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: ANN.orangeLight,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: ANN.orange,
  },
  tableBadgeText: {
    color: ANN.red,
    fontWeight: "900",
    fontSize: 16,
    marginLeft: 6,
  },
  choiceCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "rgba(42, 71, 149, 0.2)",
    backgroundColor: "rgba(255, 255, 255, 0.7)",
    marginBottom: 12,
  },
  choiceCardActive: {
    backgroundColor: ANN.darkBlue,
    borderColor: ANN.darkBlue,
  },
  choiceTitle: {
    fontWeight: "800",
    fontSize: 16,
    color: ANN.darkBlue,
    marginBottom: 4,
  },
  choiceDesc: { fontSize: 13, color: ANN.textSecondary, fontWeight: "500" },
  formArea: { width: "100%" },
  label: {
    fontSize: 14,
    fontWeight: "700",
    color: ANN.darkBlue,
    marginBottom: 8,
    marginLeft: 4,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.8)",
    borderWidth: 1.5,
    borderColor: "rgba(42, 71, 149, 0.2)",
    borderRadius: 14,
    height: 56,
    marginBottom: 24,
  },
  inputIcon: { paddingHorizontal: 16 },
  input: {
    flex: 1,
    fontSize: 16,
    color: ANN.textPrimary,
    fontWeight: "600",
    ...((Platform.OS === "web" ? { outlineStyle: "none" } : {}) as any),
  },
  joinButton: {
    backgroundColor: ANN.orange,
    alignItems: "center",
    justifyContent: "center",
    height: 56,
    borderRadius: 14,
    shadowColor: ANN.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  joinButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
  },
});
