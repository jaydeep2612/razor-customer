import { apiCall } from "./api";

export const SessionService = {
  validateTable: async (rId: string, tId: string, token: string) => {
    return apiCall(`/qr/validate/${rId}/${tId}/${token}`);
  },

  validateRoom: async (rId: string, roomId: string, token: string) => {
    return apiCall(`/room/validate/${rId}/${roomId}/${token}`);
  },

  startSession: async (
    name: string,
    mode: "new" | "join",
    rId: string,
    tId: string,
    token: string,
  ) => {
    return apiCall(`/qr/session/start/${rId}/${tId}/${token}`, {
      method: "POST",
      body: JSON.stringify({ customer_name: name, mode }),
    });
  },

  // 👇 ADDED TYPE PARAMETER 👇
  fetchMenu: async (
    rId: string,
    tId: string,
    token: string,
    sessionToken: string,
    type: string = "table",
  ) => {
    return apiCall(
      `/menu/${rId}/${tId}/${token}?session_token=${sessionToken}&type=${type}`,
    );
  },

  // 👇 ADDED TYPE PARAMETER 👇
  checkSessionStatus: async (
    rId: string,
    tId: string,
    token: string,
    sessionToken: string,
    type: string = "table",
  ) => {
    return apiCall(
      `/menu/${rId}/${tId}/${token}?session_token=${sessionToken}&type=${type}`,
    );
  },

  // 👇 ADDED TYPE TO BODY 👇
  leaveSession: async (sessionToken: string, type: string = "table") => {
    return apiCall(`/qr/session/leave`, {
      method: "POST",
      body: JSON.stringify({ session_token: sessionToken, type }),
    });
  },

  getPendingRequests: async (tableId: string, sessionToken: string) => {
    return apiCall(
      `/table/${tableId}/pending-requests?session_token=${sessionToken}`,
    );
  },

  respondToRequest: async (
    sessionId: number,
    action: "approve" | "reject",
    sessionToken: string,
  ) => {
    return apiCall(`/session/${sessionId}/respond`, {
      method: "POST",
      body: JSON.stringify({ action, session_token: sessionToken }),
    });
  },

  // 👇 ADDED TYPE TO BODY 👇
  callWaiter: async (sessionToken: string, type: string = "table") => {
    return apiCall(`/session/call-waiter`, {
      method: "POST",
      body: JSON.stringify({ session_token: sessionToken, type }),
    });
  },

  // 👇 ADDED TYPE TO BODY 👇
  requestBill: async (sessionToken: string, type: string = "table") => {
    return apiCall(`/session/request-bill`, {
      method: "POST",
      body: JSON.stringify({ session_token: sessionToken, type }),
    });
  },

  selectPaymentMethod: async (
    sessionToken: string,
    method: "cash" | "upi" | "pending",
  ) => {
    return apiCall(`/session/select-payment-method`, {
      method: "POST",
      body: JSON.stringify({ session_token: sessionToken, method }),
    });
  },

  validateSessionToken: async (sessionToken: string) => {
    return apiCall(`/session/validate`, {
      method: "GET",
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
  },
};
