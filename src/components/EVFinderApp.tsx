"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ── Constants ────────────────────────────────────────────────────────────────

const OCMAP_API = "https://api.openchargemap.io/v3/poi";
const TILE_URL =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

const CONNECTOR_LABELS: Record<number, string> = {
  1: "Type 1 (J1772)",
  2: "CHAdeMO",
  3: "CCS (SAE)",
  4: "Type 2",
  8: "Type 2 Combo",
  25: "CCS2",
  32: "NACS/Tesla",
  33: "Tesla Supercharger",
};

const STATUS_COLORS: Record<number, string> = {
  0: "#888",
  10: "#00e5a0",
  20: "#ff6b35",
  30: "#ffd700",
  75: "#888",
  100: "#00e5a0",
  150: "#aaa",
  200: "#888",
};

const STATUS_LABELS: Record<number, string> = {
  0: "Unknown",
  10: "Operational",
  20: "Not Operational",
  30: "Unavailable",
  75: "Deprecated",
  100: "Operational",
  150: "Removed",
  200: "Unverified",
};

// ── Types ────────────────────────────────────────────────────────────────────

interface Vehicle {
  id: string;
  name: string;
  batteryKwh: number;
  epaRange: number;
  maxDcKw: number;
}

interface Station {
  ID: number;
  AddressInfo: {
    Title: string;
    AddressLine1?: string;
    Town?: string;
    Latitude: number;
    Longitude: number;
  };
  StatusType?: { ID: number };
  Connections?: Array<{ ConnectionTypeID: number; PowerKW?: number }>;
  OperatorInfo?: { Title: string };
  UsageCost?: string;
  distance: number;
}

interface ChargeStats {
  arrivalPct: number;
  arrivalRange: number;
  effectiveKw: number;
  kwhNeeded: number;
  chargeMinutes: number;
  canReach: boolean;
  alreadyAbove80: boolean;
}

// ── Ford EV fleet ────────────────────────────────────────────────────────────

const FORD_VEHICLES: Vehicle[] = [
  { id: "mache_sr_rwd", name: "Mustang Mach-E SR RWD",  batteryKwh: 70,  epaRange: 247, maxDcKw: 115 },
  { id: "mache_er_rwd", name: "Mustang Mach-E ER RWD",  batteryKwh: 91,  epaRange: 312, maxDcKw: 115 },
  { id: "mache_er_awd", name: "Mustang Mach-E ER AWD",  batteryKwh: 91,  epaRange: 277, maxDcKw: 150 },
  { id: "mache_gt",     name: "Mustang Mach-E GT",       batteryKwh: 91,  epaRange: 266, maxDcKw: 150 },
  { id: "f150_sr",      name: "F-150 Lightning SR",      batteryKwh: 98,  epaRange: 240, maxDcKw: 155 },
  { id: "f150_er",      name: "F-150 Lightning ER",      batteryKwh: 131, epaRange: 320, maxDcKw: 216 },
  { id: "etransit",     name: "E-Transit Van",            batteryKwh: 67,  epaRange: 126, maxDcKw: 115 },
  { id: "custom",       name: "Custom / Other EV",        batteryKwh: 75,  epaRange: 250, maxDcKw: 100 },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function maxKwFromStation(s: Station): number | null {
  const powers = (s.Connections ?? []).map((c) => c.PowerKW).filter(Boolean) as number[];
  return powers.length ? Math.max(...powers) : null;
}

function calcChargeStats(
  station: Station,
  vehicle: Vehicle,
  currentPct: number
): ChargeStats {
  const miPerKwh = vehicle.epaRange / vehicle.batteryKwh;
  const currentKwh = (currentPct / 100) * vehicle.batteryKwh;
  const energyUsedKwh = station.distance / miPerKwh;
  const arrivalKwh = Math.max(0, currentKwh - energyUsedKwh);
  const arrivalPct = (arrivalKwh / vehicle.batteryKwh) * 100;

  const stationKw = maxKwFromStation(station);
  const effectiveKw = stationKw
    ? Math.min(stationKw, vehicle.maxDcKw)
    : vehicle.maxDcKw * 0.7;

  const targetKwh = 0.8 * vehicle.batteryKwh;
  const kwhNeeded = Math.max(0, targetKwh - arrivalKwh);
  const chargeMinutes = Math.round((kwhNeeded / effectiveKw) * 60);

  return {
    arrivalPct: Math.round(arrivalPct),
    arrivalRange: Math.round(arrivalKwh * miPerKwh),
    effectiveKw: Math.round(effectiveKw),
    kwhNeeded: Math.round(kwhNeeded * 10) / 10,
    chargeMinutes,
    canReach: arrivalPct >= 3,
    alreadyAbove80: arrivalPct >= 80,
  };
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins} MIN`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function connectorList(s: Station): string {
  return [
    ...new Set(
      (s.Connections ?? []).map(
        (c) => CONNECTOR_LABELS[c.ConnectionTypeID] ?? `Type ${c.ConnectionTypeID}`
      )
    ),
  ].join(", ");
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Tag({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        fontSize: 10, padding: "2px 8px", borderRadius: 4,
        background: `${color}18`, border: `1px solid ${color}55`,
        color, fontWeight: 700, letterSpacing: 0.5, whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function BatteryBar({ pct, size = "md" }: { pct: number; size?: "sm" | "md" }) {
  const color = pct >= 50 ? "#00e5a0" : pct >= 20 ? "#ffd700" : "#ff6b35";
  const h = size === "sm" ? 8 : 12;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div
        style={{
          flex: 1, height: h, background: "#1e1e2e",
          borderRadius: h, overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, pct)}%`, height: "100%",
            background: `linear-gradient(90deg, ${color}88, ${color})`,
            borderRadius: h, transition: "width 0.5s ease",
          }}
        />
      </div>
      <span style={{ fontSize: size === "sm" ? 10 : 12, color, fontWeight: 700, minWidth: 32 }}>
        {pct}%
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, marginBottom: 12, fontWeight: 700 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "#111", border: "1px solid #1e1e2e",
        borderRadius: 8, padding: "8px 10px", textAlign: "center",
      }}
    >
      <div style={{ fontSize: 14, fontFamily: "'Bebas Neue'", color: "#00e5a0", letterSpacing: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 9, color: "#555", letterSpacing: 1, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function LabeledInput({
  label, value, onChange, min, max,
}: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number;
}) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 5, letterSpacing: 1 }}>
        {label.toUpperCase()}
      </div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

