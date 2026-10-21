"use client";

import { useState, useEffect } from "react";
import {
  Search,
  Server,
  Play,
  CheckCircle2,
  AlertTriangle,
  Info,
  Loader2,
  RefreshCw,
  Code,
  Radio,
  Tv,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import MediaPlayer from "@/components/media-player";
import {
  ANIMESDK_PROVIDERS,
  type AnimeSdkProviderId,
  type ResolveResponse,
} from "@/lib/services/animeSdkService";

const SAMPLE_TITLES = [
  "Frieren",
  "Attack on Titan",
  "Death Note",
  "Jujutsu Kaisen",
  "One Piece",
  "Sousou no Frieren",
];

export default function StreamTesterClient() {
  const [query, setQuery] = useState("Frieren");
  const [activeTitle, setActiveTitle] = useState("Frieren");
  const [provider, setProvider] = useState<string>("auto");
  const [episodeNum, setEpisodeNum] = useState<number>(1);

  // Server health state
  const [serverHealth, setServerHealth] = useState<{
    loaded: boolean;
    online: boolean;
    providers: string[];
    proxy: boolean;
  }>({
    loaded: false,
    online: false,
    providers: [],
    proxy: false,
  });

  // Resolution state
  const [resolving, setResolving] = useState(false);
  const [result, setResult] = useState<ResolveResponse | null>(null);
  const [rawInspectorOpen, setRawInspectorOpen] = useState(false);

  // Check health on mount
  const checkHealth = async () => {
    try {
      const res = await fetch("/api/anime-sdk/providers", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setServerHealth({
          loaded: true,
          online: Boolean(data.serverOnline),
          providers: Array.isArray(data.providers)
            ? data.providers.filter((p: { available: boolean }) => p.available).map((p: { id: string }) => p.id)
            : [],
          proxy: Boolean(data.proxyEnabled),
        });
      } else {
        setServerHealth({ loaded: true, online: false, providers: [], proxy: false });
      }
    } catch {
      setServerHealth({ loaded: true, online: false, providers: [], proxy: false });
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  // Run resolution
  const handleResolve = async (titleToResolve = query, prov = provider, ep = episodeNum) => {
    if (!titleToResolve.trim()) return;

    setResolving(true);
    setActiveTitle(titleToResolve.trim());

    try {
      const url = `/api/anime-sdk/resolve?title=${encodeURIComponent(
        titleToResolve.trim()
      )}&provider=${encodeURIComponent(prov)}&episode=${ep}&language=sub`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : "Failed to fetch stream resolution.",
      });
    } finally {
      setResolving(false);
    }
  };

  // Initial resolution on mount
  useEffect(() => {
    handleResolve("Frieren", "auto", 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      {/* Page Title & Status Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">AnimeSDK Streaming Workbench</h1>
            <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-400">
              Experimental
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Test real-time anime stream resolution, multi-provider auto fallback, and HLS video playback.
          </p>
        </div>

        {/* Server status pill */}
        <div className="flex items-center gap-2">
          {serverHealth.loaded ? (
            serverHealth.online ? (
              <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                SDK Server Online (Port 4000)
              </div>
            ) : (
              <div className="flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
                <span className="h-2 w-2 rounded-full bg-destructive" />
                SDK Server Offline
              </div>
            )
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking SDK server...
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={checkHealth}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title="Refresh Server Health"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Offline Alert Box if Server is Down */}
      {serverHealth.loaded && !serverHealth.online && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive flex items-start gap-3">
          <Server className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">AnimeSDK Standalone Server is not running</p>
            <p className="mt-1 text-xs text-muted-foreground">
              To start the local streaming engine and HLS proxy on port 4000, open a terminal in the project directory and run:
            </p>
            <pre className="mt-2 rounded bg-muted/80 p-2 font-mono text-xs text-foreground">
              npm run sdk:server
            </pre>
          </div>
        </div>
      )}

      {/* Search and Provider Controls */}
      <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12 items-center">
          {/* Query input */}
          <div className="md:col-span-6 relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleResolve(query, provider, episodeNum)}
              placeholder="Enter anime title (e.g. Frieren, Attack on Titan)..."
              className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Provider selector */}
          <div className="md:col-span-4">
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                handleResolve(query, e.target.value, episodeNum);
              }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {ANIMESDK_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Resolve trigger button */}
          <div className="md:col-span-2">
            <Button
              onClick={() => handleResolve(query, provider, episodeNum)}
              disabled={resolving || !query.trim()}
              className="w-full text-xs font-semibold"
            >
              {resolving ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Resolving...
                </>
              ) : (
                <>
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Test Stream
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Quick test chip suggestions */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted-foreground">
          <span>Quick test:</span>
          {SAMPLE_TITLES.map((sample) => (
            <button
              key={sample}
              onClick={() => {
                setQuery(sample);
                handleResolve(sample, provider, 1);
              }}
              className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs text-foreground hover:bg-muted transition-colors"
            >
              {sample}
            </button>
          ))}
        </div>
      </div>

      {/* Player Section: Live Nayozu Media Player with Provider Selector */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Interactive Player Preview</h2>
          {result?.success && (
            <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-500/30">
              Stream Live: {result.providerName}
            </Badge>
          )}
        </div>

        <MediaPlayer
          key={`${activeTitle}-${provider}`}
          animeId="test-stream"
          title={activeTitle}
          episodes={[]}
          initialProvider={provider}
        />
      </div>

      {/* Diagnostics & Stream Inspector Panel */}
      <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Stream Resolution Diagnostics</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRawInspectorOpen(!rawInspectorOpen)}
            className="text-xs text-muted-foreground"
          >
            {rawInspectorOpen ? "Hide Raw JSON" : "View Raw JSON"}
          </Button>
        </div>

        {result ? (
          <div className="space-y-3 text-xs">
            {/* Resolution summary grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border p-3 bg-background">
                <span className="text-muted-foreground block text-[11px]">Resolution Status</span>
                <span className={`font-semibold ${result.success ? "text-emerald-400" : "text-destructive"}`}>
                  {result.success ? "Success (Playable)" : "Failed"}
                </span>
              </div>
              <div className="rounded-lg border p-3 bg-background">
                <span className="text-muted-foreground block text-[11px]">Active Provider</span>
                <span className="font-semibold text-foreground">
                  {result.providerName || result.provider || provider}
                </span>
              </div>
              <div className="rounded-lg border p-3 bg-background">
                <span className="text-muted-foreground block text-[11px]">Resolved Title</span>
                <span className="font-semibold text-foreground truncate block">
                  {result.mediaTitle || activeTitle}
                </span>
              </div>
              <div className="rounded-lg border p-3 bg-background">
                <span className="text-muted-foreground block text-[11px]">Episodes Found</span>
                <span className="font-semibold text-foreground">
                  {result.episodes ? `${result.episodes.length} episodes` : "0"}
                </span>
              </div>
            </div>

            {/* Error or Warning details */}
            {result.error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive">
                <p className="font-semibold">Error Message:</p>
                <p className="mt-0.5">{result.error}</p>
              </div>
            )}

            {/* Auto fallback attempts trail */}
            {result.attempts && result.attempts.length > 0 && (
              <div className="space-y-1 rounded-lg border p-3 bg-background">
                <span className="font-semibold text-foreground block mb-1">
                  Auto Fallback Chain Evaluation:
                </span>
                <div className="space-y-1">
                  {result.attempts.map((att, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      {att.status === "success" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      )}
                      <span className="font-mono uppercase font-medium">{att.provider}:</span>
                      <span className="text-muted-foreground">
                        {att.status === "success"
                          ? "Playable HLS stream verified"
                          : att.status === "search_empty"
                          ? "0 search results"
                          : att.status === "no_episodes"
                          ? "No episodes listed"
                          : att.status === "stream_failed"
                          ? "Stream extraction failed"
                          : att.error || "Unknown error"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Subtitle track details */}
            {result.stream?.streams?.[0]?.subtitles && result.stream.streams[0].subtitles.length > 0 && (
              <div className="rounded-lg border p-3 bg-background space-y-1">
                <span className="font-semibold text-foreground block">Verified Subtitles:</span>
                <div className="flex flex-wrap gap-2">
                  {result.stream.streams[0].subtitles.map((sub, idx) => (
                    <Badge key={idx} variant="outline" className="text-[11px]">
                      {sub.label} ({sub.language})
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Raw JSON viewer */}
            {rawInspectorOpen && (
              <div className="space-y-1">
                <span className="text-muted-foreground text-[11px]">Raw JSON Payload:</span>
                <pre className="max-h-60 overflow-auto rounded-lg border bg-muted/80 p-3 font-mono text-[11px] text-foreground">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No stream resolution initiated yet. Click &quot;Test Stream&quot; above to inspect.
          </p>
        )}
      </div>
    </div>
  );
}
