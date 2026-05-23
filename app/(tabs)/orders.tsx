import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { THEME } from "../../constants/theme";
import { useSession } from "../../context/SessionContext";
import { initEcho } from "../../services/echo";
import { OrderService } from "../../services/order.service";
import { SessionService } from "../../services/session.service";
import { billTabNotifier } from "./_layout";

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

export default function OrdersTab() {
  const { sessionToken, tableData, menuData, orders, setOrders, clearSession } =
    useSession();

  // 👇 ADDED: Extract type
  const isRoom = tableData?.type === "room";

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "live" | "offline"
  >("connecting");

  const [cancellingId, setCancellingId] = useState<string | number | null>(
    null,
  );
  const [processingPaymentId, setProcessingPaymentId] = useState<
    string | number | null
  >(null);

  const echoRef = useRef<any>(null);
  const processedEventsRef = useRef<Set<string>>(new Set());

  const currency = menuData?.restaurant?.currency_symbol || "₹";
  const sessionId =
    menuData?.session?.id || menuData?.session?.session_id || tableData?.tId;

  const mergeOrders = (incomingOrders: any[]) => {
    setOrders((prev) => {
      const map = new Map(prev.map((o) => [o.id, o]));
      incomingOrders.forEach((incoming) => {
        const existing = map.get(incoming.id);
        if (existing) {
          map.set(incoming.id, {
            ...existing,
            ...incoming,
            items:
              incoming.items && incoming.items.length > 0
                ? incoming.items
                : existing.items,
          });
        } else {
          map.set(incoming.id, incoming);
        }
      });
      return Array.from(map.values())
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )
        .slice(0, 50);
    });
  };

  const fetchOrders = useCallback(
    async (signal?: AbortSignal) => {
      if (!sessionToken) return;
      try {
        const data = await OrderService.getOrders(
          sessionToken,
          tableData?.type || "table",
          signal,
        );
        const incomingOrders = Array.isArray(data) ? data : data.orders || [];
        mergeOrders(incomingOrders);
      } catch (e: any) {
        if (e.name !== "AbortError") console.error("Failed to fetch orders", e);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [sessionToken],
  );

  useEffect(() => {
    const abortController = new AbortController();
    fetchOrders(abortController.signal).catch((err) => {
      if (err.name === "AbortError") return;
    });
    return () => abortController.abort();
  }, [fetchOrders]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchOrders();
    if (connectionStatus === "offline" && echoRef.current) {
      setConnectionStatus("connecting");
      echoRef.current.connector.pusher.connection.connect();
    }
  };

  useEffect(() => {
    if (!sessionToken || !sessionId) {
      setConnectionStatus("offline");
      return;
    }

    let isMounted = true;
    if (!echoRef.current) echoRef.current = initEcho(sessionToken);
    const echoInstance = echoRef.current;

    echoInstance.connector.pusher.connection.bind(
      "state_change",
      (states: any) => {
        if (!isMounted) return;
        if (states.current === "connected") setConnectionStatus("live");
        else if (states.current === "connecting")
          setConnectionStatus("connecting");
        else if (
          ["disconnected", "unavailable", "failed"].includes(states.current)
        )
          setConnectionStatus("offline");
      },
    );

    echoInstance.connector.pusher.connection.bind("error", () => {
      if (!isMounted) return;
      setConnectionStatus("offline");
    });

    echoInstance
      .private(`session.${sessionId}`)
      .listen(".OrderStatusUpdated", (event: any) => {
        if (!isMounted) return;
        const eventId = event.event_id;
        if (eventId) {
          if (processedEventsRef.current.has(eventId)) return;
          processedEventsRef.current.add(eventId);
        }
        if (event.order) {
          mergeOrders([event.order]);
          fetchOrders();
        }
      })
      .listen(".SessionEnded", async () => {
        if (!isMounted) return;
        Alert.alert(
          "Thank You!",
          `Your ${isRoom ? "room" : "table"} session has been closed. We hope to see you again soon!`,
        );
        await clearSession();
        router.replace("/");
      });

    return () => {
      isMounted = false;
      if (echoRef.current) {
        if (echoRef.current.connector?.pusher?.connection) {
          echoRef.current.connector.pusher.connection.unbind_all();
        }
        echoRef.current.leave(`session.${sessionId}`);
        echoRef.current.disconnect();
        echoRef.current = null;
      }
    };
  }, [sessionToken, sessionId, fetchOrders, isRoom]);

  const displayOrders = Array.isArray(orders) ? orders : [];

  const handleCallWaiter = async () => {
    if (!sessionToken) return;
    try {
      await SessionService.callWaiter(sessionToken);
      if (Platform.OS === "web") {
        window.alert("A staff member has been alerted and is on the way.");
      } else {
        Alert.alert(
          "Waiter Notified",
          "A staff member has been alerted and is on the way.",
        );
      }
    } catch (e) {
      if (Platform.OS === "web")
        window.alert("Could not reach staff. Please try again.");
      else Alert.alert("Error", "Could not reach staff. Please try again.");
    }
  };

  const executeCancel = async (orderId: string | number) => {
    if (!sessionToken) return;
    try {
      setCancellingId(orderId);
      await OrderService.cancelOrder(
        sessionToken,
        orderId,
        tableData?.type || "table",
      );
      if (Platform.OS === "web") window.alert("Order has been cancelled.");
      else Alert.alert("Success", "Order has been cancelled.");
      fetchOrders();
    } catch (error: any) {
      const msg =
        error.message ||
        "The kitchen has already started preparing this order.";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Cannot Cancel", msg);
    } finally {
      setCancellingId(null);
    }
  };

  const handleCancelOrder = (orderId: string | number) => {
    if (Platform.OS === "web") {
      const confirmed = window.confirm(
        "Are you sure you want to cancel this order? This cannot be undone.",
      );
      if (confirmed) executeCancel(orderId);
    } else {
      Alert.alert(
        "Cancel Order?",
        "Are you sure you want to cancel this order? This cannot be undone.",
        [
          { text: "No, keep it", style: "cancel" },
          {
            text: "Yes, Cancel",
            style: "destructive",
            onPress: () => executeCancel(orderId),
          },
        ],
      );
    }
  };

  const handlePaymentSubmitted = async (orderId: number, method: string) => {
    if (!sessionToken) return;
    try {
      setProcessingPaymentId(orderId);
      await OrderService.notifyPaymentDone(sessionToken, orderId, method);
      if (Platform.OS === "web")
        window.alert("Payment Submitted! The manager is verifying your order.");
      else
        Alert.alert(
          "Payment Submitted",
          "The manager is verifying your payment and will start cooking soon.",
        );
      fetchOrders();
    } catch (e: any) {
      Alert.alert(
        "Error",
        e.message || "Could not submit payment notification.",
      );
    } finally {
      setProcessingPaymentId(null);
    }
  };

  const getStatusUI = (status: string) => {
    const s = status?.toLowerCase() || "";
    if (s === "payment_pending")
      return {
        color: THEME.danger,
        bg: THEME.danger,
        text: "Payment Required",
        icon: "wallet-outline",
      };
    if (s === "accepted")
      return {
        color: THEME.primary,
        bg: THEME.primary,
        text: "Order Accepted",
        icon: "checkmark-circle-outline",
      };
    if (s === "placed" || s === "pending")
      return {
        color: THEME.textSecondary,
        bg: "#94A3B8",
        text: "Placed",
        icon: "time-outline",
      };
    if (s === "preparing")
      return {
        color: THEME.warning,
        bg: THEME.warning,
        text: "Preparing",
        icon: "flame-outline",
      };
    if (s === "ready")
      return {
        color: THEME.primary,
        bg: THEME.primary,
        text: "Ready to Serve",
        icon: "restaurant-outline",
      };
    if (s === "served" || s === "completed")
      return {
        color: THEME.success,
        bg: THEME.success,
        text: "Served",
        icon: "checkmark-circle-outline",
      };
    if (s === "cancelled" || s === "rejected")
      return {
        color: THEME.danger,
        bg: THEME.danger,
        text: "Cancelled",
        icon: "close-circle-outline",
      };
    return {
      color: THEME.textSecondary,
      bg: "#94A3B8",
      text: "Unknown",
      icon: "help-circle-outline",
    };
  };

  const renderOrderItem = ({
    item: order,
    index,
  }: {
    item: any;
    index: number;
  }) => {
    const statusUI = getStatusUI(order.status);
    const orderStatus = order.status?.toLowerCase() || "";

    const isCancelled =
      orderStatus === "cancelled" || orderStatus === "rejected";
    const isPending =
      orderStatus === "pending" ||
      orderStatus === "placed" ||
      orderStatus === "payment_pending";
    const isPreparing = orderStatus === "preparing";
    const isPaymentRequired = orderStatus === "payment_pending";

    const displayTotal = isCancelled
      ? 0
      : parseFloat(String(order.total_amount)) || 0;
    const displayOrderNumber = displayOrders.length - index;

    // 👇 Updated UPI String
    const upiId = menuData?.restaurant?.upi_id || "";
    const restaurantName = menuData?.restaurant?.name || "Restaurant";
    const pa = encodeURIComponent(upiId);
    const pn = encodeURIComponent(restaurantName);
    const tn = encodeURIComponent(
      `Order for ${isRoom ? "Room" : "Table"} ${tableData?.tId || ""}`,
    );
    const am = displayTotal.toFixed(2);
    const upiString = `upi://pay?pa=${pa}&pn=${pn}&tn=${tn}&am=${am}&cu=INR`;

    return (
      <View
        style={[
          styles.orderCard,
          isCancelled && { opacity: 0.5, borderColor: THEME.danger },
          isPaymentRequired && { borderColor: THEME.danger, borderWidth: 2 },
        ]}
      >
        <View style={styles.orderHeader}>
          <View>
            <Text
              style={[
                styles.orderId,
                isCancelled && {
                  textDecorationLine: "line-through",
                  color: THEME.textSecondary,
                },
              ]}
            >
              Order #{displayOrderNumber}
            </Text>
            <Text style={styles.orderTime}>
              Placed by {order.customer_name || "Guest"}
            </Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: statusUI.bg + "15" },
            ]}
          >
            <Ionicons
              name={statusUI.icon as any}
              size={14}
              color={statusUI.color}
              style={{ marginRight: 4 }}
            />
            <Text style={[styles.statusText, { color: statusUI.color }]}>
              {statusUI.text}
            </Text>
          </View>
        </View>

        <View style={styles.itemsList}>
          {Array.isArray(order.items) &&
            order.items.map((item: any, i: number) => {
              const unitPrice =
                parseFloat(String(item.unit_price || item.price || 0)) || 0;
              const qty = parseInt(String(item.quantity || 1), 10) || 1;
              const totalPrice =
                parseFloat(String(item.total_price || unitPrice * qty)) || 0;

              return (
                <View key={`item-${item.id || i}`} style={styles.orderItem}>
                  <View
                    style={{ flexDirection: "row", flex: 1, paddingRight: 12 }}
                  >
                    <Text
                      style={[
                        styles.itemQtyBadge,
                        isCancelled && { color: THEME.textSecondary },
                      ]}
                    >
                      {qty}x
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.itemText,
                          isCancelled && {
                            textDecorationLine: "line-through",
                            color: THEME.textSecondary,
                          },
                        ]}
                        numberOfLines={2}
                      >
                        {item.menu_item?.name || item.item_name || "Menu Item"}
                      </Text>
                      {item.notes && (
                        <Text style={styles.itemNote}>Note: {item.notes}</Text>
                      )}
                    </View>
                  </View>
                  <Text
                    style={[
                      styles.itemPrice,
                      isCancelled && {
                        textDecorationLine: "line-through",
                        color: THEME.textSecondary,
                      },
                    ]}
                  >
                    {currency}
                    {totalPrice.toFixed(2)}
                  </Text>
                </View>
              );
            })}
        </View>

        {order.notes && !isCancelled && (
          <View style={styles.orderLevelNote}>
            <Ionicons
              name="chatbox-ellipses-outline"
              size={14}
              color="#B45309"
            />
            <Text style={styles.orderLevelNoteText}>{order.notes}</Text>
          </View>
        )}

        <View style={styles.orderFooter}>
          <Text style={styles.totalText}>Order Total</Text>
          <Text
            style={[styles.totalText, isCancelled && { color: THEME.danger }]}
          >
            {currency}
            {displayTotal.toFixed(2)}
          </Text>
        </View>

        {isPaymentRequired && (
          <View style={styles.paymentSection}>
            <Text style={styles.paymentRequiredTitle}>Action Required</Text>
            <Text style={styles.paymentRequiredSub}>
              Please pay {currency}
              {displayTotal.toFixed(2)} to confirm your order.
            </Text>

            {upiId ? (
              <View style={styles.qrBox}>
                <QRCode value={upiString} size={120} />
                <Text style={styles.qrText}>SCAN TO PAY VIA UPI</Text>
              </View>
            ) : (
              <View style={styles.qrBox}>
                <Ionicons name="wallet-outline" size={40} color={ANN.orange} />
                <Text style={styles.qrText}>PAY AT COUNTER</Text>
              </View>
            )}

            <View style={styles.paymentButtons}>
              <TouchableOpacity
                style={[styles.payBtn, { backgroundColor: THEME.success }]}
                onPress={() => handlePaymentSubmitted(order.id, "upi")}
                disabled={processingPaymentId === order.id}
              >
                {processingPaymentId === order.id ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.payBtnText}>Paid via UPI</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.payBtn,
                  {
                    backgroundColor: THEME.cardBg,
                    borderWidth: 1,
                    borderColor: THEME.textSecondary,
                  },
                ]}
                onPress={() => handlePaymentSubmitted(order.id, "cash")}
                disabled={processingPaymentId === order.id}
              >
                {processingPaymentId === order.id ? (
                  <ActivityIndicator color={THEME.textSecondary} />
                ) : (
                  <Text
                    style={[styles.payBtnText, { color: THEME.textPrimary }]}
                  >
                    Pay Cash
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {isPending && (
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => handleCancelOrder(order.id)}
            disabled={cancellingId === order.id}
          >
            {cancellingId === order.id ? (
              <ActivityIndicator color={THEME.danger} size="small" />
            ) : (
              <Text style={styles.cancelBtnText}>Cancel Order</Text>
            )}
          </TouchableOpacity>
        )}

        {isPreparing && (
          <View style={styles.preparingWarningBox}>
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={THEME.warning}
            />
            <Text style={styles.preparingWarningText}>
              The kitchen is currently preparing this order. To cancel or return
              an item, please call the waiter.
            </Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Order History</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View
            style={[
              styles.statusIndicator,
              connectionStatus === "live"
                ? styles.bgSuccess
                : connectionStatus === "connecting"
                  ? styles.bgWarning
                  : styles.bgDanger,
            ]}
          >
            <View
              style={[
                styles.statusDot,
                connectionStatus === "live"
                  ? styles.dotSuccess
                  : connectionStatus === "connecting"
                    ? styles.dotWarning
                    : styles.dotDanger,
              ]}
            />
            <Text style={styles.statusIndicatorText}>
              {connectionStatus === "live"
                ? "Live"
                : connectionStatus === "connecting"
                  ? "Connecting..."
                  : "Offline"}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={onRefresh}
            disabled={refreshing || loading}
          >
            <Ionicons name="reload" size={18} color={THEME.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      {loading && displayOrders.length === 0 ? (
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color={THEME.primary} />
          <Text style={styles.emptyStateText}>Loading orders...</Text>
        </View>
      ) : displayOrders.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons
            name="receipt-outline"
            size={64}
            color={THEME.textSecondary}
            style={{ opacity: 0.3 }}
          />
          <Text style={styles.emptyStateTitle}>No orders found.</Text>
          <Text style={styles.emptyStateText}>
            When you place orders, they will appear here.
          </Text>
          <TouchableOpacity
            style={styles.webSafeRefreshBtn}
            onPress={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={THEME.primary} />
            ) : (
              <>
                <Ionicons
                  name="reload"
                  size={16}
                  color={THEME.primary}
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.webSafeRefreshText}>Tap to Refresh</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={displayOrders}
          keyExtractor={(item) => `order-${item.id}`}
          renderItem={renderOrderItem}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={Platform.OS !== "ios"}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={THEME.primary}
            />
          }
          ListFooterComponent={() => (
            <View style={styles.askBillContainer}>
              <TouchableOpacity
                style={styles.askBillBtn}
                onPress={async () => {
                  if (sessionToken) {
                    try {
                      await SessionService.requestBill(sessionToken);
                    } catch (e) {}
                  }
                  billTabNotifier.show();
                  setTimeout(() => {
                    router.push({
                      pathname: "/(tabs)/bills",
                      params: { billRequested: "true" },
                    });
                  }, 100);
                }}
              >
                <MaterialIcons name="receipt-long" size={24} color="#fff" />
                <Text style={styles.askBillBtnText}>Ask for Bill</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
      <TouchableOpacity style={styles.fab} onPress={handleCallWaiter}>
        <Ionicons name="notifications-outline" size={24} color={THEME.cardBg} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.background,
    maxWidth: 480,
    width: "100%",
    alignSelf: "center",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "android" ? 40 : 16,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    alignItems: "center",
    backgroundColor: THEME.cardBg,
  },
  headerTitle: { fontSize: 20, fontWeight: "bold", color: THEME.textPrimary },
  statusIndicator: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  bgSuccess: { backgroundColor: "rgba(16, 185, 129, 0.1)" },
  bgWarning: { backgroundColor: "rgba(245, 158, 11, 0.1)" },
  bgDanger: { backgroundColor: "rgba(239, 68, 68, 0.1)" },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  dotSuccess: { backgroundColor: THEME.success },
  dotWarning: { backgroundColor: THEME.warning },
  dotDanger: { backgroundColor: THEME.danger },
  statusIndicatorText: {
    fontSize: 11,
    fontWeight: "bold",
    color: THEME.textSecondary,
  },
  refreshBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: THEME.background,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: THEME.border,
    ...(Platform.OS === "web" ? { cursor: "pointer" } : ({} as any)),
  },
  scrollContent: { padding: 16, paddingBottom: 100 },
  orderCard: {
    backgroundColor: THEME.cardBg,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: THEME.border,
    ...Platform.select({
      web: { boxShadow: "0px 2px 8px rgba(0,0,0,0.04)" } as any,
      default: {
        shadowColor: THEME.textPrimary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
      },
    }),
  },
  orderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  orderId: { fontSize: 16, fontWeight: "bold", color: THEME.textPrimary },
  orderTime: { fontSize: 13, color: THEME.textSecondary, marginTop: 2 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusText: { fontSize: 12, fontWeight: "bold" },
  itemsList: { gap: 12 },
  orderItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  itemQtyBadge: {
    color: THEME.primary,
    fontWeight: "bold",
    fontSize: 14,
    marginRight: 8,
    width: 24,
  },
  itemText: { fontSize: 15, fontWeight: "500", color: THEME.textPrimary },
  itemPrice: { fontSize: 15, color: THEME.textPrimary, fontWeight: "600" },
  itemNote: {
    fontSize: 13,
    color: THEME.textSecondary,
    fontStyle: "italic",
    marginTop: 4,
  },
  orderLevelNote: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFBEB",
    padding: 12,
    marginTop: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FEF3C7",
  },
  orderLevelNoteText: {
    fontSize: 13,
    color: "#B45309",
    marginLeft: 8,
    flex: 1,
  },
  orderFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: THEME.border,
  },
  totalText: { fontSize: 16, fontWeight: "bold", color: THEME.textPrimary },
  cancelBtn: {
    marginTop: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.danger,
    alignItems: "center",
    backgroundColor: THEME.cardBg,
  },
  cancelBtnText: { color: THEME.danger, fontWeight: "bold", fontSize: 14 },
  preparingWarningBox: {
    flexDirection: "row",
    marginTop: 16,
    padding: 10,
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    borderRadius: 8,
    alignItems: "center",
  },
  preparingWarningText: {
    color: THEME.warning,
    fontSize: 12,
    marginLeft: 6,
    flex: 1,
    fontStyle: "italic",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
    marginTop: 60,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: THEME.textPrimary,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: THEME.textSecondary,
    textAlign: "center",
    marginTop: 8,
  },
  webSafeRefreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.primaryLight,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 24,
    ...(Platform.OS === "web" ? { cursor: "pointer" } : ({} as any)),
  },
  webSafeRefreshText: {
    color: THEME.primary,
    fontWeight: "bold",
    fontSize: 14,
  },
  fab: {
    position: "absolute",
    bottom: 24,
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: THEME.primary,
    justifyContent: "center",
    alignItems: "center",
    ...Platform.select({
      default: {
        shadowColor: THEME.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 5,
      },
    }),
  },
  askBillContainer: { marginTop: 10, marginBottom: 40 },
  askBillBtn: {
    backgroundColor: THEME.primary,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    gap: 10,
    shadowColor: THEME.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  askBillBtnText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  paymentSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: THEME.border,
    alignItems: "center",
    backgroundColor: "#fdf2f8",
    padding: 16,
    borderRadius: 12,
  },
  paymentRequiredTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: THEME.danger,
    marginBottom: 4,
  },
  paymentRequiredSub: {
    fontSize: 13,
    color: THEME.textSecondary,
    marginBottom: 16,
    textAlign: "center",
  },
  qrBox: {
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  qrText: {
    fontSize: 11,
    fontWeight: "bold",
    color: THEME.textSecondary,
    marginTop: 8,
    letterSpacing: 1,
  },
  paymentButtons: { flexDirection: "row", gap: 8, width: "100%" },
  payBtn: {
    paddingVertical: 12,
    borderRadius: 8,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  payBtnText: { color: "#fff", fontWeight: "bold", fontSize: 13 },
});
