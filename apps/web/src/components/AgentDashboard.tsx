import { useQuery } from "@tanstack/react-query";
import { api, type ActivityRun } from "../lib/api";
import { TrustBadge } from "./TrustBadge";
import {
  Activity,
  Bot,
  CheckCircle2,
  XCircle,
  Clock,
  Database,
  TrendingUp,
  Shield,
  Zap,
  RefreshCw,
} from "lucide-react";

// Map ingestion sources to human-readable pipeline stages
const PIPELINE_STAGES: Array<{
  source: string;
  label: string;
  schedule: string;
  description: string;
  icon: React.ReactNode;
}> = [
  { source: "soldcomps", label: "SoldComps Ingestion", schedule: "Every 15 min", description: "Scrapes recent eBay sold listings for price observations", icon: <Database className="h-4 w-4" /> },
  { source: "reddit", label: "Reddit Sentiment", schedule: "Every 5 min", description: "Scrapes trading card subreddits for social sentiment", icon: <Zap className="h-4 w-4" /> },
  { source: "sentiment_rollup", label: "Sentiment Rollup", schedule: "Hourly", description: "Aggregates raw sentiment into 24h/7d/30d scores", icon: <TrendingUp className="h-4 w-4" /> },
  { source: "pricecharting", label: "PriceCharting", schedule: "Daily 2 AM", description: "Imports reference prices from PriceCharting catalog", icon: <Database className="h-4 w-4" /> },
  { source: "population", label: "Population Reports", schedule: "Daily 3 AM", description: "Fetches PSA/BGS graded population data", icon: <Shield className="h-4 w-4" /> },
  { source: "anomaly", label: "Anomaly Detection", schedule: "Daily 4 AM", description: "Flags outlier sales before feature computation", icon: <Activity className="h-4 w-4" /> },
  { source: "features", label: "Feature Computation", schedule: "Daily 5 AM", description: "Computes aggregates and ML features from clean data", icon: <Bot className="h-4 w-4" /> },
  { source: "predictions", label: "Price Predictions", schedule: "Daily 6 AM", description: "Generates fair values via batch ML scoring", icon: <TrendingUp className="h-4 w-4" /> },
  { source: "archive", label: "Data Archive", schedule: "Sunday 1 AM", description: "Archives old observations to R2 for cold storage", icon: <Database className="h-4 w-4" /> },
];

