import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import React, { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useSession } from "../../context/SessionContext";

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

// 🔥 GLOBAL NOTIFIER: Ye track karega ki Bill tab kab dikhana hai
export const billTabNotifier = {
  listeners: new Set<Function>(),
  isVisible: false,
  show() {
    this.isVisible = true;
    this.listeners.forEach((l) => l(true));
  },
  subscribe(listener: Function) {
    this.listeners.add(listener);
    listener(this.isVisible);
    return () => this.listeners.delete(listener);
  },
};

export default function TabLayout() {
  const { sessionToken, isReady, cartTotalQty } = useSession();
  const [showBillTab, setShowBillTab] = useState(billTabNotifier.isVisible);

  useEffect(() => {
    const unsubscribe = billTabNotifier.subscribe(setShowBillTab);
    return () => {
      unsubscribe();
    };
  }, []);

  if (!isReady) {
    return null;
  }

  if (!sessionToken) {
    return <Redirect href="/" />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: ANN.red, // Orange/Red color for active tab
        tabBarInactiveTintColor: ANN.textSecondary,
        headerShown: false,
        tabBarStyle: {
          height: Platform.OS === "ios" ? 85 : 65,
          paddingBottom: Platform.OS === "ios" ? 28 : 10,
          paddingTop: 10,
          backgroundColor: "#FFFFFF",
          borderTopWidth: 1,
          borderTopColor: "rgba(42, 71, 149, 0.1)", // Light blue tint border
          ...Platform.select({
            ios: {
              shadowColor: ANN.darkBlue,
              shadowOffset: { width: 0, height: -2 },
              shadowOpacity: 0.05,
              shadowRadius: 8,
            },
            android: {
              elevation: 8,
            },
            web: { boxShadow: "0px -4px 16px rgba(42, 71, 149, 0.06)" } as any,
          }),
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "800",
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="menu"
        options={{
          title: "Menu",
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="menu-book" size={24} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="cart"
        options={{
          title: "Cart",
          tabBarIcon: ({ color }) => (
            <Ionicons name="cart" size={24} color={color} />
          ),
          tabBarBadge: (cartTotalQty || 0) > 0 ? cartTotalQty : undefined,
          tabBarBadgeStyle: {
            backgroundColor: ANN.red,
            color: "#fff",
            fontSize: 10,
            fontWeight: "bold",
            minWidth: 16,
            height: 16,
            lineHeight: 16,
          },
        }}
      />

      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="receipt-long" size={24} color={color} />
          ),
        }}
      />

      {/* 👇 FIX: Safe Tab Hiding (Display none) to prevent crash 👇 */}
      <Tabs.Screen
        name="bills"
        options={{
          title: "Bill",
          tabBarItemStyle: showBillTab ? undefined : { display: "none" },
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="payments" size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
