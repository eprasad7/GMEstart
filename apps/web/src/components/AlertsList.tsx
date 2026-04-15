import { useState, useMemo } from "react";
import { AlertTriangle, TrendingUp, TrendingDown, Zap, Eye, X, Clock, ChevronRight, Filter } from "lucide-react";
import { TrustBadge } from "./TrustBadge";
import type { Alert } from "../lib/api";
import { api } from "../lib/api";

interface AlertsListProps {
  alerts: Alert[];
  onResolve: (id: number) => void;
  onRefresh?: () => void;
  onCardClick?: (cardId: string) => void;
  showControls?: boolean;
}

type SortMode = "severity" | "newest" | "type";
type FilterType = "all" | "price_spike" | "price_crash" | "viral_social" | "anomaly_detected" | "new_high" | "new_low";

const alertIcons: Record<string, React.ReactNode> = {
  price_spike: <TrendingUp className="h-4 w-4 text-buy" />,
  price_crash: <TrendingDown className="h-4 w-4 text-sell" />,
  viral_social: <Zap className="h-4 w-4 text-warning" />,
  anomaly_detected: <AlertTriangle className="h-4 w-4 text-danger" />,
  new_high: <TrendingUp className="h-4 w-4 text-accent" />,
  new_low: <TrendingDown className="h-4 w-4 text-danger" />,
};

const SNOOZE_OPTIONS = [
  { label: "1h", minutes: 60 },
  { label: "4h", minutes: 240 },
  { label: "24h", minutes: 1440 },
  { label: "7d", minutes: 10080 },
];

function getSeverity(alert: Alert): "critical" | "warning" | "info" {
  if (alert.magnitude >= 2 || alert.alert_type === "anomaly_detected") return "critical";
  if (alert.magnitude >= 1 || alert.alert_type === "price_crash" || alert.alert_type === "price_spike") return "warning";
  return "info";
}

const severityOrder = { critical: 0, warning: 1, info: 2 };
const severityStyles = {
  critical: { badge: "bg-sell/10 text-sell border-sell/20", dot: "bg-sell", label: "Critical" },
  warning: { badge: "bg-hold/10 text-hold border-hold/20", dot: "bg-hold", label: "Warning" },
  info: { badge: "bg-info/10 text-info border-info/20", dot: "bg-info", label: "Info" },
};