export function AgentDashboard() {
  const { data: health, isLoading: healthLoading, refetch: refetchHealth } = useQuery({
    queryKey: ["system-health"],
    queryFn: api.getSystemHealth,
    refetchInterval: 30_000,
  });

  const { data: activityData, isLoading: activityLoading, refetch: refetchActivity } = useQuery({
    queryKey: ["system-activity"],
    queryFn: () => api.getActivity(30),
    refetchInterval: 30_000,
  });

  const runs = activityData?.runs || [];

  // Build a map of latest run per source
  const latestBySource = new Map<string, ActivityRun>();
  for (const run of runs) {
    if (!latestBySource.has(run.source)) {
      latestBySource.set(run.source, run);
    }
  }

  const handleRefresh = () => {
    refetchHealth();
    refetchActivity();
  };

  const overallStatus = health?.status || "unknown";
  const statusColor = overallStatus === "healthy" ? "text-buy" : overallStatus === "degraded" ? "text-sell" : overallStatus === "warning" ? "text-hold" : "text-text-muted";
  const statusBg = overallStatus === "healthy" ? "bg-buy/10 border-buy/20" : overallStatus === "degraded" ? "bg-sell/10 border-sell/20" : overallStatus === "warning" ? "bg-hold/10 border-hold/20" : "bg-bg-secondary border-border";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Pipeline Operations</h1>
          <p className="text-sm text-text-secondary">System health, scheduled jobs, and activity log</p>
        </div>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-1.5 rounded-md bg-bg-secondary px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover min-h-[44px]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {/* ─── Health Summary ─── */}
      <div className={`rounded-lg border p-5 shadow-sm ${statusBg}`}>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Pipeline Status</p>
            <p className={`mt-1 text-2xl font-extrabold capitalize ${statusColor}`}>
              {healthLoading ? "..." : overallStatus}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Predictions</p>
            {health?.predictions ? (
              <>
                <p className="mt-1 text-lg font-bold text-text-primary">
                  {health.predictions.hoursSincePrediction !== null ? `${health.predictions.hoursSincePrediction}h ago` : "None"}
                </p>
                <TrustBadge variant={health.predictions.stale ? "stale" : "fresh"} />
              </>
            ) : (
              <p className="mt-1 text-lg font-bold text-text-muted">--</p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Model</p>
            <p className="mt-1 text-lg font-bold text-text-primary">{health?.model?.model_version || "None"}</p>
            <p className="text-[11px] text-text-muted">{health?.model?.cards_scored ? `${health.model.cards_scored} cards scored` : ""}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Catalog</p>
            <p className="mt-1 text-lg font-bold text-text-primary">{health?.catalog?.totalCards?.toLocaleString() || "0"}</p>
            <p className="text-[11px] text-text-muted">total cards</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Drift</p>
            {health?.drift ? (
              <>
                <p className={`mt-1 text-lg font-bold capitalize ${
                  health.drift.status === "healthy" ? "text-buy" : health.drift.status === "degraded" ? "text-sell" : "text-hold"
                }`}>
                  {health.drift.status}
                </p>
                <p className="text-[11px] text-text-muted">MDAPE {health.drift.mdapePct}%</p>
              </>
            ) : (
              <p className="mt-1 text-lg font-bold text-text-muted">No data</p>
            )}
          </div>
        </div>
      </div>

      {/* ─── Autonomous Agents ─── */}
      <AgentCards />

      {/* ─── Pipeline Stages ─── */}
      <div className="rounded-lg border border-border bg-bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Bot className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-bold text-text-primary">Scheduled Jobs</h2>
        </div>
        <div className="divide-y divide-border">
          {PIPELINE_STAGES.map((stage) => {
            const latest = latestBySource.get(stage.source);
            return (
              <PipelineRow key={stage.source} stage={stage} latestRun={latest || null} />
            );
          })}
        </div>
      </div>

      {/* ─── Activity Log ─── */}
      <div className="rounded-lg border border-border bg-bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Activity className="h-4 w-4 text-info" />
          <h2 className="text-sm font-bold text-text-primary">Recent Activity</h2>
          <span className="text-xs text-text-muted">Last {runs.length} runs</span>
        </div>
        {activityLoading ? (
          <div className="flex h-32 items-center justify-center">
            <RefreshCw className="h-4 w-4 animate-spin text-text-muted" />
          </div>
        ) : runs.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2">
            <p className="text-sm text-text-muted">No pipeline runs recorded yet</p>
            <p className="text-xs text-text-muted">Scheduled jobs will appear here as they execute</p>
          </div>
        ) : (
          <div className="max-h-[400px] overflow-y-auto">
            {runs.map((run, i) => (
              <ActivityRow key={`${run.source}-${run.startedAt}-${i}`} run={run} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PipelineRow({ stage, latestRun }: {
  stage: typeof PIPELINE_STAGES[number];
  latestRun: ActivityRun | null;
}) {
  const status = latestRun?.status || "never";
  const isOk = status === "completed";
  const isFailed = status === "failed";

  let statusIcon: React.ReactNode;
  let statusLabel: string;
  let statusClass: string;

  if (!latestRun) {
    statusIcon = <Clock className="h-3.5 w-3.5 text-text-muted" />;
    statusLabel = "Never run";
    statusClass = "text-text-muted";
  } else if (isOk) {
    statusIcon = <CheckCircle2 className="h-3.5 w-3.5 text-buy" />;
    statusLabel = "OK";
    statusClass = "text-buy";
  } else if (isFailed) {
    statusIcon = <XCircle className="h-3.5 w-3.5 text-sell" />;
    statusLabel = "Failed";
    statusClass = "text-sell";
  } else {
    statusIcon = <RefreshCw className="h-3.5 w-3.5 animate-spin text-hold" />;
    statusLabel = "Running";
    statusClass = "text-hold";
  }

  const timeAgo = latestRun?.completedAt ? formatTimeAgo(latestRun.completedAt) : null;
  const duration = latestRun?.durationMs ? formatDuration(latestRun.durationMs) : null;
  const records = latestRun?.records ?? null;

  return (
    <div className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-bg-hover">
      <div className="shrink-0 text-text-muted">{stage.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-text-primary">{stage.label}</p>
          <span className="rounded-sm bg-bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-muted">{stage.schedule}</span>
        </div>
        <p className="text-xs text-text-muted">{stage.description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-4 text-right">
        {records !== null && isOk && (
          <span className="text-xs text-text-secondary">{records} records</span>
        )}
        {duration && (
          <span className="text-xs text-text-muted">{duration}</span>
        )}
        <div className="flex items-center gap-1.5 min-w-[80px] justify-end">
          {statusIcon}
          <span className={`text-xs font-medium ${statusClass}`}>{statusLabel}</span>
        </div>
        {timeAgo && (
          <span className="text-[11px] text-text-muted min-w-[60px] text-right">{timeAgo}</span>
        )}
      </div>
    </div>
  );
}

function ActivityRow({ run }: { run: ActivityRun }) {
  const isOk = run.status === "completed";
  const isFailed = run.status === "failed";
  const timeAgo = run.completedAt ? formatTimeAgo(run.completedAt) : run.startedAt ? formatTimeAgo(run.startedAt) : "";
  const duration = run.durationMs ? formatDuration(run.durationMs) : null;

  const stageInfo = PIPELINE_STAGES.find((s) => s.source === run.source);
  const label = stageInfo?.label || run.source;

  return (
    <div className={`flex items-center gap-3 border-b border-border px-5 py-2.5 last:border-b-0 ${isFailed ? "bg-sell/3" : ""}`}>
      {isOk ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-buy" />
      ) : isFailed ? (
        <XCircle className="h-3.5 w-3.5 shrink-0 text-sell" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-hold" />
      )}
      <span className="text-sm font-medium text-text-primary min-w-[140px]">{label}</span>
      {isFailed && run.error && (
        <span className="truncate text-xs text-sell flex-1">{run.error}</span>
      )}
      {isOk && run.records > 0 && (
        <span className="text-xs text-text-secondary">{run.records} records</span>
      )}
      {!isFailed && !run.records && <span className="flex-1" />}
      {duration && <span className="text-xs text-text-muted shrink-0">{duration}</span>}
      <span className="text-[11px] text-text-muted shrink-0 min-w-[60px] text-right">{timeAgo}</span>
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)}h ago`;
  return `${Math.round(ms / 86400_000)}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

// ─── Autonomous Agents Section ───

function AgentCards() {
  const { data: monitor, refetch: refetchMonitor } = useQuery({
    queryKey: ["agent-monitor"],
    queryFn: api.getMonitorStatus,
    refetchInterval: 30_000,
  });

  const { data: intel } = useQuery({
    queryKey: ["agent-intel"],
    queryFn: api.getIntelligenceLatest,
    refetchInterval: 60_000,
  });

  const { data: competitors, refetch: refetchCompetitors } = useQuery({
    queryKey: ["agent-competitors"],
    queryFn: api.getCompetitorStatus,
    refetchInterval: 60_000,
  });

  const { data: recs, refetch: refetchRecs } = useQuery({
    queryKey: ["agent-recs"],
    queryFn: api.getRecommendationStatus,
    refetchInterval: 30_000,
  });

  const handleTriggerMonitor = async () => {
    await api.triggerMonitorCheck();
    refetchMonitor();
  };

  const handleTriggerCompetitors = async () => {
    await api.triggerCompetitorScan();
    refetchCompetitors();
  };

  const handleGenerateRecs = async () => {
    await api.generateRecommendations();
    refetchRecs();
  };

  const handleGenerateReport = async () => {
    await api.generateIntelligenceReport();
  };

  return (
    <div className="rounded-lg border border-border bg-bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <Bot className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-bold text-text-primary">Autonomous Agents</h2>
        <span className="text-xs text-text-muted">4 Durable Objects</span>
      </div>

      {/* Market Intelligence — full width */}
      <div className="border-b border-border p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-info" />
            <span className="text-sm font-bold text-text-primary">Market Intelligence</span>
            {intel && (
              <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                intel.marketSentiment === "bullish" ? "bg-buy/10 text-buy" :
                intel.marketSentiment === "bearish" ? "bg-sell/10 text-sell" : "bg-bg-secondary text-text-muted"
              }`}>{intel.marketSentiment}</span>
            )}
            {intel?.date && <span className="text-xs text-text-muted">{intel.date}</span>}
          </div>
          <button onClick={handleGenerateReport} className="rounded-md bg-bg-secondary px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover min-h-[36px]">Generate Report</button>
        </div>
        {intel?.summary ? (
          <p className="text-sm text-text-secondary leading-relaxed">{intel.summary}</p>
        ) : (
          <p className="text-sm text-text-muted italic">No market report generated yet. Click "Generate Report" to create one.</p>
        )}
        {intel?.highlights && intel.highlights.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {intel.highlights.map((h, i) => (
              <span key={i} className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                h.impact === "positive" ? "bg-buy/10 text-buy" :
                h.impact === "negative" ? "bg-sell/10 text-sell" : "bg-bg-secondary text-text-muted"
              }`}>
                {h.title}: {h.detail}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 3 operational agents — equal columns */}
      <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
        {/* Price Monitor */}
        <div className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-accent" />
              <span className="text-sm font-bold text-text-primary">Price Monitor</span>
            </div>
            <button onClick={handleTriggerMonitor} className="rounded-md bg-bg-secondary px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover min-h-[36px]">Check Now</button>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold text-accent">{monitor?.activeAlerts ?? 0}</p>
              <p className="text-[11px] text-text-muted">Active Alerts</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-text-primary">{monitor?.totalChecks ?? 0}</p>
              <p className="text-[11px] text-text-muted">Checks Run</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-text-primary">{monitor?.totalAnomalies ?? 0}</p>
              <p className="text-[11px] text-text-muted">Anomalies</p>
            </div>
          </div>
          {monitor?.recentAlerts && monitor.recentAlerts.length > 0 && (
            <div className="mt-3 space-y-1">
              {monitor.recentAlerts.slice(0, 3).map((a, i) => (
                <div key={i} className="flex items-center justify-between rounded-md bg-bg-secondary px-2.5 py-1.5 text-xs">
                  <span className="truncate text-text-primary">{a.cardName}</span>
                  <span className={a.type.includes("spike") || a.type === "viral" ? "font-semibold text-buy" : "font-semibold text-sell"}>
                    {a.type === "viral" ? `${a.magnitude}x` : `${a.magnitude > 0 ? "+" : ""}${a.magnitude}%`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Competitor Tracker */}
        <div className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-warning" />
              <span className="text-sm font-bold text-text-primary">Competitor Tracker</span>
            </div>
            <button onClick={handleTriggerCompetitors} className="rounded-md bg-bg-secondary px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover min-h-[36px]">Scan</button>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold text-sell">{competitors?.overpriced ?? 0}</p>
              <p className="text-[11px] text-text-muted">Overpriced</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-buy">{competitors?.underpriced ?? 0}</p>
              <p className="text-[11px] text-text-muted">Underpriced</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-text-primary">{competitors?.totalScans ?? 0}</p>
              <p className="text-[11px] text-text-muted">Scans</p>
            </div>
          </div>
          {competitors?.lastScan && (
            <p className="mt-3 text-xs text-text-muted">Last scan: {formatTimeAgo(competitors.lastScan)}</p>
          )}
        </div>

        {/* Pricing Recommendations */}
        <div className="p-5 sm:border-l sm:border-border">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-buy" />
              <span className="text-sm font-bold text-text-primary">Recommendations</span>
            </div>
            <button onClick={handleGenerateRecs} className="rounded-md bg-bg-secondary px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover min-h-[36px]">Generate</button>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold text-accent">{recs?.pendingCount ?? 0}</p>
              <p className="text-[11px] text-text-muted">Pending</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-buy">{recs?.stats?.totalApproved ?? 0}</p>
              <p className="text-[11px] text-text-muted">Approved</p>
            </div>
          </div>
          {recs?.pendingCount ? (
            <div className="mt-3 flex gap-2">
              <span className="rounded-md bg-buy/10 px-2.5 py-1 text-xs font-medium text-buy">{recs.pendingByAction?.buy ?? 0} Buy</span>
              <span className="rounded-md bg-sell/10 px-2.5 py-1 text-xs font-medium text-sell">{recs.pendingByAction?.sell ?? 0} Sell</span>
              <span className="rounded-md bg-hold/10 px-2.5 py-1 text-xs font-medium text-hold">{recs.pendingByAction?.reprice ?? 0} Reprice</span>
            </div>
          ) : null}
          <div className="mt-2 flex gap-3 text-xs text-text-muted">
            <span>Rejected: {recs?.stats?.totalRejected ?? 0}</span>
            <span>Expired: {recs?.stats?.totalExpired ?? 0}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Compact Agent Summary for the homepage ───

export function AgentSummary() {
  const { data: monitor } = useQuery({ queryKey: ["agent-monitor"], queryFn: api.getMonitorStatus, refetchInterval: 60_000 });
  const { data: intel } = useQuery({ queryKey: ["agent-intel"], queryFn: api.getIntelligenceLatest, refetchInterval: 60_000 });
  const { data: competitors } = useQuery({ queryKey: ["agent-competitors"], queryFn: api.getCompetitorStatus, refetchInterval: 60_000 });
  const { data: recs } = useQuery({ queryKey: ["agent-recs"], queryFn: api.getRecommendationStatus, refetchInterval: 60_000 });

  return (
    <div className="rounded-lg border border-border bg-bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-bold text-text-primary">AI Agents</h2>
          <span className="rounded-full bg-buy/10 px-2 py-0.5 text-[10px] font-bold text-buy">4 active</span>
        </div>
      </div>

      {/* Market Intel — show summary if available */}
      {intel?.summary && (
        <div className="border-b border-border px-5 py-3">
          <div className="flex items-center gap-2 mb-1">
            <Bot className="h-3.5 w-3.5 text-info" />
            <span className="text-xs font-semibold text-text-primary">Daily Market Briefing</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
              intel.marketSentiment === "bullish" ? "bg-buy/10 text-buy" :
              intel.marketSentiment === "bearish" ? "bg-sell/10 text-sell" : "bg-bg-secondary text-text-muted"
            }`}>{intel.marketSentiment}</span>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed line-clamp-3">{intel.summary}</p>
        </div>
      )}

      {/* Agent stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border">
        <div className="px-4 py-3 text-center">
          <p className="text-xl font-bold text-accent">{monitor?.activeAlerts ?? 0}</p>
          <p className="text-[11px] text-text-muted">Price Alerts</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-xl font-bold text-sell">{competitors?.overpriced ?? 0}</p>
          <p className="text-[11px] text-text-muted">Overpriced</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-xl font-bold text-buy">{competitors?.underpriced ?? 0}</p>
          <p className="text-[11px] text-text-muted">Underpriced</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-xl font-bold text-accent">{recs?.pendingCount ?? 0}</p>
          <p className="text-[11px] text-text-muted">Pending Actions</p>
        </div>
      </div>
    </div>
  );
}