// ── Main app ─────────────────────────────────────────────────────────────────

export default function EVFinderApp() {
  const [screen, setScreen] = useState<"setup" | "main">("setup");
  const [view, setView] = useState<"list" | "map">("list");
  const [userPos, setUserPos] = useState<{ lat: number; lon: number } | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Station | null>(null);
  const [radius, setRadius] = useState(10);

  const [vehicleId, setVehicleId] = useState("mache_er_rwd");
  const [currentPct, setCurrentPct] = useState(60);
  const [customBattery, setCustomBattery] = useState(75);
  const [customRange, setCustomRange] = useState(250);
  const [customMaxKw, setCustomMaxKw] = useState(100);

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<unknown>(null);
  const markersRef = useRef<unknown[]>([]);

  const baseVehicle = FORD_VEHICLES.find((v) => v.id === vehicleId)!;
  const vehicle: Vehicle =
    vehicleId === "custom"
      ? { ...baseVehicle, batteryKwh: customBattery, epaRange: customRange, maxDcKw: customMaxKw }
      : baseVehicle;

  const currentRange = Math.round((currentPct / 100) * vehicle.epaRange);

  // ── Data fetching ────────────────────────────────────────────────────────

  const fetchStations = useCallback(
    async (lat: number, lon: number, r: number) => {
      setLoading(true);
      setError(null);
      try {
        const url = `${OCMAP_API}?output=json&latitude=${lat}&longitude=${lon}&distance=${r}&distanceunit=miles&levelid=3&maxresults=50&compact=true&verbose=false`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("API error");
        const data = await res.json();
        const sorted: Station[] = data
          .filter((s: Station) => s.AddressInfo?.Latitude && s.AddressInfo?.Longitude)
          .map((s: Station) => ({
            ...s,
            distance: haversine(lat, lon, s.AddressInfo.Latitude, s.AddressInfo.Longitude),
          }))
          .sort((a: Station, b: Station) => a.distance - b.distance);
        setStations(sorted);
      } catch {
        setError("Could not load stations. Check your connection and try again.");
      }
      setLoading(false);
    },
    []
  );

  const locate = useCallback(() => {
    setError(null);
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserPos({ lat: latitude, lon: longitude });
        fetchStations(latitude, longitude, radius);
        setScreen("main");
      },
      () => {
        setError("Location access denied. Please enable location in your browser settings.");
        setLoading(false);
      }
    );
  }, [radius, fetchStations]);

  useEffect(() => {
    if (userPos) fetchStations(userPos.lat, userPos.lon, radius);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius]);

  // ── Leaflet map ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (view !== "map" || !userPos || screen !== "main") return;

    const initMap = () => {
      if (!mapRef.current || leafletMapRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as any).L;
      const map = L.map(mapRef.current, { zoomControl: false }).setView(
        [userPos.lat, userPos.lon],
        12
      );
      L.tileLayer(TILE_URL, {
        attribution: "© OpenStreetMap © CARTO",
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      leafletMapRef.current = map;

      const userIcon = L.divIcon({
        html: `<div style="width:16px;height:16px;background:#00e5a0;border-radius:50%;border:3px solid #fff;box-shadow:0 0 12px #00e5a0;"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
        className: "",
      });
      L.marker([userPos.lat, userPos.lon], { icon: userIcon })
        .addTo(map)
        .bindPopup("<b>You are here</b>");
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(window as any).L) {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      script.onload = initMap;
      document.head.appendChild(script);
    } else {
      initMap();
    }
  }, [view, userPos, screen]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!leafletMapRef.current || !(window as any).L || view !== "map") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const L = (window as any).L;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (markersRef.current as any[]).forEach((m: any) => m.remove());
    markersRef.current = [];

    stations.forEach((s) => {
      const stats = calcChargeStats(s, vehicle, currentPct);
      const color = !stats.canReach ? "#ff6b35" : stats.alreadyAbove80 ? "#888" : "#00e5a0";
      const isSel = selected?.ID === s.ID;
      const icon = L.divIcon({
        html: `<div style="width:${isSel ? 20 : 14}px;height:${isSel ? 20 : 14}px;background:${color};border-radius:50%;border:${isSel ? "3px solid #fff" : "2px solid rgba(255,255,255,0.3)"};box-shadow:${isSel ? `0 0 16px ${color}` : "none"};cursor:pointer;"></div>`,
        iconSize: [isSel ? 20 : 14, isSel ? 20 : 14],
        iconAnchor: [isSel ? 10 : 7, isSel ? 10 : 7],
        className: "",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const marker = L.marker([s.AddressInfo.Latitude, s.AddressInfo.Longitude], { icon })
        .addTo(leafletMapRef.current)
        .on("click", () => setSelected(s));
      markersRef.current.push(marker);
    });
  }, [stations, selected, view, currentPct, vehicleId, vehicle]);

  // ── Setup screen ─────────────────────────────────────────────────────────

  if (screen === "setup") {
    return (
      <div
        style={{
          fontFamily: "'Space Mono','Courier New',monospace",
          background: "#0a0a0f",
          color: "#e8e8f0",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #1e1e2e", display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 28, color: "#00e5a0", letterSpacing: 2 }}>CHARGEFINDER</span>
          <span style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>CHARGE PLANNER</span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 40px" }}>

          <Section title="01 — YOUR VEHICLE">
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <optgroup label="Ford EVs">
                {FORD_VEHICLES.filter((v) => v.id !== "custom").map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </optgroup>
              <optgroup label="Other">
                <option value="custom">Custom / Other EV</option>
              </optgroup>
            </select>

            {vehicleId !== "custom" && (
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <StatBox label="Battery" value={`${vehicle.batteryKwh} kWh`} />
                <StatBox label="EPA Range" value={`${vehicle.epaRange} mi`} />
                <StatBox label="Max DC" value={`${vehicle.maxDcKw} kW`} />
              </div>
            )}

            {vehicleId === "custom" && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <LabeledInput label="Battery size (kWh)" value={customBattery} onChange={setCustomBattery} min={10} max={200} />
                <LabeledInput label="EPA Range (miles)" value={customRange} onChange={setCustomRange} min={50} max={600} />
                <LabeledInput label="Max DC charge rate (kW)" value={customMaxKw} onChange={setCustomMaxKw} min={20} max={350} />
              </div>
            )}
          </Section>

          <Section title="02 — CURRENT CHARGE">
            <div style={{ marginBottom: 10 }}>
              <BatteryBar pct={currentPct} />
            </div>
            <input
              type="range" min={5} max={100} value={currentPct}
              onChange={(e) => setCurrentPct(Number(e.target.value))}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#555", marginTop: 4 }}>
              <span>5%</span>
              <span style={{ color: "#00e5a0" }}>~{currentRange} miles remaining</span>
              <span>100%</span>
            </div>
          </Section>

          <Section title="03 — SEARCH RADIUS">
            <div style={{ display: "flex", gap: 8 }}>
              {[5, 10, 15, 25].map((r) => (
                <button
                  key={r}
                  onClick={() => setRadius(r)}
                  style={{
                    flex: 1, padding: "10px 0", borderRadius: 6, border: "1px solid",
                    borderColor: radius === r ? "#00e5a0" : "#333",
                    background: radius === r ? "rgba(0,229,160,0.1)" : "transparent",
                    color: radius === r ? "#00e5a0" : "#666",
                    fontFamily: "inherit", fontSize: 12, cursor: "pointer", fontWeight: 700,
                  }}
                >
                  {r} mi
                </button>
              ))}
            </div>
          </Section>

          {error && (
            <div
              style={{
                color: "#ff6b35", fontSize: 12,
                background: "rgba(255,107,53,0.1)",
                padding: "10px 14px", borderRadius: 6,
                border: "1px solid rgba(255,107,53,0.3)", marginBottom: 16,
              }}
            >
              {error}
            </div>
          )}

          <button
            onClick={locate}
            disabled={loading}
            style={{
              width: "100%", padding: "16px",
              background: loading ? "#333" : "#00e5a0",
              color: "#0a0a0f", border: "none", borderRadius: 10,
              fontFamily: "inherit", fontWeight: 700, fontSize: 14, letterSpacing: 1,
              cursor: loading ? "not-allowed" : "pointer",
              boxShadow: loading ? "none" : "0 0 24px rgba(0,229,160,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              transition: "all .2s",
            }}
          >
            {loading ? (
              <>
                <div
                  style={{
                    width: 16, height: 16,
                    border: "2px solid #555", borderTopColor: "#00e5a0",
                    borderRadius: "50%", animation: "spin 0.8s linear infinite",
                  }}
                />
                LOCATING…
              </>
            ) : (
              "⚡ FIND CHARGERS NEAR ME"
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Main results screen ──────────────────────────────────────────────────

  const reachable = stations.filter(
    (s) => calcChargeStats(s, vehicle, currentPct).canReach
  ).length;

  return (
    <div
      style={{
        fontFamily: "'Space Mono','Courier New',monospace",
        background: "#0a0a0f", color: "#e8e8f0",
        height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          padding: "10px 16px", borderBottom: "1px solid #1a1a2e",
          display: "flex", alignItems: "center", gap: 12,
          background: "#0a0a0f", zIndex: 100,
        }}
      >
        <button
          onClick={() => setScreen("setup")}
          style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 18, padding: 0, lineHeight: 1 }}
        >
          ←
        </button>
        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 22, color: "#00e5a0", letterSpacing: 2, flex: 1 }}>
          CHARGEFINDER
        </span>

        {/* Mini battery */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 44, height: 10, background: "#1e1e2e", borderRadius: 5, overflow: "hidden" }}>
            <div
              style={{
                width: `${currentPct}%`, height: "100%",
                background: currentPct > 50 ? "#00e5a0" : currentPct > 20 ? "#ffd700" : "#ff6b35",
                transition: "width .3s",
              }}
            />
          </div>
          <span style={{ fontSize: 10, color: "#aaa", fontWeight: 700 }}>{currentPct}%</span>
        </div>

        {/* View toggle */}
        <div style={{ display: "flex", gap: 3, background: "#111", borderRadius: 7, padding: 3 }}>
          {(["list", "map"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: "5px 12px", borderRadius: 5, border: "none",
                fontSize: 10, fontFamily: "inherit", fontWeight: 700,
                letterSpacing: 1, textTransform: "uppercase",
                background: view === v ? "#00e5a0" : "transparent",
                color: view === v ? "#0a0a0f" : "#666",
                cursor: "pointer",
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Summary strip */}
      <div
        style={{
          padding: "8px 16px", borderBottom: "1px solid #1a1a2e",
          display: "flex", gap: 12, fontSize: 10, color: "#555", alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span>{vehicle.name}</span>
        <span style={{ color: "#333" }}>·</span>
        <span style={{ color: "#00e5a0" }}>{reachable} reachable</span>
        <span style={{ color: "#333" }}>·</span>
        <span>{stations.length} total within {radius}mi</span>
        {loading && (
          <span style={{ marginLeft: "auto", color: "#00e5a0", animation: "pulse 1s infinite" }}>
            SCANNING…
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {[5, 10, 15, 25].map((r) => (
            <button
              key={r}
              onClick={() => setRadius(r)}
              style={{
                padding: "2px 8px", borderRadius: 4, border: "1px solid",
                borderColor: radius === r ? "#00e5a0" : "#2a2a3a",
                background: "transparent",
                color: radius === r ? "#00e5a0" : "#555",
                fontFamily: "inherit", fontSize: 9, cursor: "pointer", fontWeight: 700,
              }}
            >
              {r}mi
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>

        {/* LIST VIEW */}
        {view === "list" && (
          <div style={{ overflowY: "auto", height: "100%", padding: "8px 12px 20px" }}>
            {stations.length === 0 && !loading && (
              <div style={{ textAlign: "center", padding: 40, color: "#555", fontSize: 12 }}>
                No DC fast chargers found within {radius} miles.
              </div>
            )}

            {stations.map((s) => {
              const stats = calcChargeStats(s, vehicle, currentPct);
              const stationKw = maxKwFromStation(s);
              const statusId = s.StatusType?.ID ?? 0;

              return (
                <div
                  key={s.ID}
                  onClick={() => { setSelected(s); setView("map"); }}
                  style={{
                    background: "#0f0f1a",
                    border: `1px solid ${stats.canReach ? "#1e1e2e" : "#2a1a1a"}`,
                    borderRadius: 10, padding: "12px 14px", marginBottom: 8,
                    cursor: "pointer", opacity: stats.canReach ? 1 : 0.7,
                    transition: "all .15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = "#1a1a2e";
                    (e.currentTarget as HTMLDivElement).style.borderColor = "#333";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = "#0f0f1a";
                    (e.currentTarget as HTMLDivElement).style.borderColor = stats.canReach ? "#1e1e2e" : "#2a1a1a";
                  }}
                >
                  {/* Name + distance */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div style={{ flex: 1, paddingRight: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, lineHeight: 1.4, marginBottom: 2 }}>
                        {s.AddressInfo?.Title ?? "Charging Station"}
                      </div>
                      <div style={{ color: "#555", fontSize: 10 }}>
                        {s.AddressInfo?.AddressLine1}{s.AddressInfo?.Town ? `, ${s.AddressInfo.Town}` : ""}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontFamily: "'Bebas Neue'", fontSize: 24, color: stats.canReach ? "#e8e8f0" : "#ff6b35", lineHeight: 1 }}>
                        {s.distance.toFixed(1)}
                      </div>
                      <div style={{ fontSize: 9, color: "#444", letterSpacing: 1 }}>MILES</div>
                    </div>
                  </div>

                  {/* Charge plan */}
                  <div style={{ background: "#111", borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
                    {!stats.canReach ? (
                      <div style={{ color: "#ff6b35", fontSize: 11, fontWeight: 700 }}>
                        ⚠ OUT OF RANGE — ~{stats.arrivalRange} mi range remaining
                      </div>
                    ) : stats.alreadyAbove80 ? (
                      <div style={{ color: "#888", fontSize: 11 }}>
                        Already above 80% on arrival — no charge needed
                      </div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 9, color: "#555", marginBottom: 4, letterSpacing: 1 }}>ARRIVE AT</div>
                          <BatteryBar pct={stats.arrivalPct} size="sm" />
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: "#555", marginBottom: 4, letterSpacing: 1 }}>TIME TO 80%</div>
                          <div style={{ fontSize: 16, fontFamily: "'Bebas Neue'", color: "#00e5a0", letterSpacing: 1 }}>
                            {formatMinutes(stats.chargeMinutes)}
                          </div>
                          <div style={{ fontSize: 9, color: "#444" }}>
                            +{stats.kwhNeeded} kWh @ {stats.effectiveKw} kW
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Tags */}
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                    <Tag color={STATUS_COLORS[statusId]} label={STATUS_LABELS[statusId] ?? "Unknown"} />
                    {stationKw && (
                      <Tag color={stationKw >= 150 ? "#00e5a0" : "#ffd700"} label={`${stationKw} kW`} />
                    )}
                    {s.OperatorInfo?.Title && (
                      <span style={{ fontSize: 9, color: "#444", marginLeft: "auto" }}>{s.OperatorInfo.Title}</span>
                    )}
                  </div>
                  {connectorList(s) && (
                    <div style={{ color: "#3a3a4a", fontSize: 9, marginTop: 5 }}>{connectorList(s)}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* MAP VIEW */}
        {view === "map" && (
          <div style={{ position: "relative", height: "100%" }}>
            <div ref={mapRef} style={{ width: "100%", height: "100%", background: "#111" }} />

            {/* Legend */}
            <div
              style={{
                position: "absolute", top: 12, left: 12,
                background: "rgba(10,10,15,0.92)",
                border: "1px solid #1e1e2e", borderRadius: 8,
                padding: "8px 12px", zIndex: 999, fontSize: 10,
              }}
            >
              <div style={{ color: "#555", letterSpacing: 1, marginBottom: 6 }}>MAP LEGEND</div>
              {([
                ["#00e5a0", "Reachable"],
                ["#ff6b35", "Out of range"],
                ["#888", "Above 80% on arrival"],
              ] as [string, string][]).map(([c, l]) => (
                <div key={l} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />
                  <span style={{ color: "#aaa" }}>{l}</span>
                </div>
              ))}
            </div>

            {/* Selected station panel */}
            {selected && (() => {
              const stats = calcChargeStats(selected, vehicle, currentPct);
              const stationKw = maxKwFromStation(selected);
              const statusId = selected.StatusType?.ID ?? 0;
              return (
                <div
                  style={{
                    position: "absolute", bottom: 12, left: 12, right: 12,
                    background: "#13131f", border: "1px solid #00e5a0",
                    borderRadius: 12, padding: "14px 16px", zIndex: 999,
                    boxShadow: "0 4px 32px rgba(0,0,0,0.8)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div style={{ flex: 1, paddingRight: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3 }}>
                        {selected.AddressInfo?.Title}
                      </div>
                      <div style={{ color: "#555", fontSize: 11 }}>
                        {selected.AddressInfo?.AddressLine1}, {selected.AddressInfo?.Town}
                      </div>
                    </div>
                    <button
                      onClick={() => setSelected(null)}
                      style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 20, padding: 0, lineHeight: 1 }}
                    >
                      ×
                    </button>
                  </div>

                  <div style={{ background: "#0f0f1a", borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
                    {!stats.canReach ? (
                      <div style={{ color: "#ff6b35", fontSize: 11, fontWeight: 700 }}>
                        ⚠ OUT OF RANGE — not enough charge to reach this station
                      </div>
                    ) : stats.alreadyAbove80 ? (
                      <div style={{ color: "#888", fontSize: 11 }}>
                        You&apos;ll arrive above 80% — no significant charging needed
                      </div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div>
                          <div style={{ fontSize: 9, color: "#555", marginBottom: 4, letterSpacing: 1 }}>ARRIVE AT</div>
                          <BatteryBar pct={stats.arrivalPct} size="sm" />
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: "#555", marginBottom: 2, letterSpacing: 1 }}>TIME TO 80%</div>
                          <div style={{ fontSize: 20, fontFamily: "'Bebas Neue'", color: "#00e5a0" }}>
                            {formatMinutes(stats.chargeMinutes)}
                          </div>
                          <div style={{ fontSize: 10, color: "#444" }}>
                            +{stats.kwhNeeded} kWh @ {stats.effectiveKw} kW
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Tag color={STATUS_COLORS[statusId]} label={STATUS_LABELS[statusId] ?? "Unknown"} />
                    {stationKw && (
                      <Tag color={stationKw >= 150 ? "#00e5a0" : "#ffd700"} label={`${stationKw} kW`} />
                    )}
                    <Tag color="#888" label={`${selected.distance.toFixed(1)} mi away`} />
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
