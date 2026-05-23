import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { default as React, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { THEME } from "../../constants/theme";
import { useSession } from "../../context/SessionContext";
import { initEcho } from "../../services/echo";
import { SessionService } from "../../services/session.service";

const { width } = Dimensions.get("window");
const CARD_WIDTH = width > 480 ? 200 : width * 0.45;

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

const DUMMY_MENU = [
  {
    id: 1,
    name: "Truffle Burger",
    price: 22.5,
    desc: "Wagyu beef...",
    is_popular: true,
    type: "non-veg",
    image_path: "https://via.placeholder.com/150",
  },
  {
    id: 2,
    name: "Basil Pesto Pasta",
    price: 18.9,
    desc: "Handmade...",
    is_popular: false,
    type: "veg",
    image_path: "https://via.placeholder.com/150",
  },
];

const FALLBACK_CATEGORIES = [
  { id: 1, name: "Mains", items: DUMMY_MENU, is_active: true },
  { id: 2, name: "Appetizers", items: [], is_active: true },
  { id: 3, name: "Drinks", items: [], is_active: true },
  { id: 4, name: "Desserts", items: [], is_active: true },
];

export default function MenuScreen() {
  const {
    cart,
    updateCart,
    cartTotalQty,
    cartTotalPrice,
    setMenuData,
    tableData,
    joinStatus,
    sessionToken,
    menuData,
    isPrimary,
    customerName,
    clearSession,
  } = useSession();

  const isRoom = tableData?.type === "room";

  const [activeCategoryId, setActiveCategoryId] = useState<string | number>(
    "all",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [dietaryFilter, setDietaryFilter] = useState<"all" | "veg" | "non-veg">(
    "all",
  );
  const [loadingMenu, setLoadingMenu] = useState(true);

  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [activeGuests, setActiveGuests] = useState<any[]>([]);
  const [showRequestsModal, setShowRequestsModal] = useState(false);
  const echoRef = useRef<any>(null);
  const processedEventsRef = useRef<Set<string>>(new Set());

  const currentSessionId =
    menuData?.session?.id ||
    menuData?.session?.session_id ||
    menuData?.session_id ||
    tableData?.tId;

  useEffect(() => {
    const loadMenu = async () => {
      if (!tableData || !sessionToken) return;
      try {
        setLoadingMenu(true);
        const data = await SessionService.fetchMenu(
          tableData.rId,
          tableData.tId,
          tableData.token,
          sessionToken,
          tableData.type,
        );
        if (data && data.categories) {
          setMenuData(data);
        } else {
          setMenuData({ categories: FALLBACK_CATEGORIES });
        }
      } catch (e: any) {
        if (e.status === 401 || e.status === 403 || e.status === 404) {
          await clearSession();
          const errorMsg = `Session Expired. Please scan the ${isRoom ? "room" : "table"} QR code again.`;
          if (Platform.OS === "web") {
            window.alert(errorMsg);
          } else {
            Alert.alert("Session Expired", errorMsg);
          }
          router.replace("/");
          return;
        }
        setMenuData({ categories: FALLBACK_CATEGORIES });
      } finally {
        setLoadingMenu(false);
      }
    };
    loadMenu();
  }, [tableData, sessionToken, isRoom]);

  useEffect(() => {
    let isMounted = true;
    const setupHostListener = async () => {
      if (!tableData?.tId || !sessionToken || !isPrimary || !currentSessionId)
        return;
      try {
        const res = await SessionService.getPendingRequests(
          tableData.tId,
          sessionToken,
        );
        if (isMounted) {
          setPendingRequests(res.pending || []);
          setActiveGuests(res.guests || []);
          if (res.pending && res.pending.length > 0) {
            setShowRequestsModal(true);
          }
        }
      } catch (e) {}

      if (!echoRef.current) echoRef.current = initEcho(sessionToken);
      const channel = echoRef.current.private(`session.${currentSessionId}`);

      channel.listen(".GuestJoinRequested", (event: any) => {
        if (!isMounted) return;
        if (event.event_id) {
          if (processedEventsRef.current.has(event.event_id)) return;
          processedEventsRef.current.add(event.event_id);
        }
        if (event.guest) {
          setPendingRequests((prev: any[]) => {
            if (prev.some((g: any) => g.id === event.guest.id)) return prev;
            return [...prev, event.guest];
          });
          setShowRequestsModal(true);
        }
      });
      channel.listen(".SessionEnded", async () => {
        if (!isMounted) return;
        Alert.alert(
          "Thank You!",
          `Your ${isRoom ? "room" : "table"} session has been closed. We hope to see you again soon!`,
        );
        await clearSession();
        router.replace("/");
      });
    };
    setupHostListener();
    return () => {
      isMounted = false;
      if (echoRef.current && currentSessionId) {
        if (echoRef.current.connector?.pusher?.connection) {
          echoRef.current.connector.pusher.connection.unbind_all();
        }
        echoRef.current.leave(`session.${currentSessionId}`);
      }
    };
  }, [isPrimary, tableData?.tId, sessionToken, currentSessionId, isRoom]);

  const handleRequestResponse = async (
    id: number,
    action: "approve" | "reject",
  ) => {
    if (!sessionToken) return;
    const guestToMove = pendingRequests.find((r) => r.id === id);
    try {
      await SessionService.respondToRequest(id, action, sessionToken);
      setPendingRequests((prev) => {
        const updated = prev.filter((r) => r.id !== id);
        if (updated.length === 0) setShowRequestsModal(false);
        return updated;
      });
      if (action === "approve" && guestToMove)
        setActiveGuests((prev) => [...prev, guestToMove]);
    } catch (e) {
      Alert.alert("Error", "Could not process the request. Please try again.");
    }
  };

  const handleLeaveTable = () => {
    const msg = `Are you sure you want to disconnect from this ${isRoom ? "room" : "table"}?`;
    if (Platform.OS === "web") {
      if (window.confirm(msg)) clearSession().then(() => router.replace("/"));
      return;
    }
    Alert.alert(
      `Leave ${isRoom ? "Room" : "Table"}?`,
      `${msg} Your cart and session will be cleared.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: async () => {
            await clearSession();
            router.replace("/");
          },
        },
      ],
    );
  };

  const handleCallWaiter = () => {
    if (!sessionToken) return;
    Alert.alert("Call Waiter", "Do you need a waiter at your table?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Yes",
        onPress: async () => {
          try {
            await SessionService.callWaiter(sessionToken);
            Alert.alert("Success", "A waiter has been notified.");
          } catch (error) {
            Alert.alert("Error", "Could not notify the waiter at this time.");
          }
        },
      },
    ]);
  };

  const categories = menuData?.categories || FALLBACK_CATEGORIES;

  const hasNonVegItems = useMemo(() => {
    return categories.some((cat: any) => {
      if (!cat.items) return false;
      return cat.items.some((item: any) => {
        const type = item.type
          ? String(item.type).toLowerCase()
          : item.is_veg === false
            ? "non-veg"
            : "veg";
        return type === "non-veg";
      });
    });
  }, [categories]);

  const processedCategories = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return categories
      .map((cat: any) => {
        if (cat.is_active === false || cat.is_active === 0) return null;
        const filteredItems = (cat.items || []).filter((item: any) => {
          if (item.is_available === false || item.is_available === 0)
            return false;
          const safeType = item.type
            ? String(item.type).toLowerCase()
            : item.is_veg === false
              ? "non-veg"
              : "veg";
          if (dietaryFilter !== "all" && safeType !== dietaryFilter)
            return false;
          if (query) {
            const matchName = item.name?.toLowerCase().includes(query);
            const matchDesc =
              item.description?.toLowerCase().includes(query) ||
              item.desc?.toLowerCase().includes(query);
            if (!matchName && !matchDesc) return false;
          }
          return true;
        });
        filteredItems.sort(
          (a: any, b: any) =>
            (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0),
        );
        return { ...cat, items: filteredItems };
      })
      .filter((cat: any) => cat && cat.items.length > 0);
  }, [categories, searchQuery, dietaryFilter]);

  const isApproved = joinStatus === "active" || joinStatus === "approved";
  const isOrderingLocked = !isApproved;
  const restaurantName = menuData?.restaurant?.name || "Loading...";
  const restaurantLogo = menuData?.restaurant?.logo;
  const tableNumber = menuData?.table?.number || tableData?.tId || "?";
  const tableCapacity = menuData?.table?.capacity || "-";
  const displayHostName = isPrimary
    ? customerName
    : menuData?.session?.host_name || "Host";

  const currentCatIndex = processedCategories.findIndex(
    (c: any) => c.id === activeCategoryId,
  );
  const nextCategory =
    currentCatIndex !== -1 && currentCatIndex < processedCategories.length - 1
      ? processedCategories[currentCatIndex + 1]
      : null;

  const renderMenuItemCard = (item: any, isGrid: boolean = false) => {
    const currentQty = cart[item.id]?.qty || 0;
    const itemPrice = parseFloat(item.price) || 0;
    const safeType = item.type
      ? String(item.type).toLowerCase()
      : item.is_veg === false
        ? "non-veg"
        : "veg";

    return (
      <View
        key={`item-${item.id}`}
        style={[
          styles.sliderCard,
          isGrid && styles.gridCard,
          isOrderingLocked && { opacity: 0.6 },
        ]}
      >
        <View style={styles.sliderImageContainer}>
          <Image
            source={{
              uri:
                item.image ||
                item.image_path ||
                "https://via.placeholder.com/150",
            }}
            style={styles.sliderImage}
          />
          {item.is_popular && (
            <View style={styles.sliderBadge}>
              <Text style={styles.sliderBadgeText}>POPULAR</Text>
            </View>
          )}
        </View>

        <View style={styles.sliderContent}>
          <View>
            <View style={styles.sliderTitleRow}>
              <Text style={styles.sliderItemName} numberOfLines={1}>
                {item.name}
              </Text>
              {safeType === "veg" ? (
                <View style={styles.vegDotSmall} />
              ) : (
                <View style={styles.nonVegTriangleSmall} />
              )}
            </View>
            <Text style={styles.sliderItemDesc} numberOfLines={2}>
              {item.description || item.desc}
            </Text>
          </View>

          <View style={styles.sliderFooter}>
            <Text style={styles.sliderPrice}>₹{itemPrice.toFixed(2)}</Text>
            {!isOrderingLocked &&
              (currentQty > 0 ? (
                <View style={styles.sliderQtyControls}>
                  <TouchableOpacity
                    onPress={() =>
                      updateCart(item.id, -1, itemPrice, item.name)
                    }
                    style={styles.sliderQtyBtn}
                  >
                    <MaterialIcons
                      name="remove"
                      size={16}
                      color={ANN.darkBlue}
                    />
                  </TouchableOpacity>
                  <Text style={styles.sliderQtyText}>{currentQty}</Text>
                  <TouchableOpacity
                    onPress={() => updateCart(item.id, 1, itemPrice, item.name)}
                    style={styles.sliderQtyBtn}
                  >
                    <MaterialIcons name="add" size={16} color={ANN.darkBlue} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.sliderAddBtn}
                  onPress={() => updateCart(item.id, 1, itemPrice, item.name)}
                >
                  <MaterialIcons name="add" size={20} color="#FFF" />
                </TouchableOpacity>
              ))}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.mainWrapper}>
      <Image
        source={require("../../assets/images/bg.png")}
        style={styles.bgImage}
      />
      <View style={styles.bgOverlay} />

      <SafeAreaView style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconBtn} onPress={handleLeaveTable}>
            <MaterialIcons name="exit-to-app" size={26} color={THEME.danger} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginBottom: 2,
              }}
            >
              {restaurantLogo ? (
                <Image
                  source={{ uri: restaurantLogo }}
                  style={styles.headerLogo}
                />
              ) : (
                <MaterialIcons
                  name="restaurant"
                  size={16}
                  color={ANN.orange}
                  style={{ marginRight: 6 }}
                />
              )}
              <Text style={styles.topBarTitle}>
                {isRoom ? "Room" : "Table"} {tableNumber} • {restaurantName}
              </Text>
            </View>

            <View style={styles.tableSubInfo}>
              <MaterialIcons
                name="groups"
                size={12}
                color={THEME.textSecondary}
              />
              <Text style={styles.tableSubInfoText}>Cap: {tableCapacity}</Text>
              <Text style={styles.tableSubInfoDot}>•</Text>
              <MaterialIcons name="stars" size={12} color={ANN.orange} />
              <Text style={styles.tableSubInfoText}>
                Host: {displayHostName}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <TouchableOpacity style={styles.bellBtn} onPress={handleCallWaiter}>
              <MaterialIcons
                name="notifications-active"
                size={24}
                color={ANN.orange}
              />
            </TouchableOpacity>

            {isPrimary ? (
              <TouchableOpacity
                style={[
                  styles.hostBadge,
                  pendingRequests.length > 0 && {
                    backgroundColor: THEME.danger,
                  },
                ]}
                onPress={() => setShowRequestsModal(true)}
              >
                <MaterialIcons name="people" size={16} color="#FFF" />
                <Text style={styles.hostBadgeText}>
                  {activeGuests.length + pendingRequests.length}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.iconBtn}>
                <MaterialIcons
                  name="info-outline"
                  size={24}
                  color={THEME.textPrimary}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {loadingMenu ? (
          <View
            style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
          >
            <ActivityIndicator size="large" color={ANN.orange} />
            <Text style={{ marginTop: 12, color: THEME.textSecondary }}>
              Loading Menu...
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View
              style={[styles.banner, isOrderingLocked && styles.bannerLocked]}
            >
              <View>
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <MaterialIcons
                    name={isApproved ? "lock-open" : "lock"}
                    size={16}
                    color={isApproved ? THEME.success : ANN.orange}
                  />
                  <Text
                    style={[
                      styles.bannerTitle,
                      { color: isApproved ? THEME.success : ANN.orange },
                    ]}
                  >
                    {isApproved ? "Ready to Order" : "Awaiting Approval"}
                  </Text>
                </View>
                <Text style={styles.bannerSub}>
                  {isApproved
                    ? "Tap an item below to add it to your cart."
                    : "Ordering is locked until host approves your table."}
                </Text>
              </View>
            </View>

            <View style={styles.searchContainer}>
              <MaterialIcons
                name="search"
                size={20}
                color={THEME.textSecondary}
                style={{ marginRight: 8 }}
              />
              <TextInput
                style={styles.searchInput}
                placeholder="Search for dishes..."
                placeholderTextColor="#94A3B8"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery("")}>
                  <MaterialIcons
                    name="close"
                    size={20}
                    color={THEME.textSecondary}
                  />
                </TouchableOpacity>
              )}
            </View>

            {hasNonVegItems && (
              <View style={styles.dietaryFilterContainer}>
                <TouchableOpacity
                  style={[
                    styles.dietFilterBtn,
                    dietaryFilter === "all" && styles.dietFilterBtnActive,
                  ]}
                  onPress={() => setDietaryFilter("all")}
                >
                  <Text
                    style={[
                      styles.dietFilterText,
                      dietaryFilter === "all" && styles.dietFilterTextActive,
                    ]}
                  >
                    All Items
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.dietFilterBtn,
                    dietaryFilter === "veg" && styles.dietFilterBtnActiveVeg,
                  ]}
                  onPress={() => setDietaryFilter("veg")}
                >
                  <View style={styles.vegDot} />
                  <Text
                    style={[
                      styles.dietFilterText,
                      dietaryFilter === "veg" && styles.dietFilterTextActiveVeg,
                    ]}
                  >
                    Veg Only
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.dietFilterBtn,
                    dietaryFilter === "non-veg" &&
                      styles.dietFilterBtnActiveNonVeg,
                  ]}
                  onPress={() => setDietaryFilter("non-veg")}
                >
                  <View style={styles.nonVegTriangle} />
                  <Text
                    style={[
                      styles.dietFilterText,
                      dietaryFilter === "non-veg" &&
                        styles.dietFilterTextActiveNonVeg,
                    ]}
                  >
                    Non-Veg
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {searchQuery.trim().length === 0 && (
              <View style={styles.categorySliderContainer}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.categorySliderContent}
                >
                  <TouchableOpacity
                    style={[
                      styles.catPill,
                      activeCategoryId === "all" && styles.catPillActive,
                    ]}
                    onPress={() => setActiveCategoryId("all")}
                  >
                    <Text
                      style={[
                        styles.catPillText,
                        activeCategoryId === "all" && styles.catPillTextActive,
                      ]}
                    >
                      All Categories
                    </Text>
                  </TouchableOpacity>

                  {categories.map((cat: any) => {
                    if (cat.is_active === false || cat.is_active === 0)
                      return null;
                    const isActive = activeCategoryId === cat.id;
                    return (
                      <TouchableOpacity
                        key={`cat-pill-${cat.id}`}
                        style={[
                          styles.catPill,
                          isActive && styles.catPillActive,
                        ]}
                        onPress={() => setActiveCategoryId(cat.id)}
                      >
                        <Text
                          style={[
                            styles.catPillText,
                            isActive && styles.catPillTextActive,
                          ]}
                        >
                          {cat.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            <View style={styles.menuSection}>
              {processedCategories.length === 0 ? (
                <Text style={styles.emptySearchText}>
                  No items match your criteria.
                </Text>
              ) : activeCategoryId === "all" ? (
                processedCategories.map((cat: any) => (
                  <View
                    key={`section-${cat.id}`}
                    style={styles.categorySectionBlock}
                  >
                    <View style={styles.categorySectionHeader}>
                      <Text style={styles.categorySectionTitle}>
                        {cat.name}
                      </Text>
                      <MaterialIcons
                        name="arrow-forward"
                        size={18}
                        color={THEME.textSecondary}
                      />
                    </View>

                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.sliderContentContainer}
                      snapToInterval={CARD_WIDTH + 16}
                      decelerationRate="fast"
                    >
                      {cat.items.map((item: any) =>
                        renderMenuItemCard(item, false),
                      )}

                      <TouchableOpacity
                        style={styles.viewMoreCard}
                        onPress={() => setActiveCategoryId(cat.id)}
                      >
                        <View style={styles.viewMoreIconCircle}>
                          <MaterialIcons
                            name="arrow-forward"
                            size={24}
                            color={ANN.darkBlue}
                          />
                        </View>
                        <Text style={styles.viewMoreText}>View All</Text>
                        <Text style={styles.viewMoreSubText}>{cat.name}</Text>
                      </TouchableOpacity>
                    </ScrollView>
                  </View>
                ))
              ) : (
                processedCategories
                  .filter((c: any) => c.id === activeCategoryId)
                  .map((cat: any) => (
                    <View
                      key={`section-${cat.id}`}
                      style={styles.categorySectionBlock}
                    >
                      <View style={styles.categorySectionHeader}>
                        <Text style={styles.categorySectionTitle}>
                          {cat.name}
                        </Text>
                      </View>

                      <View style={styles.gridContentContainer}>
                        {cat.items.map((item: any) =>
                          renderMenuItemCard(item, true),
                        )}
                      </View>

                      {nextCategory && (
                        <TouchableOpacity
                          style={styles.nextCategoryBtn}
                          onPress={() => setActiveCategoryId(nextCategory.id)}
                        >
                          <Text style={styles.nextCategoryBtnText}>
                            Next: {nextCategory.name}
                          </Text>
                          <MaterialIcons
                            name="arrow-forward"
                            size={20}
                            color={ANN.blue}
                          />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))
              )}
            </View>
          </ScrollView>
        )}

        {cartTotalQty > 0 && !isOrderingLocked && (
          <View style={styles.cartBar}>
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/cart")}
              style={styles.cartButton}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
              >
                <View style={styles.cartIconWrapper}>
                  <MaterialIcons
                    name="shopping-basket"
                    size={20}
                    color={ANN.orange}
                  />
                </View>
                <View>
                  <Text style={styles.cartQty}>{cartTotalQty} items</Text>
                  <Text style={styles.cartTotal}>
                    ₹{cartTotalPrice.toFixed(2)}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={styles.viewCartText}>View Cart</Text>
                <MaterialIcons name="chevron-right" size={24} color="#FFF" />
              </View>
            </TouchableOpacity>
          </View>
        )}

        <Modal visible={showRequestsModal} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Table Management</Text>
                <TouchableOpacity onPress={() => setShowRequestsModal(false)}>
                  <MaterialIcons
                    name="cancel"
                    size={28}
                    color={THEME.textSecondary}
                  />
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.sectionHeader}>Join Requests</Text>
                {pendingRequests.length === 0 ? (
                  <Text style={styles.emptyText}>No pending requests.</Text>
                ) : (
                  pendingRequests.map((r) => (
                    <View key={r.id} style={styles.requestRow}>
                      <View
                        style={{ flexDirection: "row", alignItems: "center" }}
                      >
                        <MaterialIcons
                          name="person-add"
                          size={20}
                          color={ANN.orange}
                          style={{ marginRight: 8 }}
                        />
                        <Text style={styles.requestName}>
                          {r.customer_name}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <TouchableOpacity
                          onPress={() => handleRequestResponse(r.id, "reject")}
                          style={[
                            styles.actionBtn,
                            { backgroundColor: THEME.danger + "20" },
                          ]}
                        >
                          <MaterialIcons
                            name="close"
                            color={THEME.danger}
                            size={20}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleRequestResponse(r.id, "approve")}
                          style={[
                            styles.actionBtn,
                            { backgroundColor: THEME.success + "20" },
                          ]}
                        >
                          <MaterialIcons
                            name="check"
                            color={THEME.success}
                            size={20}
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}

                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: 24,
                    marginBottom: 12,
                  }}
                >
                  <Text style={[styles.sectionHeader, { marginBottom: 0 }]}>
                    Active Guests
                  </Text>
                  <View
                    style={{
                      backgroundColor: THEME.border,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 12,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: "bold",
                        color: THEME.textSecondary,
                      }}
                    >
                      {activeGuests.length + 1} / {tableCapacity} Seats
                    </Text>
                  </View>
                </View>

                {activeGuests.length === 0 ? (
                  <Text style={styles.emptyText}>
                    No guests have joined yet.
                  </Text>
                ) : (
                  activeGuests.map((g) => (
                    <View key={g.id} style={styles.requestRow}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <View
                          style={{
                            backgroundColor: THEME.successLight,
                            padding: 6,
                            borderRadius: 20,
                          }}
                        >
                          <MaterialIcons
                            name="person"
                            size={16}
                            color={THEME.success}
                          />
                        </View>
                        <Text style={styles.requestName}>
                          {g.customer_name}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
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
    backgroundColor: "rgba(255, 255, 255, 0.85)",
  },
  container: { flex: 1, maxWidth: 480, width: "100%", alignSelf: "center" },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  headerLogo: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginRight: 6,
    backgroundColor: THEME.border,
  },
  tableSubInfo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  tableSubInfoText: {
    fontSize: 11,
    fontWeight: "600",
    color: THEME.textSecondary,
  },
  tableSubInfoDot: {
    fontSize: 10,
    color: THEME.textSecondary,
    marginHorizontal: 2,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: "rgba(255, 255, 255, 0.6)",
    borderBottomWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
  },
  iconBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 20,
  },
  bellBtn: { backgroundColor: ANN.orangeLight, padding: 6, borderRadius: 20 },
  topBarTitle: { fontSize: 16, fontWeight: "bold", color: THEME.textPrimary },
  hostBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: ANN.darkBlue,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  hostBadgeText: { color: "#FFF", fontWeight: "bold", fontSize: 14 },
  scrollContent: { paddingBottom: 100 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(220, 252, 231, 0.8)",
    borderWidth: 1,
    borderColor: "rgba(76, 175, 80, 0.3)",
    padding: 16,
    marginHorizontal: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  bannerLocked: {
    backgroundColor: "rgba(255, 244, 236, 0.8)",
    borderColor: "rgba(254, 154, 84, 0.4)",
  },
  bannerTitle: { fontSize: 14, fontWeight: "bold" },
  bannerSub: { fontSize: 12, color: THEME.textSecondary, marginTop: 4 },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.7)",
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    height: 44,
    borderWidth: 1,
    borderColor: "rgba(42, 71, 149, 0.2)",
  },
  searchInput: {
    flex: 1,
    height: "100%",
    color: THEME.textPrimary,
    fontSize: 15,
  },
  emptySearchText: {
    color: THEME.textSecondary,
    fontStyle: "italic",
    marginTop: 8,
    fontSize: 15,
    marginBottom: 20,
    paddingHorizontal: 16,
  },
  dietaryFilterContainer: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 16,
    gap: 8,
  },
  dietFilterBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(42, 71, 149, 0.2)",
    backgroundColor: "rgba(255, 255, 255, 0.6)",
  },
  dietFilterBtnActive: {
    backgroundColor: ANN.darkBlue,
    borderColor: ANN.darkBlue,
  },
  dietFilterBtnActiveVeg: {
    backgroundColor: "#ecfdf5",
    borderColor: "#10b981",
  },
  dietFilterBtnActiveNonVeg: {
    backgroundColor: "#fef2f2",
    borderColor: "#ef4444",
  },
  dietFilterText: {
    fontSize: 12,
    fontWeight: "700",
    color: THEME.textSecondary,
  },
  dietFilterTextActive: { color: "#FFF" },
  dietFilterTextActiveVeg: { color: "#047857" },
  dietFilterTextActiveNonVeg: { color: "#b91c1c" },
  categorySliderContainer: { marginBottom: 16 },
  categorySliderContent: { paddingHorizontal: 16, gap: 10 },
  catPill: {
    backgroundColor: "rgba(238, 242, 251, 0.8)",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(42, 71, 149, 0.2)",
  },
  catPillActive: { backgroundColor: ANN.orange, borderColor: ANN.orange },
  catPillText: { fontSize: 14, fontWeight: "700", color: ANN.darkBlue },
  catPillTextActive: { color: "#ffffff" },
  menuSection: { paddingBottom: 20 },
  categorySectionBlock: { marginBottom: 24 },
  categorySectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  categorySectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: THEME.textPrimary,
  },
  sliderContentContainer: { paddingHorizontal: 16, gap: 16 },
  gridContentContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  gridCard: { width: "48%", marginBottom: 16 },
  sliderCard: {
    width: CARD_WIDTH,
    backgroundColor: "rgba(255, 255, 255, 0.75)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(42, 71, 149, 0.15)",
    overflow: "hidden",
    ...Platform.select({
      web: { boxShadow: "0px 4px 12px rgba(0,0,0,0.06)" } as any,
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
        elevation: 3,
      },
    }),
  },
  sliderImageContainer: {
    width: "100%",
    height: 130,
    position: "relative",
    backgroundColor: "rgba(0,0,0,0.03)",
  },
  sliderImage: { width: "100%", height: "100%", resizeMode: "cover" },
  sliderBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: "rgba(255,255,255,0.9)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  sliderBadgeText: {
    fontSize: 9,
    fontWeight: "900",
    color: ANN.darkBlue,
    letterSpacing: 0.5,
  },
  sliderContent: { padding: 12, flex: 1, justifyContent: "space-between" },
  sliderTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  sliderItemName: {
    fontSize: 15,
    fontWeight: "bold",
    color: ANN.darkBlue,
    flex: 1,
    marginRight: 6,
  },
  sliderItemDesc: {
    fontSize: 11,
    color: THEME.textSecondary,
    lineHeight: 16,
    marginBottom: 8,
  },
  sliderFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  sliderPrice: { fontSize: 16, fontWeight: "900", color: ANN.red },
  sliderAddBtn: {
    backgroundColor: ANN.orange,
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  sliderQtyControls: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: ANN.orange,
    height: 32,
    overflow: "hidden",
  },
  sliderQtyBtn: {
    width: 28,
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: ANN.orangeLight,
  },
  sliderQtyText: {
    fontWeight: "bold",
    fontSize: 14,
    color: ANN.darkBlue,
    width: 20,
    textAlign: "center",
  },
  viewMoreCard: {
    width: CARD_WIDTH * 0.6,
    backgroundColor: "rgba(238, 242, 251, 0.8)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(42, 71, 149, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    marginLeft: 4,
  },
  viewMoreIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.8)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(42, 71, 149, 0.15)",
  },
  viewMoreText: {
    fontSize: 14,
    fontWeight: "bold",
    color: ANN.darkBlue,
    textAlign: "center",
  },
  viewMoreSubText: {
    fontSize: 11,
    color: THEME.textSecondary,
    textAlign: "center",
    marginTop: 4,
  },
  nextCategoryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ANN.blueLight,
    padding: 14,
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 24,
    gap: 8,
    borderWidth: 1,
    borderColor: ANN.blue + "40",
  },
  nextCategoryBtnText: { color: ANN.blue, fontWeight: "bold", fontSize: 16 },
  vegDotSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#10b981",
    marginTop: 4,
  },
  nonVegTriangleSmall: {
    width: 0,
    height: 0,
    backgroundColor: "transparent",
    borderStyle: "solid",
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderBottomWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#ef4444",
    marginTop: 4,
  },
  vegDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#10b981" },
  nonVegTriangle: {
    width: 0,
    height: 0,
    backgroundColor: "transparent",
    borderStyle: "solid",
    borderLeftWidth: 3,
    borderRightWidth: 3,
    borderBottomWidth: 6,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#ef4444",
  },
  cartBar: { position: "absolute", bottom: 16, left: 16, right: 16 },
  cartButton: {
    backgroundColor: "rgba(42, 71, 149, 0.95)",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    ...Platform.select({
      web: { boxShadow: "0px 4px 12px rgba(42, 71, 149, 0.35)" } as any,
      default: {
        shadowColor: ANN.darkBlue,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
        elevation: 5,
      },
    }),
  },
  cartIconWrapper: {
    width: 36,
    height: 36,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  cartQty: { color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: "600" },
  cartTotal: { color: "#FFF", fontSize: 18, fontWeight: "bold" },
  viewCartText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
    marginRight: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(28,28,30,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "white",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderColor: THEME.border,
  },
  modalTitle: { fontSize: 20, fontWeight: "bold", color: THEME.textPrimary },
  sectionHeader: {
    fontSize: 13,
    fontWeight: "bold",
    color: THEME.textSecondary,
    textTransform: "uppercase",
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  emptyText: {
    color: THEME.textSecondary,
    fontStyle: "italic",
    paddingVertical: 10,
  },
  requestRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: THEME.border,
  },
  requestName: { fontSize: 16, fontWeight: "600", color: THEME.textPrimary },
  actionBtn: { padding: 8, borderRadius: 8 },
});
