import NetInfo from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

export default function useNetwork() {
  const [isOnline, setOnline] = useState<boolean>(true);

  useEffect(() => {
    NetInfo.fetch().then((state) => {
      setOnline(!!state.isConnected && !!state.isInternetReachable);
    });

    const unsubscribe = NetInfo.addEventListener((state) => {
      setOnline(!!state.isConnected && !!state.isInternetReachable);
    });

    return unsubscribe;
  }, []);

  return isOnline;
}
