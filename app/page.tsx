"use client";

import { useEffect, useState } from "react";

type IssData = {
  latitude: number;
  longitude: number;
  altitude: number;
  velocity: number;
  timestamp: number;
};

const ISS_URL = "https://api.wheretheiss.at/v1/satellites/25544";
const REFRESH_MS = 5000;

export default function Home() {
  const [data, setData] = useState<IssData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.2),_transparent_50%),radial-gradient(circle_at_30%_20%,_rgba(236,72,153,0.25),_transparent_45%),linear-gradient(120deg,_#0f172a,_#020617_60%)] text-slate-100">
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center px-6 py-16">
        <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/5 p-10 shadow-[0_25px_60px_-40px_rgba(15,23,42,0.9)] backdrop-blur-2xl">
          <div className="pointer-events-none absolute inset-0 opacity-60">
            <div className="absolute -top-24 right-10 h-48 w-48 rounded-full bg-cyan-300/20 blur-3xl" />
            <div className="absolute bottom-0 left-10 h-56 w-56 rounded-full bg-fuchsia-400/20 blur-3xl" />
          </div>
          <div className="relative flex flex-col gap-6">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-cyan-200/80">
                International Space Station
              </p>
              <h1 className="mt-3 text-4xl font-semibold text-white sm:text-5xl">
                Live ISS Coordinates
              </h1>
              <p className="mt-4 text-base text-slate-300/80">
                Updated every 5 seconds from wheretheiss.at
              </p>
            </div>

            {loading && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-slate-200 shadow-[inset_0_0_40px_rgba(148,163,184,0.1)]">
                Fetching live telemetry…
              </div>
            )}

            {error && !loading && (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/15 p-6 text-rose-200 shadow-[inset_0_0_35px_rgba(244,63,94,0.2)]">
                Unable to load ISS data: {error}
              </div>
            )}

            {!loading && !error && data && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[inset_0_0_50px_rgba(148,163,184,0.08)]">
                  <p className="text-[11px] uppercase tracking-[0.35em] text-slate-300/80">
                    Latitude
                  </p>
                  <p className="mt-3 text-3xl font-semibold text-white">
                    {data.latitude.toFixed(4)}°
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[inset_0_0_50px_rgba(148,163,184,0.08)]">
                  <p className="text-[11px] uppercase tracking-[0.35em] text-slate-300/80">
                    Longitude
                  </p>
                  <p className="mt-3 text-3xl font-semibold text-white">
                    {data.longitude.toFixed(4)}°
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[inset_0_0_50px_rgba(148,163,184,0.08)]">
                  <p className="text-[11px] uppercase tracking-[0.35em] text-slate-300/80">
                    Altitude (km)
                  </p>
                  <p className="mt-3 text-3xl font-semibold text-white">
                    {data.altitude.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[inset_0_0_50px_rgba(148,163,184,0.08)]">
                  <p className="text-[11px] uppercase tracking-[0.35em] text-slate-300/80">
                    Velocity (km/h)
                  </p>
                  <p className="mt-3 text-3xl font-semibold text-white">
                    {data.velocity.toFixed(2)}
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 text-xs text-slate-300/70 sm:flex-row sm:items-center sm:justify-between">
              <span>Last updated: {lastUpdated ?? "--"}</span>
              <span>ISS NORAD ID: 25544</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
