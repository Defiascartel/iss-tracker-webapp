"use client";

import { useEffect, useRef, useState } from "react";

type IssData = {
  latitude: number;
  longitude: number;
  altitude: number;
  velocity: number;
  timestamp: number;
};

const ISS_URL = "https://api.wheretheiss.at/v1/satellites/25544";
const TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE";
const REFRESH_MS = 5000;
const TRAIL_MAX_POINTS = 200;
const OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const PASS_MAX = 5;
const PASS_LOOKAHEAD_HOURS = 24;
const PASS_STEP_SECONDS = 60;
const MIN_ELEVATION_DEG = 10;
const ORBIT_LOOKAHEAD_MINUTES = 90;
const ORBIT_STEP_SECONDS = 60;
const EARTH_RADIUS_KM = 6371;
const FOOTPRINT_MIN_ELEV_DEG = 20;

type PassInfo = {
  start: Date;
  end: Date;
  durationSec: number;
  maxElevationDeg: number;
};

const toJulian = (date: Date) => date.getTime() / 86400000 + 2440587.5;
const toDays = (date: Date) => toJulian(date) - 2451545.0;
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (radVal: number) => (radVal * 180) / Math.PI;
const normalizeLon = (lon: number) => {
  let result = ((lon + 180) % 360 + 360) % 360 - 180;
  if (result === -180) result = 180;
  return result;
};

const getSubsolarPoint = (date: Date) => {
  const d = toDays(date);
  const M = rad(357.5291 + 0.98560028 * d);
  const C = rad(
    1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)
  );
  const L = rad(280.4665 + 0.98564736 * d) + C;
  const e = rad(23.4397);
  const decl = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const theta = rad(280.16 + 360.9856235 * d);
  const gha = theta - ra;
  const subsolarLat = deg(decl);
  const subsolarLon = normalizeLon(-deg(gha));
  return { lat: subsolarLat, lon: subsolarLon };
};

const computeDayBoundary = (date: Date) => {
  const { lat: lat0, lon: lon0 } = getSubsolarPoint(date);
  const lat1 = rad(lat0);
  const lon1 = rad(lon0);
  const distance = Math.PI / 2;
  const ring: [number, number][] = [];
  for (let bearing = 0; bearing <= 360; bearing += 2) {
    const brng = rad(bearing);
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distance) +
        Math.cos(lat1) * Math.sin(distance) * Math.cos(brng)
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(brng) * Math.sin(distance) * Math.cos(lat1),
        Math.cos(distance) - Math.sin(lat1) * Math.sin(lat2)
      );
    ring.push([deg(lat2), normalizeLon(deg(lon2))]);
  }
  return ring;
};