export function AlertsList({ alerts, onResolve, onRefresh, onCardClick, showControls = true }: AlertsListProps) {
  const [sortMode, setSortMode] = useState<SortMode>("severity");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [snoozeMenuId, setSnoozeMenuId] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<number | null>(null);

  const handleSnooze = async (alertId: number, durationMinutes: number) => {
    setPendingAction(alertId);
    setSnoozeMenuId(null);
    try {
      await api.snoozeAlert(alertId, durationMinutes);
      onRefresh?.();
    } catch {
      // Snooze failed — alert stays visible
    } finally {
      setPendingAction(null);
    }
  };

  const handleAssign = async (alertId: number) => {
    const name = prompt("Assign to:");
    if (!name) return;
    setPendingAction(alertId);
    try {
      await api.assignAlert(alertId, name);
      onRefresh?.();
    } catch {
      // Assign failed
    } finally {
      setPendingAction(null);
    }
  };

  const visibleAlerts = useMemo(() => {
    let filtered = alerts.filter((a) => {
      if (filterType !== "all" && a.alert_type !== filterType) return false;
      return true;
    });

    filtered.sort((a, b) => {
      if (sortMode === "severity") {
        const diff = severityOrder[getSeverity(a)] - severityOrder[getSeverity(b)];
        if (diff !== 0) return diff;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (sortMode === "newest") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      return a.alert_type.localeCompare(b.alert_type);
    });

    return filtered;
  }, [alerts, sortMode, filterType]);

  if (alerts.length === 0) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-bg-card shadow-sm">
        <p className="text-sm text-text-muted">No active alerts</p>
        <p className="text-xs text-text-muted">The system will notify you when something needs attention</p>
      </div>
    );
  }

  const grouped = {
    critical: visibleAlerts.filter((a) => getSeverity(a) === "critical"),
    warning: visibleAlerts.filter((a) => getSeverity(a) === "warning"),
    info: visibleAlerts.filter((a) => getSeverity(a) === "info"),
  };

  return (
    <div className="space-y-4">
      {showControls && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md bg-bg-secondary p-0.5">
            {(["severity", "newest", "type"] as SortMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setSortMode(mode)}
                className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors min-h-[32px] ${
                  sortMode === mode ? "bg-bg-card text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-text-muted" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as FilterType)}
              className="rounded-md border border-border bg-bg-primary px-2 py-1 text-xs text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
            >
              <option value="all">All types</option>
              <option value="price_spike">Price spikes</option>
              <option value="price_crash">Price crashes</option>
              <option value="viral_social">Viral social</option>
              <option value="anomaly_detected">Anomalies</option>
              <option value="new_high">New highs</option>
              <option value="new_low">New lows</option>
            </select>
          </div>

          <div className="ml-auto flex items-center gap-2 text-xs text-text-muted">
            {grouped.critical.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-sell" />
                {grouped.critical.length} critical
              </span>
            )}
            {grouped.warning.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-hold" />
                {grouped.warning.length} warning
              </span>
            )}
          </div>
        </div>
      )}

      {sortMode === "severity" ? (
        <>
          {grouped.critical.length > 0 && (
            <AlertGroup severity="critical" alerts={grouped.critical} onResolve={onResolve} onCardClick={onCardClick} snoozeMenuId={snoozeMenuId} setSnoozeMenuId={setSnoozeMenuId} onSnooze={handleSnooze} onAssign={handleAssign} pendingAction={pendingAction} />
          )}
          {grouped.warning.length > 0 && (
            <AlertGroup severity="warning" alerts={grouped.warning} onResolve={onResolve} onCardClick={onCardClick} snoozeMenuId={snoozeMenuId} setSnoozeMenuId={setSnoozeMenuId} onSnooze={handleSnooze} onAssign={handleAssign} pendingAction={pendingAction} />
          )}
          {grouped.info.length > 0 && (
            <AlertGroup severity="info" alerts={grouped.info} onResolve={onResolve} onCardClick={onCardClick} snoozeMenuId={snoozeMenuId} setSnoozeMenuId={setSnoozeMenuId} onSnooze={handleSnooze} onAssign={handleAssign} pendingAction={pendingAction} />
          )}
        </>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-bg-card shadow-sm">
          {visibleAlerts.map((alert, i) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              isLast={i === visibleAlerts.length - 1}
              onResolve={onResolve}
              onCardClick={onCardClick}
              snoozeMenuId={snoozeMenuId}
              setSnoozeMenuId={setSnoozeMenuId}
              onSnooze={handleSnooze}
              onAssign={handleAssign}
              pendingAction={pendingAction}
            />
          ))}
        </div>
      )}

      {visibleAlerts.length === 0 && alerts.length > 0 && (
        <div className="flex h-20 items-center justify-center rounded-lg border border-border bg-bg-card text-sm text-text-muted">
          All alerts filtered
        </div>
      )}
    </div>
  );
}

