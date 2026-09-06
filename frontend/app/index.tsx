import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Lang, tr, USER_NAME, USER_FIRST, USER_INITIAL } from "@/src/i18n";
import { ThemeProvider, useAppTheme } from "@/src/theme";
import {
  ble,
  ConnectedInfo,
  GESTURE_MAP,
  GestureCode,
  ScannedDevice,
} from "@/src/utils/ble";
import { storage } from "@/src/utils/storage";

const API = `${process.env.EXPO_PUBLIC_BACKEND_URL ?? ""}/api`;

type Tab = "health" | "goals" | "device" | "settings";

type AppStateMode = "DISCONNECTED" | "IDLE" | "TRACKING";

type SavedTrackingSession = {
  id: string;
  steps: number;
  duration: number; // sec
  distance_km: number;
  calories_kcal: number;
  start_time: string;
  end_time: string;
  source: string;
};

const K = {
  lang: "sasha:lang",
  notifs: "sasha:notifs",
  stepGoal: "sasha:stepGoal",
  activeGoal: "sasha:activeGoal",
  calGoal: "sasha:calGoal",
  sessions: "sasha:sessions",
  lastBleDevice: "sasha:lastBleDevice",
  autoConnectEnabled: "sasha:autoConnectEnabled",
};

const Icon = ({
  name,
  size = 22,
  color,
}: {
  name: string;
  size?: number;
  color?: string;
}) => <MaterialCommunityIcons name={name as never} size={size} color={color} />;

const clockNow = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
};

// ---------- Root ----------
export default function Index() {
  return (
    <ThemeProvider>
      <IndexInner />
    </ThemeProvider>
  );
}