export default function Home() {
  const [data, setData] = useState<IssData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(true);
  const [followIss, setFollowIss] = useState(true);
  const [showFootprint, setShowFootprint] = useState(false);
  const [tle, setTle] = useState<[string, string] | null>(null);
  const [tleError, setTleError] = useState<string | null>(null);
  const [passes, setPasses] = useState<PassInfo[] | null>(null);
  const [passError, setPassError] = useState<string | null>(null);
  const [passLoading, setPassLoading] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLon, setManualLon] = useState("");
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [passLocation, setPassLocation] = useState<{ lat: number; lon: number } | null>(
    null
  );
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").CircleMarker | null>(null);
  const trailLineRef = useRef<import("leaflet").Polyline | null>(null);
  const orbitLineRef = useRef<import("leaflet").Polyline | null>(null);
  const footprintRef = useRef<import("leaflet").Circle | null>(null);
  const nightLayerRef = useRef<import("leaflet").Layer | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const satrecRef = useRef<ReturnType<typeof import("satellite.js")["twoline2satrec"]> | null>(
    null
  );
  const trailRef = useRef<[number, number][]>([]);
  const latestDataRef = useRef<IssData | null>(null);
  const hasCenteredRef = useRef(false);
  const followRef = useRef(true);

  const updateMapFromData = () => {
    const map = mapRef.current;
    const L = leafletRef.current;
    const latest = latestDataRef.current;
    if (!map || !latest || !L) return;

    const current: [number, number] = [latest.longitude, latest.latitude];
    trailRef.current = [...trailRef.current, current].slice(-TRAIL_MAX_POINTS);

    const latlng: import("leaflet").LatLngExpression = [
      latest.latitude,
      latest.longitude,
    ];

    if (!hasCenteredRef.current) {
      map.setView(latlng, 2.6);
      hasCenteredRef.current = true;
    } else if (followRef.current) {
      map.setView(latlng, map.getZoom(), { animate: true, duration: 1.2 });
    }

    if (!markerRef.current) {
      markerRef.current = L.circleMarker(latlng, {
        radius: 6,
        color: "rgba(15, 23, 42, 0.8)",
        weight: 2,
        fillColor: "#22d3ee",
        fillOpacity: 0.95,
      }).addTo(map);
    } else {
      markerRef.current.setLatLng(latlng);
    }

    const trailLatLngs: import("leaflet").LatLngTuple[] = trailRef.current.map(
      ([lng, lat]) => [lat, lng]
    );

    if (!trailLineRef.current) {
      trailLineRef.current = L.polyline(trailLatLngs, {
        color: "rgba(248, 113, 113, 0.95)",
        weight: 2.5,
      }).addTo(map);
    } else {
      trailLineRef.current.setLatLngs(trailLatLngs);
    }

    if (showFootprint) {
      const altitudeKm = latest.altitude;
      const elev = rad(FOOTPRINT_MIN_ELEV_DEG);
      const ratio = EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altitudeKm);
      const psi = Math.acos(Math.min(1, Math.max(-1, ratio * Math.cos(elev)))) - elev;
      const radiusKm = Math.max(0, EARTH_RADIUS_KM * psi);
      const radiusMeters = radiusKm * 1000;
      if (!footprintRef.current) {
        footprintRef.current = L.circle(latlng, {
          radius: radiusMeters,
          color: "rgba(148, 163, 184, 0.65)",
          weight: 1,
          fillColor: "rgba(15, 23, 42, 0.25)",
          fillOpacity: 0.25,
        }).addTo(map);
      } else {
        footprintRef.current.setLatLng(latlng);
        footprintRef.current.setRadius(radiusMeters);
      }
    } else if (footprintRef.current) {
      footprintRef.current.remove();
      footprintRef.current = null;
    }
  };

  const handleResetView = () => {
    const map = mapRef.current;
    const latest = latestDataRef.current;
    if (!map || !latest) return;
    map.setView([latest.latitude, latest.longitude], 2.6, {
      animate: true,
      duration: 0.8,
    });
    setFollowIss(true);
  };

  const handleUseLocation = () => {
    setPassError(null);
    if (!navigator.geolocation) {
      setPassError("Geolocation not supported in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        setPassLocation({ lat, lon });
        setLocationLabel("Posizione attuale");
        setManualLat(lat.toFixed(4));
        setManualLon(lon.toFixed(4));
      },
      (err) => {
        setPassError(err.message);
      },
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 10000 }
    );
  };

  const handleManualLocation = () => {
    setPassError(null);
    const lat = Number(manualLat);
    const lon = Number(manualLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setPassError("Inserisci coordinate valide.");
      return;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setPassError("Coordinate fuori intervallo.");
      return;
    }
    setPassLocation({ lat, lon });
    setLocationLabel("Coordinate manuali");
  };

  useEffect(() => {
    let mounted = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const fetchIss = async () => {
      const controller = new AbortController();

      try {
        if (mounted) {
          setError(null);
        }

        const response = await fetch(ISS_URL, {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`);
        }

        const payload = (await response.json()) as IssData;

        if (mounted) {
          setData(payload);
          setLoading(false);
          setLastUpdated(new Date().toLocaleTimeString());
        }
      } catch (err) {
        if (!mounted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      }
    };

    fetchIss();
    intervalId = setInterval(fetchIss, REFRESH_MS);

    return () => {
      mounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let tleInterval: ReturnType<typeof setInterval> | null = null;

    const fetchTle = async () => {
      try {
        if (active) setTleError(null);
        const response = await fetch(TLE_URL, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`TLE request failed with ${response.status}`);
        }
        const text = await response.text();
        const lines = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        let line1 = "";
        let line2 = "";
        if (lines.length >= 2 && lines[0].startsWith("1 ")) {
          line1 = lines[0];
          line2 = lines[1];
        } else if (lines.length >= 3) {
          line1 = lines[1];
          line2 = lines[2];
        }
        if (!line1 || !line2) {
          throw new Error("TLE format not recognized");
        }
        if (active) setTle([line1, line2]);
      } catch (err) {
        if (!active) return;
        setTleError(err instanceof Error ? err.message : "Unknown TLE error");
      }
    };

    void fetchTle();
    tleInterval = setInterval(fetchTle, 6 * 60 * 60 * 1000);

    return () => {
      active = false;
      if (tleInterval) clearInterval(tleInterval);
    };
  }, []);

  useEffect(() => {
    latestDataRef.current = data;
    updateMapFromData();
  }, [data]);

  useEffect(() => {
    followRef.current = followIss;
  }, [followIss]);

  useEffect(() => {
    updateMapFromData();
  }, [showFootprint]);

  useEffect(() => {
    if (!passLocation || !tle) return;
    let active = true;

    const computePasses = async () => {
      setPassLoading(true);
      setPassError(null);
      try {
        const satelliteModule = await import("satellite.js");
        const satrec = satelliteModule.twoline2satrec(tle[0], tle[1]);
        satrecRef.current = satrec;
        const observer = {
          latitude: rad(passLocation.lat),
          longitude: rad(passLocation.lon),
          height: 0,
        } as import("satellite.js").GeodeticLocation;
        const now = Date.now();
        const end = now + PASS_LOOKAHEAD_HOURS * 60 * 60 * 1000;
        const results: PassInfo[] = [];
        let inPass = false;
        let passStart: Date | null = null;
        let maxElevation = -90;

        for (let t = now; t <= end; t += PASS_STEP_SECONDS * 1000) {
          const date = new Date(t);
          const positionAndVelocity = satelliteModule.propagate(satrec, date);
          if (!positionAndVelocity.position) continue;
          const gmst = satelliteModule.gstime(date);
          const positionEci = positionAndVelocity.position as import("satellite.js").EciVec3<number>;
          const positionEcf = satelliteModule.eciToEcf(positionEci, gmst);
          const lookAngles = satelliteModule.ecfToLookAngles(
            observer,
            positionEcf
          );
          const elevationDeg = deg(lookAngles.elevation);

          if (elevationDeg >= MIN_ELEVATION_DEG) {
            if (!inPass) {
              inPass = true;
              passStart = date;
              maxElevation = elevationDeg;
            } else if (elevationDeg > maxElevation) {
              maxElevation = elevationDeg;
            }
          } else if (inPass && passStart) {
            const passEnd = date;
            results.push({
              start: passStart,
              end: passEnd,
              durationSec: Math.round(
                (passEnd.getTime() - passStart.getTime()) / 1000
              ),
              maxElevationDeg: Number(maxElevation.toFixed(1)),
            });
            if (results.length >= PASS_MAX) break;
            inPass = false;
            passStart = null;
            maxElevation = -90;
          }
        }

        if (active) setPasses(results);
      } catch (err) {
        if (!active) return;
        setPassError(err instanceof Error ? err.message : "Pass computation failed");
      } finally {
        if (active) setPassLoading(false);
      }
    };

    void computePasses();

    return () => {
      active = false;
    };
  }, [passLocation, tle]);

  useEffect(() => {
    if (!tle) return;
    let active = true;
    let orbitInterval: ReturnType<typeof setInterval> | null = null;

    const computeOrbit = async () => {
      const map = mapRef.current;
      const L = leafletRef.current;
      if (!map || !L) return;
      try {
        const satelliteModule = await import("satellite.js");
        const satrec =
          satrecRef.current ?? satelliteModule.twoline2satrec(tle[0], tle[1]);
        satrecRef.current = satrec;

        const now = Date.now();
        const points: import("leaflet").LatLngTuple[] = [];
        const segments: import("leaflet").LatLngTuple[][] = [];
        for (
          let t = now;
          t <= now + ORBIT_LOOKAHEAD_MINUTES * 60 * 1000;
          t += ORBIT_STEP_SECONDS * 1000
        ) {
          const date = new Date(t);
          const pv = satelliteModule.propagate(satrec, date);
          if (!pv.position) continue;
          const gmst = satelliteModule.gstime(date);
          const positionEci = pv.position as import("satellite.js").EciVec3<number>;
          const geodetic = satelliteModule.eciToGeodetic(positionEci, gmst);
          const lat = deg(geodetic.latitude);
          const lon = normalizeLon(deg(geodetic.longitude));
          if (points.length > 0) {
            const prevLon = points[points.length - 1][1];
            if (Math.abs(lon - prevLon) > 180) {
              segments.push([...points]);
              points.length = 0;
            }
          }
          points.push([lat, lon]);
        }

        if (!active || points.length === 0) return;
        if (points.length > 0) segments.push(points);

        if (!orbitLineRef.current) {
          orbitLineRef.current = L.polyline(segments, {
            color: "rgba(34, 197, 94, 0.9)",
            weight: 2,
            dashArray: "6 6",
          }).addTo(map);
        } else {
          orbitLineRef.current.setLatLngs(segments);
        }
      } catch (err) {
        if (!active) return;
      }
    };

    void computeOrbit();
    orbitInterval = setInterval(computeOrbit, 10 * 60 * 1000);

    return () => {
      active = false;
      if (orbitInterval) clearInterval(orbitInterval);
      if (orbitLineRef.current) {
        orbitLineRef.current.remove();
        orbitLineRef.current = null;
      }
    };
  }, [tle]);

  useEffect(() => {
    let active = true;
    let nightInterval: ReturnType<typeof setInterval> | null = null;

    const initMap = async () => {
      if (!mapContainerRef.current || mapRef.current) return;

      const leafletModule = await import("leaflet");
      const L = (leafletModule as unknown as { default?: typeof leafletModule }).default
        ?? leafletModule;
      if (!active) return;
      leafletRef.current = L;

      if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      minZoom: 1,
      maxZoom: 12,
      worldCopyJump: true,
    }).setView([0, 0], 1.6);

    L.tileLayer(OSM_TILES, {
      attribution: OSM_ATTRIBUTION,
      maxZoom: 19,
      crossOrigin: true,
      noWrap: false,
    }).addTo(map);

      L.control.zoom({ position: "topright" }).addTo(map);

      map.on("dragstart", () => setFollowIss(false));
      map.on("zoomstart", () => setFollowIss(false));

      mapRef.current = map;
      const updateNightLayer = () => {
        const L = leafletRef.current;
        const currentMap = mapRef.current;
        if (!L || !currentMap) return;
        const dayBoundary = computeDayBoundary(new Date());
        const world: [number, number][] = [
          [-90, -180],
          [-90, 180],
          [90, 180],
          [90, -180],
        ];
        const shifts = [-360, 0, 360];
        const multipolygon = shifts.map((shift) => {
          const shiftedDay = dayBoundary.map(([lat, lon]) => [lat, lon + shift]);
          const shiftedWorld = world.map(([lat, lon]) => [lat, lon + shift]);
          return [shiftedWorld, shiftedDay];
        });

        if (!nightLayerRef.current) {
          nightLayerRef.current = L.polygon(multipolygon as any, {
            stroke: false,
            fillColor: "rgba(2, 6, 23, 0.55)",
            fillOpacity: 0.55,
            interactive: false,
          }).addTo(currentMap);
        } else {
          (nightLayerRef.current as import("leaflet").Polygon).setLatLngs(
            multipolygon as any
          );
        }
      };

      updateNightLayer();
      nightInterval = setInterval(updateNightLayer, 5 * 60 * 1000);
      map.on("moveend zoomend", updateNightLayer);
      updateMapFromData();
    };

    void initMap();

    return () => {
      active = false;
      if (nightInterval) clearInterval(nightInterval);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markerRef.current = null;
      trailLineRef.current = null;
      orbitLineRef.current = null;
      nightLayerRef.current = null;
    };
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      <div ref={mapContainerRef} className="absolute inset-0 z-0" />
      <div className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.18),_transparent_55%),radial-gradient(circle_at_20%_20%,_rgba(236,72,153,0.22),_transparent_50%)]" />

      <main className="pointer-events-none relative z-20 flex h-full w-full items-end justify-center px-6 pb-6 pt-20">
        {infoOpen ? (
          <section className="pointer-events-auto w-full max-w-4xl overflow-hidden rounded-[24px] border border-slate-900/60 bg-slate-950/80 p-5 shadow-[0_30px_80px_-50px_rgba(2,6,23,0.95)] backdrop-blur-2xl sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.4em] text-cyan-200/80">
                  International Space Station
                </p>
                <h1 className="mt-2 text-xl font-semibold text-white sm:text-2xl">
                  Live ISS Tracker
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFollowIss((prev) => !prev)}
                  className={`rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-[0.2em] transition sm:px-3 sm:py-1.5 sm:text-[10px] sm:tracking-[0.25em] lg:px-4 lg:py-2 lg:text-xs lg:tracking-[0.35em] ${
                    followIss
                      ? "border-cyan-200/50 bg-cyan-300/15 text-cyan-50"
                      : "border-slate-700/60 bg-slate-900/70 text-slate-100/90 hover:border-slate-500/80 hover:text-white"
                  }`}
                >
                  {followIss ? "Segui ISS" : "Libera mappa"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowFootprint((prev) => !prev)}
                  title={`Area visibile con elevazione ≥ ${FOOTPRINT_MIN_ELEV_DEG}°`}
                  className={`rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-[0.2em] transition sm:px-3 sm:py-1.5 sm:text-[10px] sm:tracking-[0.25em] lg:px-4 lg:py-2 lg:text-xs lg:tracking-[0.35em] ${
                    showFootprint
                      ? "border-emerald-200/50 bg-emerald-300/15 text-emerald-50"
                      : "border-slate-700/60 bg-slate-900/70 text-slate-100/90 hover:border-slate-500/80 hover:text-white"
                  }`}
                >
                  {showFootprint ? "Footprint on" : "Footprint off"}
                </button>
                {!followIss && (
                  <button
                    type="button"
                    onClick={handleResetView}
                    className="rounded-full border border-slate-700/60 bg-slate-900/70 px-2.5 py-1 text-[9px] uppercase tracking-[0.2em] text-slate-100/90 transition hover:border-slate-500/80 hover:text-white sm:px-3 sm:py-1.5 sm:text-[10px] sm:tracking-[0.25em] lg:px-4 lg:py-2 lg:text-xs lg:tracking-[0.35em]"
                  >
                    Reset vista
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setInfoOpen(false)}
                  className="rounded-full border border-slate-700/60 bg-slate-900/70 px-2.5 py-1 text-[9px] uppercase tracking-[0.2em] text-slate-100/90 transition hover:border-slate-500/80 hover:text-white sm:px-3 sm:py-1.5 sm:text-[10px] sm:tracking-[0.25em] lg:px-4 lg:py-2 lg:text-xs lg:tracking-[0.35em]"
                >
                  Chiudi
                </button>
              </div>
            </div>

            <p className="mt-3 text-xs text-slate-200/80">
              Aggiornamenti ogni 5 secondi. La traiettoria mostra gli ultimi punti
              ricevuti.
            </p>

            {loading && (
              <div className="mt-6 rounded-2xl border border-slate-800/70 bg-slate-950/70 p-5 text-slate-100 shadow-[inset_0_0_35px_rgba(2,6,23,0.45)]">
                Fetching live telemetry…
              </div>
            )}

            {error && !loading && (
              <div className="mt-6 rounded-2xl border border-rose-500/50 bg-rose-950/60 p-5 text-rose-100 shadow-[inset_0_0_35px_rgba(59,7,19,0.6)]">
                Unable to load ISS data: {error}
              </div>
            )}

            {!loading && !error && data && (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/70 p-5 shadow-[inset_0_0_40px_rgba(2,6,23,0.45)]">
                  <p className="text-[10px] uppercase tracking-[0.35em] text-slate-300/80">
                    Latitude
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-white">
                    {data.latitude.toFixed(4)}°
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/70 p-5 shadow-[inset_0_0_40px_rgba(2,6,23,0.45)]">
                  <p className="text-[10px] uppercase tracking-[0.35em] text-slate-300/80">
                    Longitude
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-white">
                    {data.longitude.toFixed(4)}°
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/70 p-5 shadow-[inset_0_0_40px_rgba(2,6,23,0.45)]">
                  <p className="text-[10px] uppercase tracking-[0.35em] text-slate-300/80">
                    Altitude (km)
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-white">
                    {data.altitude.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/70 p-5 shadow-[inset_0_0_40px_rgba(2,6,23,0.45)]">
                  <p className="text-[10px] uppercase tracking-[0.35em] text-slate-300/80">
                    Velocity (km/h)
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-white">
                    {data.velocity.toFixed(2)}
                  </p>
                </div>
              </div>
            )}

            <div className="mt-5 rounded-2xl border border-slate-800/70 bg-slate-950/70 p-4 shadow-[inset_0_0_40px_rgba(2,6,23,0.45)]">
              <p className="text-[10px] uppercase tracking-[0.35em] text-slate-300/80">
                Prossimi passaggi ISS
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleUseLocation}
                  className="rounded-full border border-slate-700/60 bg-slate-900/70 px-2.5 py-1 text-[9px] uppercase tracking-[0.2em] text-slate-100/90 transition hover:border-slate-500/80 hover:text-white sm:px-3 sm:py-1.5 sm:text-[10px] sm:tracking-[0.25em] lg:px-4 lg:py-2 lg:tracking-[0.3em]"
                >
                  Usa posizione
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="Lat"
                    value={manualLat}
                    onChange={(event) => setManualLat(event.target.value)}
                    className="w-20 rounded-full border border-slate-700/60 bg-slate-900/70 px-3 py-1 text-[10px] text-slate-100/90 outline-none transition focus:border-cyan-300/70 sm:w-24 sm:py-1.5 sm:text-[11px] lg:py-2 lg:text-xs"
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="Lon"
                    value={manualLon}
                    onChange={(event) => setManualLon(event.target.value)}
                    className="w-20 rounded-full border border-slate-700/60 bg-slate-900/70 px-3 py-1 text-[10px] text-slate-100/90 outline-none transition focus:border-cyan-300/70 sm:w-24 sm:py-1.5 sm:text-[11px] lg:py-2 lg:text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleManualLocation}
                    className="rounded-full border border-slate-700/60 bg-slate-900/70 px-2.5 py-1 text-[9px] uppercase tracking-[0.2em] text-slate-100/90 transition hover:border-slate-500/80 hover:text-white sm:px-3 sm:py-1.5 sm:text-[10px] sm:tracking-[0.25em] lg:px-4 lg:py-2 lg:tracking-[0.3em]"
                  >
                    Calcola
                  </button>
                </div>
              </div>

              {locationLabel && (
                <p className="mt-2 text-[11px] text-slate-300/80">
                  Posizione: {locationLabel}
                </p>
              )}
              {tleError && (
                <p className="mt-2 text-[11px] text-rose-200">
                  TLE error: {tleError}
                </p>
              )}
              {passError && (
                <p className="mt-2 text-[11px] text-rose-200">
                  {passError}
                </p>
              )}
              {passLoading && (
                <p className="mt-2 text-[11px] text-slate-300/80">
                  Calcolo passaggi in corso…
                </p>
              )}
              {!passLoading && passes && passes.length > 0 && (
                <ul className="mt-2 space-y-1.5 text-[11px] text-slate-200">
                  {passes.map((pass) => (
                    <li key={pass.start.toISOString()} className="flex flex-wrap gap-2">
                      <span>
                        {pass.start.toLocaleTimeString()} →{" "}
                        {pass.end.toLocaleTimeString()}
                      </span>
                      <span className="text-slate-400">
                        {Math.round(pass.durationSec / 60)} min
                      </span>
                      <span className="text-cyan-200">
                        max {pass.maxElevationDeg}°
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {!passLoading && passes && passes.length === 0 && (
                <p className="mt-2 text-[11px] text-slate-300/80">
                  Nessun passaggio sopra {MIN_ELEVATION_DEG}° nelle prossime{" "}
                  {PASS_LOOKAHEAD_HOURS} ore.
                </p>
              )}
              {!passLoading && !passes && (
                <p className="mt-2 text-[11px] text-slate-300/60">
                  Seleziona una posizione per calcolare i passaggi.
                </p>
              )}
            </div>

            <div className="mt-6 flex flex-col gap-2 text-xs text-slate-300/70 sm:flex-row sm:items-center sm:justify-between">
              <span>Last updated: {lastUpdated ?? "--"}</span>
              <span>ISS NORAD ID: 25544</span>
            </div>
          </section>
        ) : (
          <div className="pointer-events-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFollowIss((prev) => !prev)}
              className={`rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-[0.2em] transition backdrop-blur-xl sm:px-3 sm:py-1.5 sm:text-[10px] sm:tracking-[0.25em] lg:px-4 lg:py-2 lg:text-xs lg:tracking-[0.35em] ${
                followIss
                  ? "border-cyan-200/50 bg-cyan-300/15 text-cyan-50"
                  : "border-slate-700/60 bg-slate-900/70 text-slate-100/90 hover:border-slate-500/80 hover:text-white"
              }`}
            >
              {followIss ? "Segui ISS" : "Libera mappa"}
            </button>
            <button
              type="button"
              onClick={() => setShowFootprint((prev) => !prev)}
              title={`Area visibile con elevazione ≥ ${FOOTPRINT_MIN_ELEV_DEG}°`}
              className={`rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-[0.2em] transition backdrop-blur-xl sm:px-3 sm:py-1.5 sm:text-[10px] sm:tracking-[0.25em] lg:px-4 lg:py-2 lg:text-xs lg:tracking-[0.35em] ${
                showFootprint
                  ? "border-emerald-200/50 bg-emerald-300/15 text-emerald-50"
                  : "border-slate-700/60 bg-slate-900/70 text-slate-100/90 hover:border-slate-500/80 hover:text-white"
              }`}
            >
              {showFootprint ? "Footprint on" : "Footprint off"}
            </button>
            {!followIss && (
              <button
                type="button"
                onClick={handleResetView}
                className="rounded-full border border-slate-700/60 bg-slate-900/70 px-2.5 py-1 text-[9px] uppercase tracking-[0.2em] text-slate-100/90 backdrop-blur-xl transition hover:border-slate-500/80 hover:text-white sm:px-3 sm:py-1.5 sm:text-[10px] sm:tracking-[0.25em] lg:px-4 lg:py-2 lg:text-xs lg:tracking-[0.35em]"
              >
                Reset vista
              </button>
            )}
            <button
              type="button"
              onClick={() => setInfoOpen(true)}
              className="rounded-full border border-slate-700/60 bg-slate-900/70 px-3 py-1 text-[9px] uppercase tracking-[0.2em] text-slate-100/90 backdrop-blur-xl transition hover:border-slate-500/80 hover:text-white sm:px-4 sm:py-1.5 sm:text-[10px] sm:tracking-[0.25em] lg:px-5 lg:py-2 lg:text-xs lg:tracking-[0.35em]"
            >
              Apri info
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
