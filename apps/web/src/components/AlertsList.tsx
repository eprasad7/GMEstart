import { useState, useMemo, useRef, useEffect } from "react";
import { AlertTriangle, TrendingUp, TrendingDown, Zap, Eye, X, Clock, ChevronRight, UserPlus, CheckCircle2 } from "lucide-react";
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
  { label: "1 hour", minutes: 60 },
  { label: "4 hours", minutes: 240 },
  { label: "24 hours", minutes: 1440 },
  { label: "7 days", minutes: 10080 },
];

const ASSIGNEES = ["Me", "Team Lead", "Pricing", "Review Queue"];

function getSeverity(alert: Alert): "critical" | "warning" | "info" {
  if (alert.magnitude >= 2 || alert.alert_type === "anomaly_detected") return "critical";
  if (alert.magnitude >= 1 || alert.alert_type === "price_crash" || alert.alert_type === "price_spike") return "warning";
  return "info";
}

const severityOrder = { critical: 0, warning: 1, info: 2 };
const severityStyles = {
  critical: { dot: "bg-sell", label: "Critical", border: "border-sell/25" },
  warning: { dot: "bg-hold", label: "Warning", border: "border-hold/25" },
  info: { dot: "bg-info", label: "Info", border: "border-border" },
};

export function AlertsList({ alerts, onResolve, onRefresh, onCardClick, showControls = true }: AlertsListProps) {
  const [sortMode, setSortMode] = useState<SortMode>("severity");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [openMenuId, setOpenMenuId] = useState<{ id: number; type: "snooze" | "assign" } | null>(null);
  const [pendingAction, setPendingAction] = useState<number | null>(null);

  const handleSnooze = async (alertId: number, durationMinutes: number) => {
    setPendingAction(alertId);
    setOpenMenuId(null);
    try {
      await api.snoozeAlert(alertId, durationMinutes);
      onRefresh?.();
    } catch {
      // Snooze failed
    } finally {
      setPendingAction(null);
    }
  };

  const handleAssign = async (alertId: number, assignee: string) => {
    setPendingAction(alertId);
    setOpenMenuId(null);
    try {
      await api.assignAlert(alertId, assignee);
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
      <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-bg-card shadow-sm">
        <CheckCircle2 className="h-6 w-6 text-buy" />
        <p className="text-sm font-medium text-text-primary">All clear</p>
        <p className="text-xs text-text-muted">No active alerts right now</p>
      </div>
    );
  }

  const grouped = {
    critical: visibleAlerts.filter((a) => getSeverity(a) === "critical"),
    warning: visibleAlerts.filter((a) => getSeverity(a) === "warning"),
    info: visibleAlerts.filter((a) => getSeverity(a) === "info"),
  };

  return (
    <div className="space-y-5">
      {showControls && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-0.5 rounded-lg bg-bg-secondary p-1">
            {(["severity", "newest", "type"] as SortMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setSortMode(mode)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors min-h-[32px] ${
                  sortMode === mode ? "bg-bg-card text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as FilterType)}
            className="rounded-lg border border-border bg-bg-primary px-3 py-1.5 text-xs text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
          >
            <option value="all">All types</option>
            <option value="price_spike">Price spikes</option>
            <option value="price_crash">Price crashes</option>
            <option value="viral_social">Viral social</option>
            <option value="anomaly_detected">Anomalies</option>
            <option value="new_high">New highs</option>
            <option value="new_low">New lows</option>
          </select>

          <div className="ml-auto flex items-center gap-3 text-xs">
            {grouped.critical.length > 0 && (
              <span className="flex items-center gap-1.5 font-medium text-sell">
                <span className="h-2 w-2 rounded-full bg-sell" />
                {grouped.critical.length} critical
              </span>
            )}
            {grouped.warning.length > 0 && (
              <span className="flex items-center gap-1.5 text-text-muted">
                <span className="h-2 w-2 rounded-full bg-hold" />
                {grouped.warning.length} warning
              </span>
            )}
            {grouped.info.length > 0 && (
              <span className="flex items-center gap-1.5 text-text-muted">
                <span className="h-2 w-2 rounded-full bg-info" />
                {grouped.info.length} info
              </span>
            )}
          </div>
        </div>
      )}

      {sortMode === "severity" ? (
        <div className="space-y-5">
          {grouped.critical.length > 0 && (
            <AlertGroup severity="critical" alerts={grouped.critical} onResolve={onResolve} onCardClick={onCardClick} openMenuId={openMenuId} setOpenMenuId={setOpenMenuId} onSnooze={handleSnooze} onAssign={handleAssign} pendingAction={pendingAction} />
          )}
          {grouped.warning.length > 0 && (
            <AlertGroup severity="warning" alerts={grouped.warning} onResolve={onResolve} onCardClick={onCardClick} openMenuId={openMenuId} setOpenMenuId={setOpenMenuId} onSnooze={handleSnooze} onAssign={handleAssign} pendingAction={pendingAction} />
          )}
          {grouped.info.length > 0 && (
            <AlertGroup severity="info" alerts={grouped.info} onResolve={onResolve} onCardClick={onCardClick} openMenuId={openMenuId} setOpenMenuId={setOpenMenuId} onSnooze={handleSnooze} onAssign={handleAssign} pendingAction={pendingAction} />
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-bg-card shadow-sm">
          {visibleAlerts.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              onResolve={onResolve}
              onCardClick={onCardClick}
              openMenuId={openMenuId}
              setOpenMenuId={setOpenMenuId}
              onSnooze={handleSnooze}
              onAssign={handleAssign}
              pendingAction={pendingAction}
            />
          ))}
        </div>
      )}

      {visibleAlerts.length === 0 && alerts.length > 0 && (
        <div className="flex h-20 items-center justify-center rounded-xl border border-border bg-bg-card text-sm text-text-muted">
          All alerts filtered
        </div>
      )}
    </div>
  );
}

function AlertGroup({ severity, alerts, ...rowProps }: {
  severity: "critical" | "warning" | "info";
  alerts: Alert[];
  onResolve: (id: number) => void;
  onCardClick?: (cardId: string) => void;
  openMenuId: { id: number; type: string } | null;
  setOpenMenuId: (v: { id: number; type: "snooze" | "assign" } | null) => void;
  onSnooze: (id: number, minutes: number) => void;
  onAssign: (id: number, assignee: string) => void;
  pendingAction: number | null;
}) {
  const style = severityStyles[severity];
  return (
    <div className={`overflow-hidden rounded-xl border bg-bg-card shadow-sm ${style.border}`}>
      <div className="flex items-center gap-2 px-4 py-2.5 sm:px-5">
        <span className={`h-2 w-2 rounded-full ${style.dot}`} />
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">{style.label}</span>
        <span className="text-xs text-text-muted">{alerts.length}</span>
      </div>
      {alerts.map((alert) => (
        <AlertRow
          key={alert.id}
          alert={alert}
          {...rowProps}
        />
      ))}
    </div>
  );
}

function AlertRow({ alert, onResolve, onCardClick, openMenuId, setOpenMenuId, onSnooze, onAssign, pendingAction }: {
  alert: Alert;
  onResolve: (id: number) => void;
  onCardClick?: (cardId: string) => void;
  openMenuId: { id: number; type: string } | null;
  setOpenMenuId: (v: { id: number; type: "snooze" | "assign" } | null) => void;
  onSnooze: (id: number, minutes: number) => void;
  onAssign: (id: number, assignee: string) => void;
  pendingAction: number | null;
}) {
  const severity = getSeverity(alert);
  const age = Date.now() - new Date(alert.created_at).getTime();
  const ageLabel = age < 3600_000 ? `${Math.round(age / 60_000)}m ago` : age < 86400_000 ? `${Math.round(age / 3600_000)}h ago` : `${Math.round(age / 86400_000)}d ago`;
  const isPending = pendingAction === alert.id;

  const isSnoozeOpen = openMenuId?.id === alert.id && openMenuId.type === "snooze";
  const isAssignOpen = openMenuId?.id === alert.id && openMenuId.type === "assign";

  return (
    <div className={`border-t border-border px-4 py-3.5 sm:px-5 transition-colors hover:bg-bg-hover ${isPending ? "opacity-40 pointer-events-none" : ""}`}>
      <div className="flex items-start gap-3 sm:gap-4">
      {/* Icon */}
      <div className="mt-0.5 shrink-0">
        {alertIcons[alert.alert_type] || <Eye className="h-4 w-4 text-text-muted" />}
      </div>

      {/* Content: what happened + why */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {onCardClick ? (
            <button onClick={() => onCardClick(alert.card_id)} className="text-sm font-semibold text-text-primary truncate hover:text-accent">
              {alert.card_name}
            </button>
          ) : (
            <span className="text-sm font-semibold text-text-primary truncate">{alert.card_name}</span>
          )}
          <span className="shrink-0 rounded bg-bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-text-muted">
            {alert.alert_type.replace(/_/g, " ")}
          </span>
          {severity === "critical" && <TrustBadge variant="manual-review" />}
          {alert.assigned_to && (
            <span className="rounded bg-info/10 px-1.5 py-0.5 text-[11px] font-medium text-info">{alert.assigned_to}</span>
          )}
        </div>
        <p className="mt-1 text-sm text-text-secondary leading-relaxed">{alert.message}</p>
        <p className="mt-1 text-xs text-text-muted">{ageLabel}</p>
      </div>

      {/* Action rail — pill buttons with labels */}
      <div className="hidden shrink-0 items-center gap-1.5 mt-0.5 sm:flex">
        {/* Assign */}
        <div className="relative">
          <button
            onClick={() => setOpenMenuId(isAssignOpen ? null : { id: alert.id, type: "assign" })}
            className="flex items-center gap-1 rounded-lg bg-bg-secondary px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary min-h-[32px]"
          >
            <UserPlus className="h-3 w-3" />
            <span className="hidden sm:inline">Assign</span>
          </button>
          {isAssignOpen && (
            <Popover onClose={() => setOpenMenuId(null)}>
              {ASSIGNEES.map((name) => (
                <button
                  key={name}
                  onClick={() => onAssign(alert.id, name)}
                  className="block w-full rounded-md px-3 py-2 text-left text-xs font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary min-h-[36px]"
                >
                  {name}
                </button>
              ))}
            </Popover>
          )}
        </div>

        {/* Snooze */}
        <div className="relative">
          <button
            onClick={() => setOpenMenuId(isSnoozeOpen ? null : { id: alert.id, type: "snooze" })}
            className="flex items-center gap-1 rounded-lg bg-bg-secondary px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary min-h-[32px]"
          >
            <Clock className="h-3 w-3" />
            <span className="hidden sm:inline">Snooze</span>
          </button>
          {isSnoozeOpen && (
            <Popover onClose={() => setOpenMenuId(null)}>
              {SNOOZE_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => onSnooze(alert.id, opt.minutes)}
                  className="block w-full rounded-md px-3 py-2 text-left text-xs font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary min-h-[36px]"
                >
                  {opt.label}
                </button>
              ))}
            </Popover>
          )}
        </div>

        {/* Investigate */}
        {onCardClick && (
          <button
            onClick={() => onCardClick(alert.card_id)}
            className="flex items-center gap-1 rounded-lg bg-bg-secondary px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary min-h-[32px]"
          >
            <ChevronRight className="h-3 w-3" />
            <span className="hidden sm:inline">View</span>
          </button>
        )}

        {/* Resolve */}
        <button
          onClick={() => onResolve(alert.id)}
          className="flex items-center gap-1 rounded-lg bg-buy/10 px-2.5 py-1.5 text-xs font-medium text-buy transition-colors hover:bg-buy/20 min-h-[32px]"
        >
          <X className="h-3 w-3" />
          <span className="hidden sm:inline">Resolve</span>
        </button>
      </div>
    </div>
  );
}

/* ─── Popover ─── */
function Popover({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute right-0 top-full z-20 mt-1.5 min-w-[140px] rounded-xl border border-border bg-bg-card p-1.5 shadow-xl">
      {children}
    </div>
  );
}
