/**
 * app/(tabs)/bills.tsx
 *
 * Fixes applied:
 *   1. RAZORPAY WEB: Import changed from `react-native-razorpay` to
 *      `../../services/razorpay` which resolves to the correct .web.ts or
 *      .native.ts shim automatically via Metro bundler.
 *
 *   2. EXPO-PRINT / EXPO-SHARING: These are now lazy-imported inside the
 *      native branch of handleDownloadBill so they are never evaluated on web.
 *
 *   3. ACTIVE METHOD LOGIC: Fixed so that payment_method values of "online",
 *      "pending", or anything other than "cash" correctly shows the UPI /
 *      Razorpay tab instead of rendering nothing.
 *
 *   4. VARIABLE ORDERING: tableNum, restaurantName, restaurantLogo,
 *      restaurantAddress, displayHostName moved to top of component so they
 *      are in scope when handleRazorpayPayment is defined.
 */

import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";

// FIX 1: Use platform-aware shim instead of react-native-razorpay directly.
// Metro resolves this to razorpay.web.ts on web and razorpay.native.ts on mobile.
import RazorpayCheckout from "../../services/razorpay";

import { THEME } from "../../constants/theme";
import { useSession } from "../../context/SessionContext";
import { apiCall } from "../../services/api";
import { initEcho } from "../../services/echo";
import { OrderService } from "../../services/order.service";
import { SessionService } from "../../services/session.service";

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

