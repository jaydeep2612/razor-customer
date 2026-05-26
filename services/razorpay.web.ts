/**
 * razorpay.web.ts
 * Web-only shim for react-native-razorpay.
 * Loads Razorpay's official checkout.js and wraps it in the same API shape
 * as the native SDK so bills.tsx works identically on web and mobile.
 *
 * Metro bundler auto-picks .web.ts on web and .native.ts on iOS/Android.
 */

interface RazorpayOptions {
  description: string;
  image?: string;
  currency: string;
  key: string;
  amount: string | number;
  name: string;
  order_id: string;
  theme?: { color: string };
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).Razorpay) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Failed to load Razorpay checkout script."));
    document.head.appendChild(script);
  });
}

const RazorpayCheckout = {
  open: async (options: RazorpayOptions): Promise<any> => {
    await loadRazorpayScript();

    return new Promise((resolve, reject) => {
      const rzpOptions = {
        key: options.key,
        amount: String(options.amount), // Razorpay web expects a string
        currency: options.currency,
        name: options.name,
        description: options.description,
        image: options.image,
        order_id: options.order_id,
        theme: options.theme,
        prefill: options.prefill || {},
        handler: (response: any) => {
          // response contains razorpay_payment_id, razorpay_order_id, razorpay_signature
          resolve(response);
        },
        modal: {
          ondismiss: () => {
            // Match the native SDK error shape so error handling in bills.tsx works
            reject({
              code: "CANCELLED",
              description: "Payment was cancelled by the user.",
            });
          },
        },
      };

      const rzp = new (window as any).Razorpay(rzpOptions);

      rzp.on("payment.failed", (response: any) => {
        reject({
          code: response.error?.code || "PAYMENT_FAILED",
          description:
            response.error?.description || "Payment failed. Please try again.",
        });
      });

      rzp.open();
    });
  },
};

export default RazorpayCheckout;
