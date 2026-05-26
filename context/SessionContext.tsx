/**
 * context/SessionContext.tsx
 *
 * Fixes applied:
 *   1. Replaced all AsyncStorage calls with the platform-aware `storage`
 *      helper (services/storage.ts).  AsyncStorage is a no-op on web, which
 *      means sessions were lost on every page refresh in the browser.
 *   2. No other logic has been changed.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Alert, Platform } from "react-native";
import { SessionService } from "../services/session.service";
import { storage } from "../services/storage"; // FIX: was AsyncStorage

// --- TYPES ---
export type CartItem = {
  qty: number;
  price: number;
  name: string;
};

export type TableData = {
  rId: string;
  tId: string;
  token: string;
  type?: "room" | "table";
} | null;

type SessionContextType = {
  isReady: boolean;
  tableData: TableData;
  setTableData: (data: TableData) => void;
  sessionToken: string | null;
  customerName: string;
  joinStatus: string | null;
  setJoinStatus: (status: string | null) => void;
  isPrimary: boolean;
  cart: Record<number, CartItem>;
  setCustomerName: (name: string) => void;
  startSession: (name: string, mode: "new" | "join") => Promise<void>;
  clearSession: () => Promise<void>;
  activateRoomSession: (
    data: any,
    rId: string,
    tId: string,
    token: string,
  ) => Promise<void>;
  updateCart: (
    id: number,
    delta: number,
    price?: number,
    name?: string,
  ) => void;
  clearCart: () => void;
  cartTotalQty: number;
  cartTotalPrice: number;
  menuData: any;
  setMenuData: (data: any) => void;
  orders: any[];
  setOrders: React.Dispatch<React.SetStateAction<any[]>>;
};

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export const SessionProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [isReady, setIsReady] = useState(false);
  const [tableData, setTableData] = useState<TableData>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [joinStatus, setJoinStatus] = useState<string | null>(null);
  const [isPrimary, setIsPrimary] = useState(false);
  const [cart, setCart] = useState<Record<number, CartItem>>({});
  const [menuData, setMenuData] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);

  // Load persisted session on mount
  useEffect(() => {
    const loadStoredSession = async () => {
      try {
        const storedTable = await storage.getItem("tableData");
        const token = await storage.getItem("sessionToken");
        const name = await storage.getItem("customerName");
        const storedCart = await storage.getItem("cart");
        const primary = await storage.getItem("isPrimary");
        const status = await storage.getItem("joinStatus");
        const storedOrders = await storage.getItem("orders");

        if (storedTable) setTableData(JSON.parse(storedTable));
        if (token) setSessionToken(token);
        if (name) setCustomerName(name);
        if (storedCart) setCart(JSON.parse(storedCart));
        if (primary) setIsPrimary(primary === "true");
        if (status) setJoinStatus(status);
        if (storedOrders) setOrders(JSON.parse(storedOrders));
      } catch (e) {
        console.error("Failed to load session from storage", e);
      } finally {
        setIsReady(true);
      }
    };
    loadStoredSession();
  }, []);

  // Persist session changes
  useEffect(() => {
    if (!isReady) return;

    if (tableData) storage.setItem("tableData", JSON.stringify(tableData));
    if (sessionToken) storage.setItem("sessionToken", sessionToken);
    storage.setItem("customerName", customerName);
    storage.setItem("cart", JSON.stringify(cart));
    storage.setItem("orders", JSON.stringify(orders));
    storage.setItem("isPrimary", isPrimary ? "true" : "false");

    if (joinStatus) {
      storage.setItem("joinStatus", joinStatus);
    } else {
      storage.removeItem("joinStatus");
    }
  }, [
    tableData,
    sessionToken,
    customerName,
    cart,
    isPrimary,
    joinStatus,
    isReady,
    orders,
  ]);

  const updateCart = (
    id: number,
    delta: number,
    price: number = 0,
    name: string = "",
  ) => {
    setCart((prev) => {
      if (!prev[id] && delta < 0) return prev;

      const currentItem = prev[id] || { qty: 0, price, name };
      const newQty = currentItem.qty + delta;

      if (newQty <= 0) {
        const { [id]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: { ...currentItem, qty: newQty } };
    });
  };

  const clearCart = () => setCart({});

  const { cartTotalQty, cartTotalPrice } = useMemo(() => {
    let qty = 0;
    let price = 0;
    Object.values(cart).forEach((item) => {
      qty += item.qty;
      price += item.qty * item.price;
    });
    return { cartTotalQty: qty, cartTotalPrice: price };
  }, [cart]);

  const startSession = async (name: string, mode: "new" | "join") => {
    try {
      if (!tableData) {
        throw new Error(
          "Missing table QR data. Please scan the QR code again.",
        );
      }

      const data: any = await SessionService.startSession(
        name,
        mode,
        tableData.rId,
        tableData.tId,
        tableData.token,
      );

      setCustomerName(data.customer_name || name);
      setSessionToken(data.session_token);
      setJoinStatus(data.join_status);
      setIsPrimary(data.is_primary || false);
    } catch (e: any) {
      console.error("Session start failed", e);

      const errorMessage = e.message || "Failed to start session.";
      if (Platform.OS === "web") {
        window.alert(`Error: ${errorMessage}`);
      } else {
        Alert.alert("Session Error", errorMessage);
      }

      throw e;
    }
  };

  const clearSession = async () => {
    try {
      if (sessionToken) {
        await SessionService.leaveSession(
          sessionToken,
          tableData?.type || "table",
        );
      }
    } catch (e) {
      console.error("Failed to notify server of leave", e);
    } finally {
      setSessionToken(null);
      setCustomerName("");
      setCart({});
      setIsPrimary(false);
      setJoinStatus(null);
      setOrders([]);
      setTableData(null);
      setMenuData(null);

      await storage.multiRemove([
        "sessionToken",
        "customerName",
        "cart",
        "isPrimary",
        "joinStatus",
        "tableData",
        "orders",
      ]);
    }
  };

  const activateRoomSession = async (
    data: any,
    rId: string,
    tId: string,
    token: string,
  ) => {
    setSessionToken(data.session_token);
    setCustomerName(data.guest_name);
    setJoinStatus("active");
    setIsPrimary(true);
    setTableData({ rId, tId, token, type: "room" });

    await storage.multiSet([
      ["sessionToken", data.session_token],
      ["customerName", data.guest_name],
      ["joinStatus", "active"],
      ["isPrimary", "true"],
      ["tableData", JSON.stringify({ rId, tId, token, type: "room" })],
    ]);
  };

  return (
    <SessionContext.Provider
      value={{
        isReady,
        tableData,
        setTableData,
        sessionToken,
        customerName,
        joinStatus,
        setJoinStatus,
        isPrimary,
        cart,
        setCustomerName,
        startSession,
        clearSession,
        activateRoomSession,
        updateCart,
        clearCart,
        cartTotalQty,
        cartTotalPrice,
        menuData,
        setMenuData,
        orders,
        setOrders,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context)
    throw new Error("useSession must be used within a SessionProvider");
  return context;
};