function AlertGroup({ severity, alerts, onResolve, onCardClick, snoozeMenuId, setSnoozeMenuId, onSnooze, onAssign, pendingAction }: {
  severity: "critical" | "warning" | "info";
  alerts: Alert[];
  onResolve: (id: number) => void;
  onCardClick?: (cardId: string) => void;
  snoozeMenuId: number | null;
  setSnoozeMenuId: (id: number | null) => void;
  onSnooze: (id: number, minutes: number) => void;
  onAssign: (id: number) => void;
  pendingAction: number | null;
}) {
  const style = severityStyles[severity];
  return (
    <div className={`overflow-hidden rounded-lg border bg-bg-card shadow-sm ${
      severity === "critical" ? "border-sell/30" : severity === "warning" ? "border-hold/30" : "border-border"
    }`}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span className={`h-2 w-2 rounded-full ${style.dot}`} />
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">{style.label}</span>
        <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${style.badge}`}>{alerts.length}</span>
      </div>
      {alerts.map((alert, i) => (
        <AlertRow
          key={alert.id}
          alert={alert}
          isLast={i === alerts.length - 1}
          onResolve={onResolve}
          onCardClick={onCardClick}
          snoozeMenuId={snoozeMenuId}
          setSnoozeMenuId={setSnoozeMenuId}
          onSnooze={onSnooze}
          onAssign={onAssign}
          pendingAction={pendingAction}
        />
      ))}
    </div>
  );
}

function AlertRow({ alert, isLast, onResolve, onCardClick, snoozeMenuId, setSnoozeMenuId, onSnooze, onAssign, pendingAction }: {
  alert: Alert;
  isLast: boolean;
  onResolve: (id: number) => void;
  onCardClick?: (cardId: string) => void;
  snoozeMenuId: number | null;
  setSnoozeMenuId: (id: number | null) => void;
  onSnooze: (id: number, minutes: number) => void;
  onAssign: (id: number) => void;
  pendingAction: number | null;
}) {
  const severity = getSeverity(alert);
  const age = Date.now() - new Date(alert.created_at).getTime();
  const ageLabel = age < 3600_000 ? `${Math.round(age / 60_000)}m ago` : age < 86400_000 ? `${Math.round(age / 3600_000)}h ago` : `${Math.round(age / 86400_000)}d ago`;
  const isPending = pendingAction === alert.id;

  return (
    <div className={`relative flex items-start gap-3 p-4 transition-colors hover:bg-bg-hover ${!isLast ? "border-b border-border" : ""} ${isPending ? "opacity-50" : ""}`}>
      <div className="mt-0.5 shrink-0">
        {alertIcons[alert.alert_type] || <Eye className="h-4 w-4 text-text-muted" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {onCardClick ? (
            <button
              onClick={() => onCardClick(alert.card_id)}
              className="text-sm font-semibold text-text-primary truncate hover:text-accent"
            >
              {alert.card_name}
            </button>
          ) : (
            <span className="text-sm font-semibold text-text-primary truncate">{alert.card_name}</span>
          )}
          <span className="shrink-0 rounded-sm bg-bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-text-muted">
            {alert.alert_type.replace(/_/g, " ")}
          </span>
          {severity === "critical" && <TrustBadge variant="manual-review" />}
          {alert.magnitude >= 2.5 && <TrustBadge variant="sentiment-spike" detail={`${alert.magnitude.toFixed(1)}x magnitude`} />}
          {alert.assigned_to && (
            <span className="rounded-sm bg-info/10 px-1.5 py-0.5 text-[11px] font-medium text-info">{alert.assigned_to}</span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-text-secondary">{alert.message}</p>
        <p className="mt-0.5 text-xs text-text-muted">{ageLabel}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {/* Assign */}
        <button
          onClick={() => onAssign(alert.id)}
          className="rounded-md p-2 text-text-muted transition-colors hover:bg-bg-secondary hover:text-text-primary min-h-[36px] min-w-[36px] flex items-center justify-center text-[11px] font-medium"
          aria-label="Assign alert"
          title="Assign"
        >
          @
        </button>

        {/* Snooze */}
        <div className="relative">
          <button
            onClick={() => setSnoozeMenuId(snoozeMenuId === alert.id ? null : alert.id)}
            className="rounded-md p-2 text-text-muted transition-colors hover:bg-bg-secondary hover:text-text-primary min-h-[36px] min-w-[36px] flex items-center justify-center"
            aria-label="Snooze alert"
          >
            <Clock className="h-3.5 w-3.5" />
          </button>
          {snoozeMenuId === alert.id && (
            <div className="absolute right-0 top-full z-10 mt-1 rounded-md border border-border bg-bg-card p-1 shadow-lg">
              {SNOOZE_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => onSnooze(alert.id, opt.minutes)}
                  className="block w-full rounded px-3 py-1.5 text-left text-xs font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary min-h-[32px]"
                >
                  Snooze {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Open card */}
        {onCardClick && (
          <button
            onClick={() => onCardClick(alert.card_id)}
            className="rounded-md p-2 text-text-muted transition-colors hover:bg-bg-secondary hover:text-text-primary min-h-[36px] min-w-[36px] flex items-center justify-center"
            aria-label="View card"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Resolve */}
        <button
          onClick={() => onResolve(alert.id)}
          className="rounded-md p-2 text-text-muted transition-colors hover:bg-bg-secondary hover:text-text-primary min-h-[36px] min-w-[36px] flex items-center justify-center"
          aria-label="Resolve alert"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
