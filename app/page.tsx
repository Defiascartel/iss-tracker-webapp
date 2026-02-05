"use client";

import L from "leaflet";
import { useEffect, useRef, useState } from "react";

type IssData = {
  latitude: number;
  longitude: number;
  altitude: number;
  velocity: number;
  timestamp: number;
};

const ISS_URL = "https://api.wheretheiss.at/v1/satellites/25544";
const REFRESH_MS = 5000;
const TRAIL_MAX_POINTS = 200;
const OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export default function Home() {
  const [data, setData] = useState<IssData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(true);
  const [followIss, setFollowIss] = useState(true);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const trailLineRef = useRef<L.Polyline | null>(null);
  const trailRef = useRef<[number, number][]>([]);
  const latestDataRef = useRef<IssData | null>(null);
  const hasCenteredRef = useRef(false);
  const followRef = useRef(true);

  const updateMapFromData = () => {
    const map = mapRef.current;
    const latest = latestDataRef.current;
    if (!map || !latest) return;

    const current: [number, number] = [latest.longitude, latest.latitude];
    trailRef.current = [...trailRef.current, current].slice(-TRAIL_MAX_POINTS);

    const latlng: L.LatLngExpression = [latest.latitude, latest.longitude];

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

    const trailLatLngs: L.LatLngTuple[] = trailRef.current.map(([lng, lat]) => [
      lat,
      lng,
    ]);

    if (!trailLineRef.current) {
      trailLineRef.current = L.polyline(trailLatLngs, {
        color: "rgba(14, 165, 233, 0.9)",
        weight: 2.5,
      }).addTo(map);
    } else {
      trailLineRef.current.setLatLngs(trailLatLngs);
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
    latestDataRef.current = data;
    updateMapFromData();
  }, [data]);

  useEffect(() => {
    followRef.current = followIss;
  }, [followIss]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      minZoom: 1,
      maxZoom: 12,
    }).setView([0, 0], 1.6);

    L.tileLayer(OSM_TILES, {
      attribution: OSM_ATTRIBUTION,
      maxZoom: 19,
      crossOrigin: true,
    }).addTo(map);

    L.control.zoom({ position: "topright" }).addTo(map);

    map.on("dragstart", () => setFollowIss(false));
    map.on("zoomstart", () => setFollowIss(false));

    mapRef.current = map;
    updateMapFromData();

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      trailLineRef.current = null;
    };
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      <div ref={mapContainerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.18),_transparent_55%),radial-gradient(circle_at_20%_20%,_rgba(236,72,153,0.22),_transparent_50%)]" />

      <main className="relative z-10 flex h-full w-full items-end justify-center px-6 pb-6 pt-20">
        {infoOpen ? (
          <section className="pointer-events-auto w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/20 bg-white/10 p-6 shadow-[0_30px_80px_-50px_rgba(15,23,42,0.9)] backdrop-blur-2xl sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.4em] text-cyan-200/80">
                  International Space Station
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
                  Live ISS Tracker
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFollowIss((prev) => !prev)}
                  className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.35em] transition ${
                    followIss
                      ? "border-cyan-200/60 bg-cyan-200/20 text-cyan-50"
                      : "border-white/20 bg-white/10 text-slate-100/80 hover:border-white/40 hover:text-white"
                  }`}
                >
                  {followIss ? "Segui ISS" : "Libera mappa"}
                </button>
                {!followIss && (
                  <button
                    type="button"
                    onClick={handleResetView}
                    className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs uppercase tracking-[0.35em] text-slate-100/80 transition hover:border-white/40 hover:text-white"
                  >
                    Reset vista
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setInfoOpen(false)}
                  className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs uppercase tracking-[0.35em] text-slate-100/80 transition hover:border-white/40 hover:text-white"
                >
                  Chiudi
                </button>
              </div>
            </div>

            <p className="mt-4 text-sm text-slate-200/80">
              Aggiornamenti ogni 5 secondi. La traiettoria mostra gli ultimi punti
              ricevuti.
            </p>

            {loading && (
              <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5 text-slate-200 shadow-[inset_0_0_35px_rgba(148,163,184,0.1)]">
                Fetching live telemetry…
              </div>
            )}

            {error && !loading && (
              <div className="mt-6 rounded-2xl border border-rose-500/40 bg-rose-500/15 p-5 text-rose-200 shadow-[inset_0_0_35px_rgba(244,63,94,0.2)]">
                Unable to load ISS data: {error}
              </div>
            )}

            {!loading && !error && data && (
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[inset_0_0_40px_rgba(148,163,184,0.08)]">
                  <p className="text-[10px] uppercase tracking-[0.35em] text-slate-300/80">
                    Latitude
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-white">
                    {data.latitude.toFixed(4)}°
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[inset_0_0_40px_rgba(148,163,184,0.08)]">
                  <p className="text-[10px] uppercase tracking-[0.35em] text-slate-300/80">
                    Longitude
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-white">
                    {data.longitude.toFixed(4)}°
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[inset_0_0_40px_rgba(148,163,184,0.08)]">
                  <p className="text-[10px] uppercase tracking-[0.35em] text-slate-300/80">
                    Altitude (km)
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-white">
                    {data.altitude.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[inset_0_0_40px_rgba(148,163,184,0.08)]">
                  <p className="text-[10px] uppercase tracking-[0.35em] text-slate-300/80">
                    Velocity (km/h)
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-white">
                    {data.velocity.toFixed(2)}
                  </p>
                </div>
              </div>
            )}

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
              className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.35em] transition backdrop-blur-xl ${
                followIss
                  ? "border-cyan-200/60 bg-cyan-200/20 text-cyan-50"
                  : "border-white/20 bg-white/10 text-slate-100/80 hover:border-white/40 hover:text-white"
              }`}
            >
              {followIss ? "Segui ISS" : "Libera mappa"}
            </button>
            {!followIss && (
              <button
                type="button"
                onClick={handleResetView}
                className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs uppercase tracking-[0.35em] text-slate-100/80 backdrop-blur-xl transition hover:border-white/40 hover:text-white"
              >
                Reset vista
              </button>
            )}
            <button
              type="button"
              onClick={() => setInfoOpen(true)}
              className="rounded-full border border-white/20 bg-white/10 px-5 py-2 text-xs uppercase tracking-[0.35em] text-slate-100/80 backdrop-blur-xl transition hover:border-white/40 hover:text-white"
            >
              Apri info
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