function IndexInner() {
  const { C, styles, theme, setTheme } = useAppTheme();
  const [tab, setTab] = useState<Tab>("health");
  const [lang, setLangState] = useState<Lang>("id");

  // Device & Application States
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [battery, setBattery] = useState(86);
  const [rssi] = useState(-54);
  const [bpm, setBpm] = useState(0);
  const [hrCountdown, setHrCountdown] = useState(30);

  // Tracking State
  const [tracking, setTracking] = useState(false);
  const [steps, setSteps] = useState(0);
  const [sessionSteps, setSessionSteps] = useState(0);
  const [trackDuration, setTrackDuration] = useState(0);
  const sessionStartIsoRef = useRef<string | null>(null);
  const [savedSessions, setSavedSessions] = useState<SavedTrackingSession[]>([]);

  // Real BLE state
  const [, setRealBleInfo] = useState<ConnectedInfo | null>(null);
  const [realBpm, setRealBpm] = useState<number | null>(null);

  // Auto-Connect & Remembered BLE Device State
  const [lastBleDevice, setLastBleDevice] = useState<{ id: string; name: string | null } | null>(null);
  const [autoConnectEnabled, setAutoConnectEnabled] = useState(true);

  // Gesture Event Log
  const [lastGesture, setLastGesture] = useState<{
    code: number;
    name: string;
    time: string;
    action: string;
  } | null>(null);

  // Prefs
  const [notifs, setNotifs] = useState(true);
  const [stepGoal, setStepGoal] = useState(10000);
  const [activeGoal, setActiveGoal] = useState(30);
  const [calGoal, setCalGoal] = useState(500);
  const [editOpen, setEditOpen] = useState(false);

  // UI
  const [toast, setToast] = useState<string | null>(null);
  const holdProgress = useRef(new Animated.Value(0)).current;
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const t = useCallback((k: string) => tr(lang, k), [lang]);

  const appState: AppStateMode = useMemo(() => {
    if (!connected) return "DISCONNECTED";
    if (tracking) return "TRACKING";
    return "IDLE";
  }, [connected, tracking]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  // Load persisted prefs on mount
  useEffect(() => {
    (async () => {
      try {
        const savedLang = (await storage.getItem<string>(K.lang, "id")) as Lang | null;
        if (savedLang === "en" || savedLang === "id") setLangState(savedLang);
        const n = await storage.getItem<boolean>(K.notifs, true);
        if (typeof n === "boolean") setNotifs(n);
        const sg = await storage.getItem<number>(K.stepGoal, 10000);
        if (typeof sg === "number") setStepGoal(sg);
        const ag = await storage.getItem<number>(K.activeGoal, 30);
        if (typeof ag === "number") setActiveGoal(ag);
        const cg = await storage.getItem<number>(K.calGoal, 500);
        if (typeof cg === "number") setCalGoal(cg);

        const sess = await storage.getItem<SavedTrackingSession[]>(K.sessions, []);
        if (Array.isArray(sess)) setSavedSessions(sess);

        const savedLastDev = await storage.getItem<{ id: string; name: string | null } | null>(
          K.lastBleDevice,
          null
        );
        if (savedLastDev && typeof savedLastDev === "object" && savedLastDev.id) {
          setLastBleDevice(savedLastDev);
        }

        const savedAutoConn = await storage.getItem<boolean>(K.autoConnectEnabled, true);
        if (typeof savedAutoConn === "boolean") setAutoConnectEnabled(savedAutoConn);
      } catch (e) {
        console.warn("Error reading stored prefs:", e);
      }

      // Fetch saved sessions from MongoDB backend in background
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${API}/tracking/sessions`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.sessions) && data.sessions.length > 0) {
            setSavedSessions(data.sessions);
          }
        }
      } catch {}
    })();
  }, []);

  // HR simulation when connected
  useEffect(() => {
    if (!connected) return;
    const tick = () => {
      const base = tracking
        ? 100 + Math.floor(Math.random() * 40)
        : 62 + Math.floor(Math.random() * 30);
      setBpm(base);
      setHrCountdown(30);
    };
    tick();
    const refresh = setInterval(tick, 30000);
    const count = setInterval(
      () => setHrCountdown((c) => (c > 0 ? c - 1 : 30)),
      1000
    );
    return () => {
      clearInterval(refresh);
      clearInterval(count);
    };
  }, [connected, tracking]);

  // Steps tracking timer & count loop
  useEffect(() => {
    if (!tracking || !connected) return;
    const stepInt = setInterval(() => {
      const delta = 1 + Math.floor(Math.random() * 3);
      setSteps((s) => s + delta);
      setSessionSteps((s) => s + delta);
    }, 1000);
    const timeInt = setInterval(() => setTrackDuration((s) => s + 1), 1000);
    return () => {
      clearInterval(stepInt);
      clearInterval(timeInt);
    };
  }, [tracking, connected]);

  // ---------- Core Actions ----------
  const doConnect = useCallback(() => {
    setConnecting(true);
    setTimeout(() => {
      setConnected(true);
      setConnecting(false);
      setBpm(72);
      setBattery(86);
      showToast(tr(lang, "toast_connected"));
    }, 100);
  }, [lang, showToast]);

  const handleRealBleConnected = useCallback(
    async (info: ConnectedInfo | null) => {
      setRealBleInfo(info);
      if (info) {
        setConnected(true);
        setBpm(75);
        setBattery(92);
        const deviceData = { id: info.id, name: info.name ?? "Sasha Band ESP32" };
        setLastBleDevice(deviceData);
        await storage.setItem(K.lastBleDevice, deviceData);
        showToast(`${tr(lang, "toast_connected")} (${info.name ?? info.id})`);
      } else {
        setConnected(false);
        setRealBpm(null);
      }
    },
    [lang, showToast]
  );

  const handleForgetDevice = useCallback(async () => {
    setLastBleDevice(null);
    await storage.removeItem(K.lastBleDevice);
    showToast(lang === "id" ? "Perangkat terakhir dilupakan" : "Last paired device removed");
  }, [lang, showToast]);

  const handleToggleAutoConnect = useCallback(
    async (val: boolean) => {
      setAutoConnectEnabled(val);
      await storage.setItem(K.autoConnectEnabled, val);
      showToast(
        val
          ? lang === "id" ? "Auto-connect diaktifkan" : "Auto-connect enabled"
          : lang === "id" ? "Auto-connect dinonaktifkan" : "Auto-connect disabled"
      );
    },
    [lang, showToast]
  );

  const doDisconnect = useCallback(() => {
    setConnected(false);
    setTracking(false);
    setBpm(0);
    showToast(tr(lang, "toast_disconnected"));
  }, [lang, showToast]);

  const startHold = () => {
    holdProgress.setValue(0);
    Animated.timing(holdProgress, {
      toValue: 1,
      duration: 2000,
      useNativeDriver: false,
    }).start();
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      if (connected) doDisconnect();
      else doConnect();
    }, 2000);
  };

  const cancelHold = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    Animated.timing(holdProgress, {
      toValue: 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  // Tracking Helpers
  const startTrackingMode = useCallback(() => {
    if (!connected) {
      showToast(tr(lang, "toast_connect_first"));
      return;
    }
    setTrackDuration(0);
    setSessionSteps(0);
    sessionStartIsoRef.current = new Date().toISOString();
    setTracking(true);
    showToast(tr(lang, "toast_track_start"));
  }, [connected, lang, showToast]);

  const stopAndSaveTracking = useCallback(async () => {
    if (!tracking) return;
    setTracking(false);
    const currentDuration = trackDuration;
    const currentSteps = sessionSteps || Math.max(steps, 10);
    const currentKm = parseFloat((currentSteps * 0.00075).toFixed(2));
    const currentCal = Math.floor(currentSteps * 0.04);
    const startIso = sessionStartIsoRef.current || new Date().toISOString();
    const endIso = new Date().toISOString();

    const record: SavedTrackingSession = {
      id: String(Date.now()),
      steps: currentSteps,
      duration: currentDuration,
      distance_km: currentKm,
      calories_kcal: currentCal,
      start_time: startIso,
      end_time: endIso,
      source: "ttp223_gesture",
    };

    const updated = [record, ...savedSessions.slice(0, 20)];
    setSavedSessions(updated);
    await storage.setItem(K.sessions, updated);

    try {
      fetch(`${API}/tracking/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      }).catch(() => {});
    } catch {}

    showToast(`${tr(lang, "tracking_saved")} (${currentSteps} steps, ${currentDuration}s)`);
  }, [tracking, trackDuration, sessionSteps, steps, savedSessions, lang, showToast]);

  const discardTracking = useCallback(() => {
    setTracking(false);
    setTrackDuration(0);
    setSessionSteps(0);
    sessionStartIsoRef.current = null;
    showToast(tr(lang, "tracking_discarded"));
  }, [lang, showToast]);

  const toggleTracking = useCallback(() => {
    if (!connected) {
      showToast(tr(lang, "toast_connect_first"));
      return;
    }
    if (tracking) stopAndSaveTracking();
    else startTrackingMode();
  }, [connected, tracking, stopAndSaveTracking, startTrackingMode, lang, showToast]);

  // ---------- Gesture Event State Machine ----------
  const handleGestureEvent = useCallback(
    async (code: GestureCode, _source: "ble" | "simulated" = "ble") => {
      const name = GESTURE_MAP[code] || `CODE_${code}`;
      const time = clockNow();
      let actionDesc = "";

      if (code === 3) {
        // LONG_PRESS: stop tracking (discard) & disconnect band.
        if (tracking) discardTracking();
        doDisconnect();
        actionDesc = "Stopped tracking & Disconnected band";
      } else if (code === 2) {
        // DOUBLE_TAP: start / stop+save tracking.
        if (!connected) {
          showToast(tr(lang, "toast_connect_first"));
          actionDesc = "Ignored (Band disconnected)";
        } else if (tracking) {
          await stopAndSaveTracking();
          actionDesc = "Stopped & Saved Tracking session";
        } else {
          startTrackingMode();
          actionDesc = "Started Step Tracking mode";
        }
      } else {
        actionDesc = "Single tap received";
      }

      setLastGesture({ code, name, time, action: actionDesc });
    },
    [connected, tracking, lang, discardTracking, doDisconnect, stopAndSaveTracking, startTrackingMode, showToast]
  );

  const changeLang = async (l: Lang) => {
    setLangState(l);
    await storage.setItem(K.lang, l);
    showToast(tr(l, "toast_lang_switched"));
  };

  const toggleNotifs = async (v: boolean) => {
    setNotifs(v);
    await storage.setItem(K.notifs, v);
    showToast(v ? tr(lang, "toast_notif_on") : tr(lang, "toast_notif_off"));
  };

  // Derived Metrics
  const km = useMemo(() => (steps * 0.00075).toFixed(2), [steps]);
  const cal = useMemo(() => Math.floor(steps * 0.04), [steps]);
  const activeMin = useMemo(() => Math.floor(trackDuration / 60), [trackDuration]);
  const stepPct = Math.min(100, Math.round((steps / stepGoal) * 100));
  const activePct = Math.min(100, Math.round((activeMin / activeGoal) * 100));
  const calPct = Math.min(100, Math.round((cal / calGoal) * 100));
  const goalsPct = Math.round((stepPct + activePct + calPct) / 3);

  const weeklySteps = useMemo(() => {
    const base = [7200, 8450, 6120, 9040, 6842, 3200, 0];
    const arr = [...base];
    arr[4] = Math.max(arr[4], steps);
    return arr;
  }, [steps]);
  const weekLabels =
    lang === "id" ? ["S", "S", "R", "K", "J", "S", "M"] : ["M", "T", "W", "T", "F", "S", "S"];
  const activeDays = weeklySteps.filter((v) => v >= stepGoal * 0.6).length;
  const streak = Math.min(activeDays, 5);
  const weekTotal = weeklySteps.reduce((a, b) => a + b, 0);

  const title =
    tab === "health"
      ? t("title_today")
      : tab === "goals"
      ? t("title_goals")
      : tab === "device"
      ? t("title_device")
      : t("title_settings");

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>SASHA BAND / {t(`tab_${tab}`).toUpperCase()}</Text>
          <Text style={styles.title}>{title}</Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            testID="lang-toggle"
            onPress={() => changeLang(lang === "en" ? "id" : "en")}
            style={styles.langPill}
          >
            <Icon name="translate" size={14} color={C.text} />
            <Text style={styles.langText}>{lang.toUpperCase()}</Text>
          </Pressable>
          <View style={styles.headerStatus}>
            <View
              style={[
                styles.dot,
                {
                  backgroundColor:
                    appState === "DISCONNECTED" ? C.red : appState === "IDLE" ? C.green : C.ember,
                },
              ]}
            />
            <Text style={styles.status}>
              {appState === "DISCONNECTED" ? t("offline") : appState}
            </Text>
          </View>
        </View>
      </View>

      {/* Floating Active Tracking Banner */}
      {tracking && (
        <View style={styles.activeTrackingPill} testID="active-tracking-pill">
          <View style={styles.activeTrackingPillLeft}>
            <Icon name="run-fast" color={C.green} size={20} />
            <View>
              <Text style={styles.activeTrackingPillTitle}>{t("state_tracking")}</Text>
              <Text style={styles.activeTrackingPillSub}>
                {steps.toLocaleString()} steps · {km} km · {Math.floor(trackDuration / 60)}:
                {String(trackDuration % 60).padStart(2, "0")}
              </Text>
            </View>
          </View>
          <Pressable
            testID="stop-save-tracking-btn"
            onPress={stopAndSaveTracking}
            style={[styles.outline, { borderColor: C.green, paddingVertical: 5, paddingHorizontal: 10 }]}
          >
            <Text style={[styles.action, { color: C.green, fontSize: 11 }]}>{t("save")}</Text>
          </Pressable>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {tab === "health" && (
          <HealthScreen
            t={t}
            lang={lang}
            connected={connected}
            battery={battery}
            bpm={realBpm ?? bpm}
            hrCountdown={hrCountdown}
            steps={steps}
            stepGoal={stepGoal}
            activeMin={activeMin}
            activeGoal={activeGoal}
            cal={cal}
            calGoal={calGoal}
            goalsPct={goalsPct}
            onGoDevice={() => {
              if (!connected) doConnect();
              else setTab("device");
            }}
            onCardTap={(cardTab: Tab) => {
              if (!connected) {
                showToast(t("toast_connect_first"));
                setTab("device");
                return;
              }
              setTab(cardTab);
            }}
          />
        )}
        {tab === "goals" && (
          <GoalsScreen
            t={t}
            steps={steps}
            stepGoal={stepGoal}
            activeMin={activeMin}
            activeGoal={activeGoal}
            cal={cal}
            calGoal={calGoal}
            weeklySteps={weeklySteps}
            weekLabels={weekLabels}
            activeDays={activeDays}
            weekTotal={weekTotal}
            streak={streak}
            stepPct={stepPct}
            activePct={activePct}
            calPct={calPct}
          />
        )}
        {tab === "device" && (
          <DeviceScreen
            t={t}
            connected={connected}
            connecting={connecting}
            battery={battery}
            rssi={rssi}
            tracking={tracking}
            appState={appState}
            steps={steps}
            km={km}
            cal={cal}
            trackDuration={trackDuration}
            holdProgress={holdProgress}
            startHold={startHold}
            cancelHold={cancelHold}
            doConnect={doConnect}
            doDisconnect={doDisconnect}
            toggleTracking={toggleTracking}
            lastGesture={lastGesture}
            onGesture={handleGestureEvent}
            savedSessions={savedSessions}
            onRealBpm={setRealBpm}
            onRealConnect={handleRealBleConnected}
            lastBleDevice={lastBleDevice}
            autoConnectEnabled={autoConnectEnabled}
            onToggleAutoConnect={handleToggleAutoConnect}
            onForgetDevice={handleForgetDevice}
          />
        )}
        {tab === "settings" && (
          <SettingsScreen
            t={t}
            lang={lang}
            changeLang={changeLang}
            connected={connected}
            notifs={notifs}
            toggleNotifs={toggleNotifs}
            onEditGoals={() => setEditOpen(true)}
            theme={theme}
            setTheme={setTheme}
          />
        )}
      </ScrollView>

      {/* Bottom Tabs */}
      <BottomTabs tab={tab} setTab={setTab} t={t} />

      {/* Toast */}
      {toast && (
        <View style={[styles.toast, { pointerEvents: "none" }]} testID="toast">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* Edit goals modal */}
      <EditGoalsModal
        visible={editOpen}
        t={t}
        stepGoal={stepGoal}
        activeGoal={activeGoal}
        calGoal={calGoal}
        onClose={() => setEditOpen(false)}
        onSave={async (s: number, a: number, c: number) => {
          setStepGoal(s);
          setActiveGoal(a);
          setCalGoal(c);
          await storage.setItem(K.stepGoal, s);
          await storage.setItem(K.activeGoal, a);
          await storage.setItem(K.calGoal, c);
          setEditOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

// ---------- Bottom Tabs ----------
function BottomTabs({ tab, setTab, t }: { tab: Tab; setTab: (t: Tab) => void; t: (k: string) => string }) {
  const { C, styles } = useAppTheme();
  return (
    <View style={[styles.tabs, { paddingBottom: 14 }]}>
      {(
        [
          ["health", "heart-pulse"],
          ["goals", "chart-bar"],
          ["device", "bluetooth"],
          ["settings", "tune-variant"],
        ] as const
      ).map(([key, icon]) => (
        <Pressable testID={`tab-${key}`} key={key} onPress={() => setTab(key as Tab)} style={styles.tab}>
          <Icon name={icon} color={tab === key ? C.ember : C.muted} />
          <Text style={[styles.tabText, tab === key && { color: C.ember }]}>{t(`tab_${key}`)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ---------- Gesture Simulator Component ----------
function GestureSimulatorCard({
  t,
  onGesture,
  lastGesture,
}: {
  t: (k: string) => string;
  onGesture: (code: GestureCode, source: "simulated") => void;
  lastGesture: { code: number; name: string; time: string; action: string } | null;
}) {
  const { C, styles } = useAppTheme();

  return (
    <View style={styles.gestureSimBox} testID="gesture-simulator-card">
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name="gesture-tap" color={C.ember} size={20} />
          <Text style={styles.cardTitle}>{t("gesture_simulator")}</Text>
        </View>
        <Text style={{ fontSize: 10, color: C.muted, fontWeight: "700" }}>BLE 6E400004</Text>
      </View>
      <Text style={styles.body}>{t("gesture_simulator_sub")}</Text>

      <View style={styles.gestureBtnRow}>
        <Pressable
          testID="sim-double-tap"
          onPress={() => onGesture(2, "simulated")}
          style={[styles.gestureBtn, { borderColor: "rgba(16,185,129,0.4)" }]}
        >
          <Icon name="gesture-double-tap" color={C.green} size={18} />
          <Text style={styles.gestureBtnText}>{t("double_tap")}</Text>
          <Text style={styles.gestureBtnCode}>Code: 2 (Track)</Text>
        </Pressable>

        <Pressable
          testID="sim-long-press"
          onPress={() => onGesture(3, "simulated")}
          style={[styles.gestureBtn, { borderColor: "rgba(239,68,68,0.4)" }]}
        >
          <Icon name="gesture-tap-hold" color={C.red} size={18} />
          <Text style={styles.gestureBtnText}>{t("long_press")}</Text>
          <Text style={styles.gestureBtnCode}>Code: 3 (Off)</Text>
        </Pressable>
      </View>

      {lastGesture && (
        <View style={styles.lastGestureFeed} testID="last-gesture-feed">
          <Icon name="flash-outline" color={C.ember} size={16} />
          <Text style={styles.lastGestureText}>
            <Text style={{ color: C.text, fontWeight: "700" }}>
              {lastGesture.name} ({lastGesture.code})
            </Text>{" "}
            @{lastGesture.time} → {lastGesture.action}
          </Text>
        </View>
      )}
    </View>
  );
}

// ---------- Health Screen ----------
function HealthScreen({
  t,
  lang,
  connected,
  battery,
  bpm,
  hrCountdown,
  steps,
  stepGoal,
  activeMin,
  activeGoal,
  cal,
  calGoal,
  goalsPct,
  onGoDevice,
  onCardTap,
}: any) {
  const { C, styles } = useAppTheme();
  const zone =
    bpm === 0 ? "-" : bpm < 60 ? "LOW" : bpm < 100 ? "NORMAL" : bpm < 140 ? "ACTIVE" : "MAX";

  return (
    <>
      {/* Greeting */}
      <View style={styles.greetCard} testID="greeting-card">
        <View style={styles.greetAvatar}>
          <Text style={styles.greetAvatarTxt}>{USER_INITIAL}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.greetHi}>{t("hello")}</Text>
          <Text style={styles.greetName} testID="greeting-name">{USER_FIRST}</Text>
        </View>
        <Icon name="hand-wave" color={C.ember} size={24} />
      </View>

      <View style={styles.deviceRow}>
        <View>
          <Text style={styles.muted}>{t("device_prototype")}</Text>
          <Text style={styles.small}>
            {t("device_esp")} · {battery}% {t("battery")}
          </Text>
        </View>
        <Pressable
          testID="health-device-status"
          onPress={onGoDevice}
          style={[
            styles.connectPill,
            {
              backgroundColor: connected ? "rgba(16,185,129,.12)" : "rgba(239,68,68,.12)",
            },
          ]}
        >
          <Icon
            name={connected ? "bluetooth-connect" : "bluetooth-off"}
            color={connected ? C.green : C.red}
            size={16}
          />
          <Text style={[styles.connectText, { color: connected ? C.green : C.red }]}>
            {connected ? t("connected") : t("disconnected")}
          </Text>
        </Pressable>
      </View>

      {/* Battery bar */}
      {connected && (
        <View style={styles.batBar} testID="battery-bar">
          <Icon name="battery-high" color={C.green} size={18} />
          <View style={{ flex: 1 }}>
            <Text style={styles.batLbl}>{t("band_battery")}</Text>
            <View style={styles.batTrack}>
              <View style={[styles.batFill, { width: `${battery}%` }]} />
            </View>
          </View>
          <Text style={styles.batPct}>{battery}%</Text>
        </View>
      )}

      {/* Hero HR card */}
      <LockableCard locked={!connected} lockedLabel={t("locked")} t={t}>
        <View style={styles.cardTop}>
          <Text style={styles.label}>{t("live_hr")}</Text>
          <Icon name="heart-pulse" color={C.ember} size={24} />
        </View>
        <Text style={styles.bpm}>
          {connected ? bpm : "--"}
          <Text style={styles.unit}> {t("bpm")}</Text>
        </Text>
        <Text style={styles.muted}>
          {connected ? `${zone} · ${t("hr_refresh")}${hrCountdown}s` : t("hr_hint")}
        </Text>
        <View style={styles.wave}>
          {[12, 20, 32, 18, 38, 22, 14, 28, 17, 34, 22, 15, 30, 18, 25, 14].map((h, i) => (
            <View
              key={i}
              style={[
                styles.waveBar,
                {
                  height: connected ? h : 8,
                  backgroundColor: connected && i === 4 ? C.ember : C.raised,
                },
              ]}
            />
          ))}
        </View>
      </LockableCard>

      {/* Grid of metrics */}
      <View style={styles.grid}>
        <Pressable style={{ flex: 1 }} testID="card-steps" onPress={() => onCardTap("goals")}>
          <LockableCard locked={!connected} lockedLabel={t("locked")} t={t} small>
            <Icon name="walk" color={C.ember} />
            <Text style={styles.label}>{t("steps_today")}</Text>
            <Text style={styles.metricValue}>{connected ? steps.toLocaleString() : "--"}</Text>
            <Text style={styles.muted}>
              {connected
                ? `${Math.min(100, Math.round((steps / stepGoal) * 100))}% ${t("goal_of")} ${stepGoal.toLocaleString()}`
                : t("unlock_via_device")}
            </Text>
          </LockableCard>
        </Pressable>
        <Pressable style={{ flex: 1 }} testID="card-active" onPress={() => onCardTap("goals")}>
          <LockableCard locked={!connected} lockedLabel={t("locked")} t={t} small>
            <Icon name="timer-outline" color={C.blue} />
            <Text style={styles.label}>{t("active_time")}</Text>
            <Text style={styles.metricValue}>{connected ? `${activeMin}m` : "--"}</Text>
            <Text style={styles.muted}>
              {t("goal")} {activeGoal}m
            </Text>
          </LockableCard>
        </Pressable>
      </View>

      {/* Quick tiles: Calories + Goals */}
      <View style={styles.grid}>
        <Pressable style={{ flex: 1 }} testID="card-calories" onPress={() => onCardTap("goals")}>
          <LockableCard locked={!connected} lockedLabel={t("locked")} t={t} small>
            <Icon name="fire" color={C.red} />
            <Text style={styles.label}>{t("calories_today")}</Text>
            <Text style={styles.metricValue}>{connected ? cal : "--"}</Text>
            <Text style={styles.muted}>
              {t("goal")} {calGoal} {t("of_calories")}
            </Text>
          </LockableCard>
        </Pressable>
        <Pressable style={{ flex: 1 }} testID="card-goals" onPress={() => onCardTap("goals")}>
          <LockableCard locked={!connected} lockedLabel={t("locked")} t={t} small>
            <Icon name="target" color={C.amber} />
            <Text style={styles.label}>{t("goals_title")}</Text>
            <Text style={styles.metricValue}>{goalsPct}%</Text>
            <Text style={styles.muted}>{t("achieved")}</Text>
          </LockableCard>
        </Pressable>
      </View>

      <Section title={t("briefing")} />
      <View style={styles.insight}>
        <View style={styles.insightIcon}>
          <Icon name="lightbulb-on-outline" color={C.ember} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{lang === "id" ? "Momentum kuat" : "Strong momentum"}</Text>
          <Text style={styles.body}>
            {lang === "id"
              ? `Kamu di ${Math.min(100, Math.round((steps / stepGoal) * 100))}% dari target langkah harian.`
              : `You are at ${Math.min(100, Math.round((steps / stepGoal) * 100))}% of today's step goal.`}
          </Text>
        </View>
        <Icon name="chevron-right" color={C.muted} />
      </View>
    </>
  );
}

function LockableCard({ locked, children, lockedLabel, t, small }: any) {
  const { C, styles } = useAppTheme();
  return (
    <View style={[styles.heroCard, small && styles.metric, locked && { opacity: 0.55 }]}>
      {children}
      {locked && (
        <View style={styles.lockRow}>
          <Icon name="lock" color={C.muted} size={11} />
          <Text style={styles.lockText}>
            {lockedLabel} · {t("unlock_via_device")}
          </Text>
        </View>
      )}
    </View>
  );
}

function Section({ title, action }: { title: string; action?: string }) {
  const { styles } = useAppTheme();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && <Text style={styles.action}>{action}</Text>}
    </View>
  );
}

// ---------- Goals Screen ----------
function GoalsScreen({
  t,
  steps,
  stepGoal,
  activeMin,
  activeGoal,
  cal,
  calGoal,
  weeklySteps,
  weekLabels,
  activeDays,
  weekTotal,
  streak,
  stepPct,
  activePct,
  calPct,
}: any) {
  const { C, styles } = useAppTheme();
  const scoreVal = Math.min(100, Math.round((stepPct + activePct + calPct) / 3));
  const maxWeek = Math.max(...weeklySteps, 1);
  return (
    <>
      <LinearGradient
        colors={[C.ember, "#BE185D"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.goalBanner}
      >
        <Text style={styles.goalBannerLabel}>{t("weekly_movement_score")}</Text>
        <Text style={styles.goalScore}>
          {scoreVal}
          <Text style={[styles.unit, { color: "rgba(255,255,255,0.85)" }]}> / 100</Text>
        </Text>
        <Text style={styles.goalBannerBody}>{t("trending_above")}</Text>
      </LinearGradient>

      <Section title={t("weekly_goals")} />
      <View style={styles.weeklyCard}>
        <View style={styles.weeklyDays}>
          {weeklySteps.map((v: number, i: number) => {
            const heightPct = Math.max(6, Math.round((v / maxWeek) * 100));
            const isToday = i === 4;
            return (
              <View key={i} style={styles.dayCol}>
                <View style={styles.dayBarWrap}>
                  <View
                    style={[
                      styles.dayBar,
                      {
                        height: `${heightPct}%`,
                        backgroundColor: isToday ? C.ember : v >= stepGoal * 0.6 ? C.green : C.raised,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.dayLabel, isToday && { color: C.ember }]}>{weekLabels[i]}</Text>
              </View>
            );
          })}
        </View>
        <View style={styles.weeklyFoot}>
          <Text style={styles.weeklyFootTxt}>
            {t("active_days")}: <Text style={styles.weeklyFootV}>{activeDays}/7</Text>
          </Text>
          <Text style={styles.weeklyFootTxt}>
            {t("week_steps")}: <Text style={styles.weeklyFootV}>{weekTotal.toLocaleString()}</Text>
          </Text>
          <Text style={styles.weeklyFootTxt}>
            {t("streak")}:{" "}
            <Text style={styles.weeklyFootV}>
              {streak} {t("days")}
            </Text>
          </Text>
        </View>
      </View>

      <Section title={t("steps_this_week")} />
      <GoalProgress
        icon="walk"
        title={t("daily_step_goal")}
        pct={stepPct}
        now={steps.toLocaleString()}
        goal={stepGoal.toLocaleString()}
        unit={t("of_steps")}
        color={C.ember}
      />
      <GoalProgress
        icon="heart-pulse"
        title={t("daily_heart_zone")}
        pct={activePct}
        now={activeMin}
        goal={activeGoal}
        unit={t("of_minutes")}
        color={C.red}
      />
      <GoalProgress
        icon="fire"
        title={t("daily_calories")}
        pct={calPct}
        now={cal}
        goal={calGoal}
        unit={t("of_calories")}
        color={C.amber}
      />
    </>
  );
}

function GoalProgress({ icon, title, pct, now, goal, unit, color }: any) {
  const { styles } = useAppTheme();
  return (
    <View style={styles.goalRow}>
      <View style={styles.goalHead}>
        <Icon name={icon} color={color} />
        <Text style={[styles.cardTitle, { flex: 1 }]}>{title}</Text>
        <Text style={[styles.action, { color }]}>{pct}%</Text>
      </View>
      <View style={styles.goalBar}>
        <View style={[styles.goalFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.muted}>
        {now} / {goal} {unit}
      </Text>
    </View>
  );
}

// ---------- Device Screen ----------
function DeviceScreen({
  t,
  connected,
  connecting,
  battery,
  rssi,
  tracking,
  appState,
  steps,
  km,
  cal,
  trackDuration,
  holdProgress,
  startHold,
  cancelHold,
  doConnect,
  doDisconnect,
  toggleTracking,
  lastGesture,
  onGesture,
  savedSessions,
  onRealBpm,
  onRealConnect,
  lastBleDevice,
  autoConnectEnabled,
  onToggleAutoConnect,
  onForgetDevice,
}: any) {
  const { C, styles } = useAppTheme();
  const progressWidth = holdProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });
  const mm = String(Math.floor(trackDuration / 60)).padStart(2, "0");
  const ss = String(trackDuration % 60).padStart(2, "0");

  return (
    <>
      <View style={styles.deviceHero}>
        <View style={styles.deviceIconWrap}>
          <Icon name="watch-variant" color={connected ? C.ember : C.muted} size={54} />
          {connected && <View style={styles.devicePulse} />}
        </View>
        <Text style={styles.deviceName}>Sasha Band</Text>
        <Text style={styles.muted}>Seeed Studio XIAO ESP32-C3 · TTP223</Text>
        <View style={styles.deviceStats}>
          <View style={styles.deviceStat}>
            <Text style={styles.stat}>{t("battery_pct")}</Text>
            <Text style={styles.statVal}>{connected ? `${battery}%` : "--"}</Text>
          </View>
          <View style={styles.deviceStat}>
            <Text style={styles.stat}>{t("rssi_lbl")}</Text>
            <Text style={styles.statVal}>{connected ? `${rssi} dBm` : "--"}</Text>
          </View>
          <View style={styles.deviceStat}>
            <Text style={styles.stat}>{t("connection")}</Text>
            <Text style={[styles.statVal, { color: connected ? C.green : C.red }]}>{appState}</Text>
          </View>
        </View>
      </View>

      {/* Interactive Gesture Simulator Card */}
      <GestureSimulatorCard t={t} onGesture={onGesture} lastGesture={lastGesture} />

      {/* Hold to connect */}
      <View style={styles.holdWrap}>
        <Pressable
          testID="device-hold"
          onPressIn={startHold}
          onPressOut={cancelHold}
          style={[styles.holdBtn, connected && styles.holdBtnConnected]}
        >
          <Icon
            name={connecting ? "loading" : connected ? "check-circle-outline" : "bluetooth"}
            color={connected ? C.green : C.ember}
            size={40}
          />
          <Text style={[styles.holdBtnLabel, { color: connected ? C.green : C.ember }]}>
            {connecting ? t("connecting") : connected ? t("connected_upper") : t("idle")}
          </Text>
          <View style={styles.holdProgress}>
            <Animated.View style={[styles.holdProgressFill, { width: progressWidth }]} />
          </View>
        </Pressable>
        <Text style={styles.holdHint}>{connected ? t("hold_disconnect") : t("hold_connect")}</Text>
        <Pressable
          testID="device-reconnect"
          onPress={connected ? doDisconnect : doConnect}
          style={styles.quickBtn}
        >
          <Text style={styles.quickBtnTxt}>{connected ? t("disconnect") : t("reconnect")}</Text>
        </Pressable>
      </View>

      {/* Auto Connect & Paired Device Settings Card */}
      <View style={styles.infoBox} testID="auto-connect-card">
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
            <Icon name="sync-circle" color={C.ember} size={22} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{t("auto_connect_title")}</Text>
              <Text style={styles.muted}>{t("auto_connect_desc")}</Text>
            </View>
          </View>
          <Switch
            testID="auto-connect-switch"
            value={autoConnectEnabled}
            onValueChange={onToggleAutoConnect}
            thumbColor={autoConnectEnabled ? C.ember : Platform.OS === "android" ? "#f4f3f4" : "#ffffff"}
            trackColor={{ false: "#767577", true: "rgba(236,72,153,0.4)" }}
          />
        </View>

        {lastBleDevice && (
          <View
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: C.border,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: C.muted, fontWeight: "700" }}>{t("last_device")}</Text>
              <Text style={[styles.body, { fontWeight: "600", marginTop: 2 }]}>
                {lastBleDevice.name ?? "Sasha Band ESP32"}
              </Text>
              <Text style={[styles.muted, { fontSize: 11 }]}>{lastBleDevice.id}</Text>
            </View>
            <Pressable
              testID="forget-device-btn"
              onPress={onForgetDevice}
              style={[styles.outline, { borderColor: C.red, paddingVertical: 4, paddingHorizontal: 8 }]}
            >
              <Text style={[styles.action, { color: C.red, fontSize: 11 }]}>{t("forget_device")}</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Tracking control */}
      <Section title={t("tracking_active")} />
      <View style={styles.trackCard}>
        <Icon name="walk" color={tracking ? C.green : C.muted} size={28} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{tracking ? t("tracking_active") : t("tracking_idle")}</Text>
          <Text style={styles.body}>
            {steps.toLocaleString()} steps · {km} km · {cal} kcal · {mm}:{ss}
          </Text>
        </View>
        <Pressable
          testID="device-track-toggle"
          onPress={toggleTracking}
          style={[styles.outline, { borderColor: tracking ? C.red : C.green }]}
        >
          <Text style={[styles.action, { color: tracking ? C.red : C.green }]}>
            {tracking ? t("stop_tracking") : t("start_tracking")}
          </Text>
        </Pressable>
      </View>

      {/* Saved Tracking Sessions */}
      {savedSessions && savedSessions.length > 0 && (
        <>
          <Section title={t("recent_sessions")} />
          {savedSessions.slice(0, 5).map((s: SavedTrackingSession) => (
            <View key={s.id} style={styles.sessionCard}>
              <View>
                <Text style={styles.sessionTitle}>
                  {s.steps.toLocaleString()} steps · {s.duration}s
                </Text>
                <Text style={styles.sessionSub}>
                  {s.distance_km} km · {s.calories_kcal} kcal · {new Date(s.start_time).toLocaleTimeString()}
                </Text>
              </View>
              <View style={styles.sessionBadge}>
                <Text style={styles.sessionBadgeTxt}>{s.source}</Text>
              </View>
            </View>
          ))}
        </>
      )}

      <Section title={t("device_information")} />
      <View style={styles.infoBox}>
        <Text style={styles.muted}>{t("service_uuid")}</Text>
        <Text style={styles.body}>6E400001-B5A3-F393-E0A9-E50E24DCCA9E</Text>
        <Text style={[styles.muted, { marginTop: 14 }]}>{t("char_uuid")} (HR notify)</Text>
        <Text style={styles.body}>6E400002-B5A3-F393-E0A9-E50E24DCCA9E</Text>
        <Text style={[styles.muted, { marginTop: 14 }]}>{t("char_uuid")} (Battery read)</Text>
        <Text style={styles.body}>6E400003-B5A3-F393-E0A9-E50E24DCCA9E</Text>
        <Text style={[styles.muted, { marginTop: 14 }]}>{t("char_gesture_uuid")} (1=Single, 2=Double, 3=Long)</Text>
        <Text style={styles.body}>6E400004-B5A3-F393-E0A9-E50E24DCCA9E</Text>
        <Text style={[styles.muted, { marginTop: 14, fontSize: 11 }]}>{t("firmware_hint")}</Text>
      </View>

      <RealBLEPanel
        t={t}
        onBpmStream={onRealBpm}
        onConnectChange={onRealConnect}
        onGestureStream={(code: GestureCode) => onGesture(code, "ble")}
        autoConnectEnabled={autoConnectEnabled}
        lastBleDevice={lastBleDevice}
      />
    </>
  );
}

// ---------- Real BLE Panel ----------
function RealBLEPanel({
  t,
  onBpmStream,
  onConnectChange,
  onGestureStream,
  autoConnectEnabled,
  lastBleDevice,
}: {
  t: (k: string) => string;
  onBpmStream: (bpm: number | null) => void;
  onConnectChange: (info: ConnectedInfo | null) => void;
  onGestureStream: (gesture: GestureCode) => void;
  autoConnectEnabled: boolean;
  lastBleDevice: { id: string; name: string | null } | null;
}) {
  const { C, styles } = useAppTheme();
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [connected, setConnected] = useState<ConnectedInfo | null>(null);
  const stopRef = useRef<null | (() => void)>(null);
  const hrStopRef = useRef<null | (() => void)>(null);
  const gestureStopRef = useRef<null | (() => void)>(null);

  const autoConnectAttemptedRef = useRef(false);
  const isConnectingRef = useRef(false);
  // Mirror of `connected` so the unmount cleanup can tell whether THIS panel
  // ever established a real BLE link. Switching tabs must NOT drop the
  // simulated/demo connection when no real device was connected here.
  const connectedRef = useRef<ConnectedInfo | null>(null);
  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  useEffect(
    () => () => {
      if (stopRef.current) stopRef.current();
      if (hrStopRef.current) hrStopRef.current();
      if (gestureStopRef.current) gestureStopRef.current();
      // Only tear down shared state when a real BLE connection existed here.
      if (connectedRef.current) {
        ble.disconnect(connectedRef.current.id).catch(() => {});
        onBpmStream(null);
        onConnectChange(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const handleConnect = async (d: ScannedDevice) => {
    if (busyId || isConnectingRef.current) return;
    if (connected?.id === d.id) {
      setBusyId(d.id);
      try {
        if (hrStopRef.current) {
          hrStopRef.current();
          hrStopRef.current = null;
        }
        if (gestureStopRef.current) {
          gestureStopRef.current();
          gestureStopRef.current = null;
        }
        await ble.disconnect(d.id);
        setConnected(null);
        onBpmStream(null);
        onConnectChange(null);
      } catch (e: any) {
        setError(e?.message ?? "Disconnect failed");
      } finally {
        setBusyId(null);
      }
      return;
    }
    if (connected) {
      if (hrStopRef.current) {
        hrStopRef.current();
        hrStopRef.current = null;
      }
      if (gestureStopRef.current) {
        gestureStopRef.current();
        gestureStopRef.current = null;
      }
      try {
        await ble.disconnect(connected.id);
      } catch {}
      setConnected(null);
      onBpmStream(null);
      onConnectChange(null);
    }
    stopScan();
    setBusyId(d.id);
    isConnectingRef.current = true;
    setError(null);
    try {
      const info = await ble.connect(d.id);
      setConnected(info);
      onConnectChange(info);
      if (info.hasEqoService) {
        hrStopRef.current = await ble.streamHR(
          info.id,
          (bpm) => onBpmStream(bpm),
          (msg) => setError(msg)
        );
        gestureStopRef.current = await ble.streamGestures(
          info.id,
          (gestureCode) => onGestureStream(gestureCode),
          (msg) => setError(msg)
        );
      }
    } catch (e: any) {
      setError(e?.message ?? "Connect failed");
    } finally {
      setBusyId(null);
      isConnectingRef.current = false;
    }
  };

  const startScan = async () => {
    setError(null);
    setDevices([]);
    if (!ble.supported) {
      setError(ble.reason ?? t("beta_unsupported"));
      return;
    }
    const ok = await ble.ensurePermissions();
    if (!ok) {
      setError(t("perm_denied"));
      return;
    }
    setScanning(true);
    stopRef.current = ble.scan(
      (d) => {
        setDevices((list) => {
          if (list.some((x) => x.id === d.id)) return list;
          return [...list, d];
        });

        if (autoConnectEnabled && !connected && !isConnectingRef.current && !busyId) {
          const isRemembered = lastBleDevice && lastBleDevice.id === d.id;
          const devName = (d.name || "").toLowerCase();
          const isMatchingName =
            !lastBleDevice &&
            (devName.includes("sasha") || devName.includes("eqo") || devName.includes("esp32") || devName.includes("xiao"));

          if (isRemembered || isMatchingName) {
            handleConnect(d);
          }
        }
      },
      (msg) => {
        setError(msg);
        setScanning(false);
      }
    );
    setTimeout(() => {
      if (stopRef.current) {
        stopRef.current();
        stopRef.current = null;
      }
      setScanning(false);
    }, 15000);
  };

  const stopScan = () => {
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
    }
    setScanning(false);
  };

  useEffect(() => {
    if (autoConnectEnabled && ble.supported && !connected && !autoConnectAttemptedRef.current) {
      autoConnectAttemptedRef.current = true;
      startScan().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnectEnabled]);

  return (
    <>
      <Section title={t("beta_ble")} />
      <View style={styles.infoBox}>
        <Text style={styles.muted}>{t("beta_ble_desc")}</Text>

        {!ble.supported ? (
          <View style={styles.betaWarn}>
            <MaterialCommunityIcons name="alert-circle-outline" size={18} color={C.amber} />
            <View style={{ flex: 1 }}>
              <Text style={styles.warnTitle}>{t("beta_unsupported")}</Text>
              <Text style={styles.body}>{ble.reason ?? t("beta_unsupported_hint")}</Text>
            </View>
          </View>
        ) : (
          <>
            <Pressable
              testID="ble-scan-btn"
              onPress={scanning ? stopScan : startScan}
              style={[styles.scanBtn, { backgroundColor: scanning ? C.red : C.ember }]}
            >
              <MaterialCommunityIcons
                name={scanning ? "stop-circle-outline" : "radar"}
                size={18}
                color="#FFFFFF"
              />
              <Text style={styles.scanBtnTxt}>{scanning ? t("stop_scan") : t("scan")}</Text>
            </Pressable>

            {scanning && (
              <View style={styles.scanRow}>
                <ActivityIndicator size="small" color={C.ember} />
                <Text style={styles.muted}>{t("scanning")}</Text>
              </View>
            )}

            {error && (
              <View style={styles.betaWarn}>
                <MaterialCommunityIcons name="alert-circle-outline" size={18} color={C.red} />
                <Text style={[styles.body, { flex: 1 }]}>{error}</Text>
              </View>
            )}

            {connected && (
              <View style={[styles.betaWarn, { backgroundColor: "rgba(16,185,129,0.12)" }]}>
                <MaterialCommunityIcons name="check-circle" size={18} color={C.green} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.warnTitle}>
                    {t("connected_to")} {connected.name ?? t("unknown_device")}
                  </Text>
                  <Text style={styles.body}>{connected.id}</Text>
                  {connected.services.length > 0 && (
                    <Text style={[styles.muted, { marginTop: 6, fontSize: 11 }]}>
                      {t("services_found")}: {connected.services.length}
                    </Text>
                  )}
                </View>
              </View>
            )}

            {!scanning && devices.length === 0 && !error && !connected && (
              <Text style={[styles.muted, { marginTop: 12 }]}>{t("no_devices")}</Text>
            )}

            {devices.map((d) => {
              const isConnected = connected?.id === d.id;
              const isBusy = busyId === d.id;
              return (
                <Pressable
                  key={d.id}
                  testID={`ble-device-${d.id}`}
                  onPress={() => handleConnect(d)}
                  disabled={isBusy}
                  style={[styles.deviceItem, isConnected && { borderColor: C.green, borderWidth: 1 }]}
                >
                  <MaterialCommunityIcons
                    name={isConnected ? "bluetooth-connect" : "bluetooth"}
                    size={20}
                    color={isConnected ? C.green : C.blue}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{d.name ?? t("unknown_device")}</Text>
                    <Text style={styles.muted}>
                      {d.id}
                      {d.rssi !== null ? ` · ${d.rssi} dBm` : ""}
                    </Text>
                  </View>
                  {isBusy ? (
                    <ActivityIndicator size="small" color={C.ember} />
                  ) : (
                    <Text style={[styles.action, { color: isConnected ? C.red : C.ember }]}>
                      {isConnected ? t("disconnect") : t("connect")}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </>
        )}
      </View>
    </>
  );
}

// ---------- Settings Screen ----------
function SettingsScreen({
  t,
  lang,
  changeLang,
  connected,
  notifs,
  toggleNotifs,
  onEditGoals,
  theme,
  setTheme,
}: any) {
  const { C, styles } = useAppTheme();
  return (
    <>
      <View style={styles.profile} testID="profile-card">
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{USER_INITIAL}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} testID="profile-name">{USER_NAME}</Text>
          <Text style={styles.muted}>{t("profile_sub")}</Text>
        </View>
        <Icon name="chevron-right" color={C.muted} />
      </View>

      <Text style={styles.settingsGroup}>{t("prefs")}</Text>

      {/* Theme */}
      <View style={styles.settingRow}>
        <Icon name="theme-light-dark" color={C.purple} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("theme_lbl")}</Text>
          <Text style={styles.muted}>{theme === "dark" ? t("theme_dark") : t("theme_light")}</Text>
        </View>
        <View style={styles.themeSwitch}>
          <Pressable
            testID="setting-theme-light"
            onPress={() => setTheme("light")}
            style={[styles.themeOpt, theme === "light" && styles.themeOptActive]}
          >
            <Icon name="white-balance-sunny" size={12} color={theme === "light" ? "#FFFFFF" : C.muted} />
            <Text style={[styles.themeOptTxt, theme === "light" && { color: "#FFFFFF" }]}>{t("theme_light")}</Text>
          </Pressable>
          <Pressable
            testID="setting-theme-dark"
            onPress={() => setTheme("dark")}
            style={[styles.themeOpt, theme === "dark" && styles.themeOptActive]}
          >
            <Icon name="weather-night" size={12} color={theme === "dark" ? "#FFFFFF" : C.muted} />
            <Text style={[styles.themeOptTxt, theme === "dark" && { color: "#FFFFFF" }]}>{t("theme_dark")}</Text>
          </Pressable>
        </View>
      </View>

      {/* Language */}
      <View style={styles.settingRow}>
        <Icon name="translate" color={C.blue} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("language_lbl")}</Text>
          <Text style={styles.muted}>{t("language_desc")}</Text>
        </View>
        <View style={styles.langSwitch}>
          <Pressable
            testID="setting-lang-en"
            onPress={() => changeLang("en")}
            style={[styles.langOpt, lang === "en" && styles.langOptActive]}
          >
            <Text style={[styles.langOptTxt, lang === "en" && { color: "#FFFFFF" }]}>EN</Text>
          </Pressable>
          <Pressable
            testID="setting-lang-id"
            onPress={() => changeLang("id")}
            style={[styles.langOpt, lang === "id" && styles.langOptActive]}
          >
            <Text style={[styles.langOptTxt, lang === "id" && { color: "#FFFFFF" }]}>ID</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.settingsGroup}>{t("device_group")}</Text>

      <View style={styles.settingRow}>
        <Icon name="bluetooth" color={C.blue} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("bluetooth")}</Text>
          <Text style={styles.muted}>{connected ? t("bt_desc_on") : t("bt_desc_off")}</Text>
        </View>
        <Switch
          testID="setting-bluetooth"
          value={connected}
          onValueChange={() => {}}
          disabled
          trackColor={{ true: C.green, false: C.raised }}
          thumbColor="#FFFFFF"
        />
      </View>

      <View style={styles.settingRow}>
        <Icon name="bell-outline" color={C.amber} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("notifications")}</Text>
          <Text style={styles.muted}>{t("notifications_desc")}</Text>
        </View>
        <Switch
          testID="setting-notifications"
          value={notifs}
          onValueChange={toggleNotifs}
          trackColor={{ true: C.ember, false: C.raised }}
          thumbColor="#FFFFFF"
        />
      </View>

      <Text style={styles.settingsGroup}>{t("goals_group")}</Text>

      <Pressable testID="setting-edit-goals" style={styles.settingRow} onPress={onEditGoals}>
        <Icon name="target" color={C.ember} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("edit_goals")}</Text>
          <Text style={styles.muted}>{t("edit_goals_desc")}</Text>
        </View>
        <Icon name="chevron-right" color={C.muted} />
      </Pressable>

      <Pressable testID="setting-about" style={styles.settingRow}>
        <Icon name="information-outline" color={C.blue} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t("about")}</Text>
          <Text style={styles.muted}>{t("about_desc")}</Text>
        </View>
        <Icon name="chevron-right" color={C.muted} />
      </Pressable>

      <Text style={styles.version}>{t("version")}</Text>
    </>
  );
}

// ---------- Edit Goals Modal ----------
function EditGoalsModal({ visible, t, stepGoal, activeGoal, calGoal, onClose, onSave }: any) {
  const { C, styles } = useAppTheme();
  const [s, setS] = useState(String(stepGoal));
  const [a, setA] = useState(String(activeGoal));
  const [c, setC] = useState(String(calGoal));
  useEffect(() => {
    if (visible) {
      setS(String(stepGoal));
      setA(String(activeGoal));
      setC(String(calGoal));
    }
  }, [visible, stepGoal, activeGoal, calGoal]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBg}>
        <View style={styles.modalCard}>
          <Text style={styles.cardTitle}>{t("edit_goals")}</Text>
          <View style={{ height: 12 }} />
          <Text style={styles.muted}>{t("steps_daily")}</Text>
          <TextInput
            testID="edit-step-goal"
            value={s}
            onChangeText={setS}
            keyboardType="number-pad"
            style={styles.modalInput}
            placeholderTextColor={C.muted}
          />
          <Text style={styles.muted}>{t("active_minutes")}</Text>
          <TextInput
            testID="edit-active-goal"
            value={a}
            onChangeText={setA}
            keyboardType="number-pad"
            style={styles.modalInput}
            placeholderTextColor={C.muted}
          />
          <Text style={styles.muted}>{t("calories_daily")}</Text>
          <TextInput
            testID="edit-cal-goal"
            value={c}
            onChangeText={setC}
            keyboardType="number-pad"
            style={styles.modalInput}
            placeholderTextColor={C.muted}
          />
          <View style={styles.modalActions}>
            <Pressable
              testID="edit-cancel"
              onPress={onClose}
              style={[styles.outline, { flex: 1, alignItems: "center" }]}
            >
              <Text style={styles.action}>{t("cancel")}</Text>
            </Pressable>
            <Pressable
              testID="edit-save"
              onPress={() => onSave(parseInt(s) || 10000, parseInt(a) || 30, parseInt(c) || 500)}
              style={{
                flex: 1,
                backgroundColor: C.ember,
                borderRadius: 12,
                paddingVertical: 13,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={styles.saveText}>{t("save")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

