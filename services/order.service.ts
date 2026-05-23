import { apiCall } from "./api";

export const OrderService = {
  placeOrder: async (
    restaurantId: string | number,
    tableId: string | number,
    sessionToken: string,
    items: { menu_item_id: number; quantity: number; notes: string | null }[],
    orderNote: string,
    idempotencyKey: string,
    paymentMethod: string = "pending",
    type: string = "table", // 👈 Ensure this parameter is present
  ) => {
    return apiCall(`/orders`, {
      method: "POST",
      headers: {
        "X-Idempotency-Key": idempotencyKey,
        "Content-Type": "application/json",
      },
      // 👇 FIX: Pass `type` inside the JSON body here 👇
      body: JSON.stringify({
        restaurant_id: restaurantId,
        table_id: tableId, // Backend uses this as room_id if type === 'room'
        session_token: sessionToken,
        notes: orderNote || null,
        items: items,
        payment_method: paymentMethod,
        type: type, // 👈 CRITICAL: This must be sent to the Laravel Controller
      }),
    });
  },

  getOrders: async (
    sessionToken: string,
    type: string = "table", // 👈 Make sure type is here
    signal?: AbortSignal,
  ) => {
    // 👇 FIX: Pass type as query parameter here too
    return apiCall(`/orders/session/${sessionToken}?type=${type}`, {
      method: "GET",
      signal: signal,
    });
  },

  cancelOrder: async (
    sessionToken: string,
    orderId: string | number,
    type: string = "table", // 👈 Add type here too for completeness
  ) => {
    try {
      const response = await apiCall(`/orders/${orderId}/cancel`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          "Content-Type": "application/json",
        },
        // 👇 Inform backend whether we are cancelling a room or table order
        body: JSON.stringify({ type }),
      });
      return response;
    } catch (error: any) {
      throw new Error(error.message || "Failed to cancel order");
    }
  },

  notifyPaymentDone: async (
    sessionToken: string,
    orderId: string | number,
    method: string,
    type: string = "table",
  ) => {
    return apiCall(`/orders/${orderId}/notify-payment`, {
      method: "POST",
      body: JSON.stringify({
        session_token: sessionToken,
        payment_method: method,
        type: type, // 👈 Important for the backend
      }),
    });
  },
};