export default function BillsTab() {
  const {
    sessionToken,
    tableData,
    menuData,
    orders,
    setOrders,
    isPrimary,
    customerName,
    clearSession,
  } = useSession();

  const { billRequested } = useLocalSearchParams<{ billRequested?: string }>();
  const isRoom = tableData?.type === "room";

  // ─── FIX 4: Derived variables moved to the top so handleRazorpayPayment
  //            can safely close over them. ────────────────────────────────
  const currency = menuData?.restaurant?.currency_symbol || "₹";
  const restaurantName = menuData?.restaurant?.name || "Restaurant Bill";
  const restaurantLogo = menuData?.restaurant?.logo || null;
  const restaurantAddress = menuData?.restaurant?.address || "";
  const tableNum = menuData?.table?.number || tableData?.tId || "-";
  const displayHostName = isPrimary
    ? customerName
    : menuData?.session?.host_name || "Customer";
  const sessionId =
    menuData?.session?.id || menuData?.session?.session_id || tableData?.tId;
  // ─────────────────────────────────────────────────────────────────────────

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "live" | "offline"
  >("connecting");
  const [paymentData, setPaymentData] = useState<any>(null);
  const [billingSummary, setBillingSummary] = useState<any>(null);

  const echoRef = useRef<any>(null);

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
      return Array.from(map.values()).sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
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
        if (data.payment) setPaymentData(data.payment);
        if (data.billing_summary) setBillingSummary(data.billing_summary);
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
    fetchOrders(abortController.signal);
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
        if (event.order) {
          mergeOrders([event.order]);
          fetchOrders();
        }
      })
      .listen(".BillGenerated", (event: any) => {
        if (!isMounted) return;
        setPaymentData(event.paymentData);
        fetchOrders();
      })
      .listen(".SessionEnded", async () => {
        if (!isMounted) return;
        Alert.alert(
          "Thank You!",
          `Your ${isRoom ? "room" : "table"} session has been closed. See you again!`,
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

  const validOrders = useMemo(() => {
    return Array.isArray(orders)
      ? orders.filter(
          (o) =>
            o.status?.toLowerCase() !== "cancelled" &&
            o.status?.toLowerCase() !== "rejected",
        )
      : [];
  }, [orders]);

  const isBillPaid = paymentData?.status === "paid";

  useEffect(() => {
    if (isBillPaid && echoRef.current && sessionId) {
      if (echoRef.current.connector?.pusher?.connection) {
        echoRef.current.connector.pusher.connection.unbind_all();
      }
      echoRef.current.leave(`session.${sessionId}`);
      echoRef.current.disconnect();
      echoRef.current = null;
      setConnectionStatus("offline");
    }
  }, [isBillPaid, sessionId]);

  const handleSelectMethod = async (method: "cash" | "upi" | "pending") => {
    if (!sessionToken) return;
    setPaymentData((prev: any) => ({ ...prev, payment_method: method }));
    try {
      await SessionService.selectPaymentMethod(sessionToken, method);
    } catch (e) {
      Alert.alert("Error", "Could not select payment method.");
      fetchOrders();
    }
  };

  // ─── RAZORPAY PAYMENT HANDLER ────────────────────────────────────────────
  // All variables it closes over (tableNum, restaurantName, etc.) are now
  // declared above this function so there is no temporal-dead-zone risk.
  const handleRazorpayPayment = async () => {
    if (!paymentData?.id || !sessionToken) return;
    setIsProcessingPayment(true);

    try {
      // 1. Ask backend to create a Razorpay order securely
      const orderResponse = await apiCall("/payment/razorpay/create", {
        method: "POST",
        body: JSON.stringify({ payment_id: paymentData.id }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
      });

      // 2. Open Razorpay checkout (native SDK on mobile, checkout.js on web)
      const options = {
        description: `Bill for ${isRoom ? "Room" : "Table"} ${tableNum}`,
        image: restaurantLogo || "https://annsathi.com/logo.png",
        currency: orderResponse.currency,
        key: orderResponse.key,
        amount: orderResponse.amount,
        name: restaurantName,
        order_id: orderResponse.razorpay_order_id,
        theme: { color: ANN.darkBlue },
        prefill: { name: displayHostName },
      };

      const data = await RazorpayCheckout.open(options);

      // 3. Verify the payment with the backend
      await apiCall("/payment/razorpay/verify", {
        method: "POST",
        body: JSON.stringify({
          payment_id: paymentData.id,
          razorpay_order_id: data.razorpay_order_id,
          razorpay_payment_id: data.razorpay_payment_id,
          razorpay_signature: data.razorpay_signature,
        }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
      });

      if (Platform.OS === "web") {
        window.alert("Payment Received! We are confirming with the kitchen.");
      } else {
        Alert.alert(
          "Payment Received",
          "We are confirming your payment with the kitchen. The screen will update automatically.",
        );
      }

      fetchOrders();
    } catch (error: any) {
      if (error.code) {
        // Native SDK / web modal error (user cancelled, network error in SDK)
        if (Platform.OS === "web") {
          window.alert("Payment Cancelled. Transaction was not completed.");
        } else {
          Alert.alert("Payment Cancelled", "Transaction was not completed.");
        }
      } else {
        // Backend API error (fraud attempt, expired order, etc.)
        const msg =
          error.message || "Could not process payment. Please try again.";
        if (Platform.OS === "web") {
          window.alert(msg);
        } else {
          Alert.alert("Notice", msg);
        }
      }
    } finally {
      setIsProcessingPayment(false);
    }
  };
  // ─────────────────────────────────────────────────────────────────────────

  const { consolidatedItems, rawSubtotal, totalItemsCount } = useMemo(() => {
    const itemMap = new Map();
    let total = 0;
    let qtyCount = 0;
    validOrders.forEach((order) => {
      if (Array.isArray(order.items)) {
        order.items.forEach((item) => {
          const key = item.menu_item_id || item.item_name;
          const itemName =
            item.menu_item?.name || item.item_name || "Menu Item";
          const itemPrice =
            parseFloat(String(item.unit_price || item.price || 0)) || 0;
          const itemQty = parseInt(String(item.quantity || 1), 10) || 1;

          total += itemPrice * itemQty;
          qtyCount += itemQty;
          if (itemMap.has(key)) {
            const existing = itemMap.get(key);
            existing.quantity += itemQty;
            existing.total_price += itemPrice * itemQty;
          } else {
            itemMap.set(key, {
              id: key,
              name: itemName,
              unit_price: itemPrice,
              quantity: itemQty,
              total_price: itemPrice * itemQty,
            });
          }
        });
      }
    });
    return {
      consolidatedItems: Array.from(itemMap.values()),
      rawSubtotal: total || 0,
      totalItemsCount: qtyCount || 0,
    };
  }, [validOrders]);

  const finalSubtotal = parseFloat(paymentData?.subtotal || rawSubtotal || 0);
  const finalDiscount = parseFloat(paymentData?.discount_amount || 0);
  const finalTax = parseFloat(paymentData?.tax_amount || 0);
  const finalExtraCharges = parseFloat(paymentData?.extra_charges || 0);
  const calculatedGrandTotal =
    finalSubtotal - finalDiscount + finalTax + finalExtraCharges;
  const amountPaid = parseFloat(billingSummary?.amount_paid || 0);
  const amountDue = isBillPaid ? 0 : parseFloat(paymentData?.amount || 0);

  const upiId = paymentData?.upi_id || menuData?.restaurant?.upi_id || "";
  const pa = encodeURIComponent(upiId);
  const pn = encodeURIComponent(restaurantName);
  const tn = encodeURIComponent(
    `Bill for ${isRoom ? "Room" : "Table"} ${tableNum}`,
  );
  const tr = encodeURIComponent(
    paymentData?.transaction_reference || `TXN${Date.now()}`,
  );
  const mc = encodeURIComponent(paymentData?.merchant_category_code || "5812");
  const am = amountDue.toFixed(2);
  const cu = "INR";
  const upiString = `upi://pay?pa=${pa}&pn=${pn}&tr=${tr}&tn=${tn}&mc=${mc}&am=${am}&cu=${cu}`;

  // ─── DOWNLOAD BILL ───────────────────────────────────────────────────────
  // FIX 2: expo-print and expo-sharing are lazy-imported inside the native
  // branch so they are never evaluated on web (they throw on web).
  const handleDownloadBill = async () => {
    if (!isBillPaid && amountDue > 0) return;
    setIsDownloading(true);

    const dateStr = new Date().toLocaleString();
    let itemsHtml = "";

    consolidatedItems.forEach((item) => {
      itemsHtml += `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;font-size:14px;margin-bottom:12px;color:#1f2937;">
          <div>
            <span style="font-weight:700;">
              <span style="color:#6b7280;margin-right:4px;">${item.quantity}x</span>${item.name}
            </span>
            <br>
            <span style="font-size:10px;color:#6b7280;text-transform:uppercase;">[ITEM]</span>
          </div>
          <span style="font-weight:800;white-space:nowrap;">
            ${currency}${(item.total_price || 0).toFixed(2)}
          </span>
        </div>
      `;
    });

    const receiptHTML = `
      <div style="padding:30px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;background:#ffffff;max-width:500px;margin:auto;">
        ${restaurantLogo ? `<div style="text-align:center;margin-bottom:16px;"><img src="${restaurantLogo}" alt="Restaurant Logo" style="max-height:80px;max-width:180px;object-fit:contain;border-radius:8px;" /></div>` : ""}
        <div style="text-align:center;font-size:26px;font-weight:900;color:#111827;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;">${restaurantName}</div>
        ${restaurantAddress ? `<div style="text-align:center;font-size:13px;color:#4b5563;margin-bottom:8px;line-height:1.4;padding:0 20px;">${restaurantAddress}</div>` : ""}
        <div style="text-align:center;font-size:12px;color:#6b7280;margin-bottom:30px;">${dateStr}</div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;">
          <div style="text-align:center;font-size:22px;font-weight:900;margin-bottom:4px;">${isRoom ? "ROOM" : "TABLE"} ${tableNum}</div>
          <div style="text-align:center;font-size:10px;font-weight:700;color:#6b7280;letter-spacing:.1em;text-transform:uppercase;margin-bottom:24px;">FINAL BILLING SUMMARY</div>
          <div style="background:#f3f4f6;padding:10px 14px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:700;margin-bottom:24px;">
            <span>👑 HOST: ${displayHostName}</span>
            <span style="font-weight:400;font-size:12px;color:#6b7280;">(${totalItemsCount} Items)</span>
          </div>
          <div style="margin-bottom:24px;">${itemsHtml}</div>
          <div style="border-top:2px solid #111827;padding-top:16px;margin-top:24px;">
            <div style="display:flex;justify-content:space-between;font-size:14px;color:#4b5563;margin-bottom:8px;"><span>Total Orders Delivered:</span><span>${totalItemsCount}</span></div>
            <div style="display:flex;justify-content:space-between;font-size:14px;color:#111827;font-weight:700;margin-bottom:8px;margin-top:12px;"><span>Subtotal:</span><span>${currency}${finalSubtotal.toFixed(2)}</span></div>
            ${finalDiscount > 0 ? `<div style="display:flex;justify-content:space-between;font-size:14px;color:#059669;margin-bottom:8px;"><span>Discount:</span><span style="font-weight:700;">- ${currency}${finalDiscount.toFixed(2)}</span></div>` : ""}
            ${finalTax > 0 ? `<div style="display:flex;justify-content:space-between;font-size:14px;color:#dc2626;margin-bottom:8px;"><span>Tax:</span><span style="font-weight:700;">+ ${currency}${finalTax.toFixed(2)}</span></div>` : ""}
            ${finalExtraCharges > 0 ? `<div style="display:flex;justify-content:space-between;font-size:14px;color:#111827;margin-bottom:8px;"><span>Extra Charges:</span><span style="font-weight:700;">+ ${currency}${finalExtraCharges.toFixed(2)}</span></div>` : ""}
            <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:900;color:#111827;margin-top:16px;padding-top:12px;border-top:1px dashed #d1d5db;"><span>GRAND TOTAL</span><span>${currency}${calculatedGrandTotal.toFixed(2)}</span></div>
            ${amountPaid > 0 ? `<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;color:#059669;margin-top:8px;"><span>Already Paid</span><span>- ${currency}${amountPaid.toFixed(2)}</span></div><div style="display:flex;justify-content:space-between;font-size:18px;font-weight:900;color:#dc2626;margin-top:8px;"><span>AMOUNT DUE</span><span>${currency}${amountDue.toFixed(2)}</span></div>` : ""}
          </div>
        </div>
        <div style="text-align:center;margin-top:40px;font-size:12px;font-weight:600;color:#6b7280;">Thank You for Visiting!</div>
      </div>
    `;

    try {
      if (Platform.OS === "web") {
        const generateWebPDF = () => {
          const opt = {
            margin: 0.5,
            filename: `Bill_${isRoom ? "Room" : "Table"}_${tableNum}.pdf`,
            image: { type: "jpeg", quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
          };
          (window as any)
            .html2pdf()
            .set(opt)
            .from(receiptHTML)
            .save()
            .then(() => setIsDownloading(false));
        };

        if (!(window as any).html2pdf) {
          const script = document.createElement("script");
          script.src =
            "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
          script.onload = generateWebPDF;
          document.head.appendChild(script);
        } else {
          generateWebPDF();
        }
      } else {
        // FIX 2: Lazy import so these native-only modules are never loaded on web
        const Print = await import("expo-print");
        const Sharing = await import("expo-sharing");
        const { uri } = await Print.printToFileAsync({ html: receiptHTML });
        await Sharing.shareAsync(uri, {
          UTI: ".pdf",
          mimeType: "application/pdf",
        });
        setIsDownloading(false);
      }
    } catch (err) {
      setIsDownloading(false);
      if (Platform.OS === "web") {
        window.alert("Could not generate PDF bill.");
      } else {
        Alert.alert("Error", "Could not generate PDF bill.");
      }
    }
  };
  // ─────────────────────────────────────────────────────────────────────────

  // ─── FIX 3: activeMethod ─────────────────────────────────────────────────
  // Before: payment_method values of "online" or "pending" fell through to
  // the raw value, which matched neither "upi" nor "cash", so the Razorpay
  // button section was never rendered.
  // After:  anything other than "cash" is treated as the UPI / Razorpay tab.
  const activeMethod = paymentData?.payment_method === "cash" ? "cash" : "upi";
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.mainWrapper}>
      <Image
        source={require("../../assets/images/bg.png")}
        style={styles.bgImage}
      />
      <View style={styles.bgOverlay} />

      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.back()}
          >
            <MaterialIcons name="arrow-back" size={24} color={ANN.darkBlue} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Bill Details</Text>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={onRefresh}
            disabled={refreshing || loading}
          >
            <Ionicons name="reload" size={20} color={ANN.darkBlue} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={ANN.red}
            />
          }
        >
          {loading && !paymentData && !billingSummary ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color={ANN.orange} />
              <Text style={styles.emptyStateText}>Loading bill details...</Text>
            </View>
          ) : !paymentData ? (
            <View style={styles.emptyState}>
              <Ionicons
                name="hourglass-outline"
                size={70}
                color={ANN.darkBlueLight}
              />
              <Text style={styles.emptyStateTitle}>Bill Not Generated</Text>
              <Text style={styles.emptyStateText}>
                Please wait while the manager generates your final bill with
                applicable taxes and discounts.
              </Text>
              <TouchableOpacity
                style={styles.askBillBtnFallback}
                onPress={async () => {
                  if (sessionToken) {
                    try {
                      await SessionService.requestBill(sessionToken);
                      Alert.alert(
                        "Requested",
                        "Manager has been notified for the bill.",
                      );
                    } catch (e) {}
                  }
                }}
              >
                <Text style={styles.askBillBtnText}>Remind Manager</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.pageTitleContainer}>
                <Text style={styles.pageTitle}>Final Summary</Text>
                <Text style={styles.pageSubtitle}>
                  {isBillPaid || amountDue === 0
                    ? "Your payment is complete. Thank you!"
                    : "Review your order and select a payment method"}
                </Text>
              </View>

              {/* Order Items Card */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Order Items</Text>
                  <Text style={styles.tableBadge}>
                    {isRoom ? "Room" : "Table"} #{tableNum}
                  </Text>
                </View>

                <View style={styles.tableHeader}>
                  <Text style={[styles.thText, { flex: 2 }]}>ITEM</Text>
                  <Text
                    style={[styles.thText, { width: 40, textAlign: "center" }]}
                  >
                    QTY
                  </Text>
                  <Text
                    style={[styles.thText, { width: 80, textAlign: "right" }]}
                  >
                    PRICE
                  </Text>
                </View>

                <View style={styles.tableBody}>
                  {consolidatedItems.map((item, idx) => (
                    <View key={idx} style={styles.itemRow}>
                      <View
                        style={{
                          flex: 2,
                          flexDirection: "row",
                          alignItems: "center",
                        }}
                      >
                        <View style={styles.itemIconBox}>
                          <Ionicons
                            name="fast-food"
                            size={14}
                            color={ANN.darkBlue}
                          />
                        </View>
                        <Text style={styles.itemNameText} numberOfLines={2}>
                          {item.name}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.itemQtyText,
                          { width: 40, textAlign: "center" },
                        ]}
                      >
                        {String(item.quantity).padStart(2, "0")}
                      </Text>
                      <Text
                        style={[
                          styles.itemPriceText,
                          { width: 80, textAlign: "right" },
                        ]}
                      >
                        {currency}
                        {(item.total_price || 0).toFixed(2)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* Payment Method Card */}
              {!isBillPaid && amountDue > 0 && paymentData && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Payment Method</Text>

                  <View style={styles.methodToggleContainer}>
                    <TouchableOpacity
                      style={[
                        styles.methodBox,
                        activeMethod === "upi" && styles.methodBoxActive,
                      ]}
                      onPress={() => handleSelectMethod("upi")}
                    >
                      <Ionicons
                        name="card"
                        size={22}
                        color={
                          activeMethod === "upi"
                            ? ANN.darkBlue
                            : THEME.textSecondary
                        }
                      />
                      <Text
                        style={[
                          styles.methodText,
                          activeMethod === "upi" && styles.methodTextActive,
                        ]}
                      >
                        Pay via UPI
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.methodBox,
                        activeMethod === "cash" && styles.methodBoxActive,
                      ]}
                      onPress={() => handleSelectMethod("cash")}
                    >
                      <Ionicons
                        name="wallet"
                        size={22}
                        color={
                          activeMethod === "cash"
                            ? ANN.darkBlue
                            : THEME.textSecondary
                        }
                      />
                      <Text
                        style={[
                          styles.methodText,
                          activeMethod === "cash" && styles.methodTextActive,
                        ]}
                      >
                        Cash
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {activeMethod === "upi" && (
                    <View style={styles.upiDisplayBox}>
                      <Text style={styles.upiSubtitle}>
                        Pay instantly via UPI, Credit Card, or Netbanking
                      </Text>

                      <TouchableOpacity
                        style={[
                          styles.razorpayBtn,
                          isProcessingPayment && { opacity: 0.8 },
                        ]}
                        onPress={handleRazorpayPayment}
                        disabled={isProcessingPayment}
                      >
                        {isProcessingPayment ? (
                          <ActivityIndicator color="#ffffff" />
                        ) : (
                          <>
                            <Ionicons
                              name="lock-closed"
                              size={16}
                              color="#ffffff"
                            />
                            <Text style={styles.razorpayBtnText}>
                              Pay {currency}
                              {amountDue.toFixed(2)} Securely
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>

                      <View style={styles.dividerContainer}>
                        <View style={styles.dividerLine} />
                        <Text style={styles.dividerText}>OR</Text>
                        <View style={styles.dividerLine} />
                      </View>

                      <Text style={styles.qrFallbackText}>
                        Scan QR Code manually via any UPI App
                      </Text>
                      <View style={styles.qrInnerSmall}>
                        {upiId ? (
                          <QRCode value={upiString} size={110} />
                        ) : (
                          <Text
                            style={{ color: THEME.textSecondary, fontSize: 12 }}
                          >
                            UPI not available
                          </Text>
                        )}
                      </View>
                    </View>
                  )}

                  {activeMethod === "cash" && (
                    <View style={styles.cashDisplayBox}>
                      <Ionicons
                        name="cash-outline"
                        size={40}
                        color={ANN.orange}
                      />
                      <Text style={styles.cashScanText}>PAY AT COUNTER</Text>
                      <Text style={styles.cashMerchantText}>
                        Please hand over cash to the staff member.
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Bill Breakdown Card */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Bill Breakdown</Text>

                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Subtotal</Text>
                  <Text style={styles.breakdownValue}>
                    {currency}
                    {finalSubtotal.toFixed(2)}
                  </Text>
                </View>

                {finalDiscount > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Discount</Text>
                    <Text
                      style={[styles.breakdownValue, { color: THEME.success }]}
                    >
                      -{currency}
                      {finalDiscount.toFixed(2)}
                    </Text>
                  </View>
                )}

                {finalTax > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Tax</Text>
                    <Text style={styles.breakdownValue}>
                      +{currency}
                      {finalTax.toFixed(2)}
                    </Text>
                  </View>
                )}

                {finalExtraCharges > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Extra Charges</Text>
                    <Text style={styles.breakdownValue}>
                      +{currency}
                      {finalExtraCharges.toFixed(2)}
                    </Text>
                  </View>
                )}

                <View style={styles.dashedDivider} />

                <View style={styles.grandTotalRow}>
                  <View>
                    <Text style={styles.grandTotalLabel}>Grand Total</Text>
                    <Text style={styles.inclusiveText}>
                      Inclusive of all local taxes
                    </Text>
                  </View>
                  <Text style={styles.grandTotalValue}>
                    {currency}
                    {calculatedGrandTotal.toFixed(2)}
                  </Text>
                </View>

                {amountPaid > 0 && (
                  <View style={[styles.breakdownRow, { marginTop: 8 }]}>
                    <Text
                      style={[styles.breakdownLabel, { color: THEME.success }]}
                    >
                      Already Paid
                    </Text>
                    <Text
                      style={[styles.breakdownValue, { color: THEME.success }]}
                    >
                      -{currency}
                      {amountPaid.toFixed(2)}
                    </Text>
                  </View>
                )}

                {amountDue > 0 && (
                  <View style={styles.grandTotalRow}>
                    <Text
                      style={[
                        styles.grandTotalLabel,
                        { color: THEME.danger, fontSize: 18 },
                      ]}
                    >
                      Amount Due
                    </Text>
                    <Text
                      style={[
                        styles.grandTotalValue,
                        { color: THEME.danger, fontSize: 24 },
                      ]}
                    >
                      {currency}
                      {amountDue.toFixed(2)}
                    </Text>
                  </View>
                )}

                {isBillPaid || amountDue === 0 ? (
                  <TouchableOpacity
                    style={styles.primaryActionBtn}
                    onPress={handleDownloadBill}
                    disabled={isDownloading}
                  >
                    {isDownloading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="document-text" size={20} color="#fff" />
                        <Text style={styles.primaryActionBtnText}>
                          Download Receipt
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : (
                  <View style={styles.pendingActionBox}>
                    <ActivityIndicator
                      size="small"
                      color={ANN.orange}
                      style={{ marginRight: 8 }}
                    />
                    <Text style={styles.pendingActionText}>
                      Waiting for restaurant confirmation...
                    </Text>
                  </View>
                )}

                <View style={styles.secureTransactionRow}>
                  <MaterialIcons
                    name="security"
                    size={14}
                    color={THEME.textSecondary}
                  />
                  <Text style={styles.secureTransactionText}>
                    ENCRYPTED TRANSACTION
                  </Text>
                </View>
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  mainWrapper: { flex: 1, backgroundColor: THEME.background },
  bgImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
    resizeMode: "cover",
    opacity: 0.15,
  },
  bgOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(248, 250, 252, 0.88)",
  },
  container: { flex: 1, maxWidth: 480, width: "100%", alignSelf: "center" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? 40 : 16,
    paddingBottom: 16,
    backgroundColor: "transparent",
  },
  iconBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  headerTitle: { fontSize: 18, fontWeight: "900", color: ANN.darkBlue },
  refreshBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "flex-end",
  },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },
  pageTitleContainer: { alignItems: "center", marginVertical: 20 },
  pageTitle: {
    fontSize: 26,
    fontWeight: "900",
    color: ANN.darkBlue,
    marginBottom: 6,
  },
  pageSubtitle: {
    fontSize: 14,
    color: THEME.textSecondary,
    textAlign: "center",
  },
  card: {
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(42, 71, 149, 0.1)",
    ...Platform.select({
      web: { boxShadow: "0px 4px 15px rgba(0,0,0,0.04)" } as any,
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 2,
      },
    }),
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  cardTitle: { fontSize: 18, fontWeight: "800", color: "#111827" },
  tableBadge: { fontSize: 13, color: THEME.textSecondary, fontWeight: "600" },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: ANN.darkBlueLight,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  thText: {
    fontSize: 11,
    fontWeight: "bold",
    color: ANN.darkBlue,
    letterSpacing: 0.5,
  },
  tableBody: { paddingHorizontal: 4 },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.04)",
  },
  itemIconBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: ANN.blueLight,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  itemNameText: { fontSize: 14, fontWeight: "700", color: "#1f2937", flex: 1 },
  itemQtyText: { fontSize: 14, fontWeight: "600", color: THEME.textSecondary },
  itemPriceText: { fontSize: 15, fontWeight: "800", color: "#111827" },
  methodToggleContainer: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
    marginBottom: 16,
  },
  methodBox: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  methodBoxActive: {
    backgroundColor: "#ffffff",
    borderColor: ANN.darkBlue,
    ...Platform.select({
      web: { boxShadow: "0px 4px 10px rgba(42,71,149,0.1)" } as any,
      default: {
        shadowColor: ANN.darkBlue,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
      },
    }),
  },
  methodText: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: "600",
    color: THEME.textSecondary,
  },
  methodTextActive: { color: ANN.darkBlue, fontWeight: "800" },
  upiDisplayBox: {
    backgroundColor: ANN.darkBlueLight,
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
  },
  upiSubtitle: {
    fontSize: 13,
    color: ANN.darkBlue,
    textAlign: "center",
    fontWeight: "600",
    marginBottom: 16,
  },
  razorpayBtn: {
    backgroundColor: ANN.darkBlue,
    width: "100%",
    paddingVertical: 14,
    borderRadius: 10,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    shadowColor: ANN.darkBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  razorpayBtnText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "bold",
    letterSpacing: 0.5,
  },
  dividerContainer: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    marginVertical: 20,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: "rgba(42,71,149,0.2)" },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 12,
    color: THEME.textSecondary,
    fontWeight: "bold",
  },
  qrFallbackText: {
    fontSize: 12,
    color: THEME.textSecondary,
    marginBottom: 12,
    fontWeight: "500",
  },
  qrInnerSmall: { backgroundColor: "#ffffff", padding: 10, borderRadius: 8 },
  cashDisplayBox: {
    backgroundColor: ANN.orangeLight,
    borderRadius: 12,
    padding: 30,
    alignItems: "center",
  },
  cashScanText: {
    fontSize: 14,
    fontWeight: "bold",
    color: ANN.red,
    letterSpacing: 1,
    marginTop: 12,
  },
  cashMerchantText: {
    fontSize: 13,
    color: THEME.textSecondary,
    marginTop: 4,
    textAlign: "center",
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  breakdownLabel: {
    fontSize: 14,
    color: THEME.textSecondary,
    fontWeight: "500",
  },
  breakdownValue: { fontSize: 14, color: "#111827", fontWeight: "700" },
  dashedDivider: {
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    borderStyle: "dashed",
    marginVertical: 16,
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  grandTotalLabel: { fontSize: 16, fontWeight: "800", color: "#111827" },
  inclusiveText: {
    fontSize: 10,
    color: THEME.textSecondary,
    fontStyle: "italic",
    marginTop: 2,
  },
  grandTotalValue: { fontSize: 28, fontWeight: "900", color: ANN.darkBlue },
  primaryActionBtn: {
    backgroundColor: ANN.darkBlue,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    shadowColor: ANN.darkBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryActionBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  pendingActionBox: {
    backgroundColor: ANN.orangeLight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: ANN.orange,
  },
  pendingActionText: { color: ANN.red, fontSize: 14, fontWeight: "bold" },
  secureTransactionRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 16,
    gap: 6,
  },
  secureTransactionText: {
    fontSize: 10,
    fontWeight: "700",
    color: THEME.textSecondary,
    letterSpacing: 0.5,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
    marginTop: 60,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: ANN.darkBlue,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: THEME.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  askBillBtnFallback: {
    marginTop: 24,
    backgroundColor: ANN.orange,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  askBillBtnText: { color: "#fff", fontWeight: "bold", fontSize: 15 },
  infoBanner: {
    flexDirection: "row",
    backgroundColor: "rgba(69,106,186,0.1)",
    padding: 16,
    borderRadius: 12,
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(42,71,149,0.15)",
  },
  infoBannerText: {
    flex: 1,
    fontSize: 13,
    color: ANN.darkBlue,
    lineHeight: 18,
    fontWeight: "500",
  },
});
