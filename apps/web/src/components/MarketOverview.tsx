import { useQuery } from "@tanstack/react-query";
import { api, type Alert } from "../lib/api";
import { StatCard } from "./StatCard";
import { TrustBadge } from "./TrustBadge";
import {
  TrendingUp,
  Zap,
  AlertTriangle,
  ShoppingCart,
  ChevronRight,
  Eye,
  Clock,
  Check,
  X,
} from "lucide-react";

interface MarketOverviewProps {
  alerts?: Alert[];
  onNavigate?: (path: string) => void;
}

export function MarketOverview({ alerts = [], onNavigate }: MarketOverviewProps) {
  const { data: market, isLoading } = useQuery({
    queryKey: ["market-index"],
    queryFn: api.getMarketIndex,
    refetchInterval: 60_000,
  });

  const { data: moversUp } = useQuery({
    queryKey: ["movers", "up"],
    queryFn: () => api.getMovers("up", 7),
    refetchInterval: 60_000,
  });

  const { data: moversDown } = useQuery({
    queryKey: ["movers", "down"],
    queryFn: () => api.getMovers("down", 7),
    refetchInterval: 60_000,
  });

  const { data: trending } = useQuery({
    queryKey: ["trending"],
    queryFn: api.getTrending,
    refetchInterval: 60_000,
  });

  const { data: staleData } = useQuery({
    queryKey: ["stale-cards"],
    queryFn: () => api.getStaleCards(10),
    refetchInterval: 120_000,
  });

  const recommendationsQuery = useQuery({
    queryKey: ["recommendations", "pending"],
    queryFn: () => api.getRecommendations("pending"),
    refetchInterval: 120_000,
  });

  const handleCardClick = (cardId: string) => {
    onNavigate?.(`/card/${cardId}`);
  };

  const handleRecommendationReview = async (id: number, status: "approved" | "rejected") => {
    try {
      await api.reviewRecommendation(id, status);
      await recommendationsQuery.refetch();
    } catch {
      // Leave the item in place if the update fails
    }
  };

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-bg-card" />
        ))}
      </div>
    );
  }

  const pokemonTrend = market?.pokemon_trend_30d || "+0.0%";
  const sportsTrend = market?.sports_trend_30d || "+0.0%";

  // Derive action items from available data
  const highSeverityAlerts = alerts.filter((a) => a.magnitude >= 2);
  const medSeverityAlerts = alerts.filter((a) => a.magnitude >= 1 && a.magnitude < 2);
  const topBuys = moversDown?.movers?.slice(0, 5) || [];
  const bigMoves = moversUp?.movers?.filter((m) => Math.abs(m.change_pct) >= 10).slice(0, 5) || [];
  const trendingCards = trending?.trending?.slice(0, 6) || [];
  const staleCards = staleData?.cards || [];
  const pendingRecommendations = recommendationsQuery.data?.recommendations?.slice(0, 5) || [];

  const totalActions =
    highSeverityAlerts.length +
    topBuys.length +
    bigMoves.length +
    staleCards.length +
    pendingRecommendations.length;

  return (
    <div className="space-y-6">
      {/* ─── Compact Market Pulse ─── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Pokemon Index"
          value={market?.pokemon_index?.toLocaleString() ?? "--"}
          trend={pokemonTrend.startsWith("+") && pokemonTrend !== "+0.0%" ? "up" : pokemonTrend.startsWith("-") ? "down" : "stable"}
          trendValue={pokemonTrend}
        />
        <StatCard
          label="Sports Index"
          value={market?.sports_index?.toLocaleString() ?? "--"}
          trend={sportsTrend.startsWith("+") && sportsTrend !== "+0.0%" ? "up" : sportsTrend.startsWith("-") ? "down" : "stable"}
          trendValue={sportsTrend}
        />
        <StatCard
          label="Actions Today"
          value={totalActions || "--"}
          subtitle={totalActions ? `${highSeverityAlerts.length} urgent` : "All clear"}
          variant={highSeverityAlerts.length > 0 ? "sell" : "default"}
        />
        <StatCard
          label="Market Volatility"
          value={market?.volatility ?? "--"}
          subtitle={market?.updated_at ? `Updated ${new Date(market.updated_at).toLocaleTimeString()}` : ""}
        />
      </div>

      {/* ─── Urgent Alerts ─── */}
      {highSeverityAlerts.length > 0 && (
        <section className="rounded-lg border border-sell/30 bg-sell/5 shadow-sm">
          <div className="flex items-center justify-between border-b border-sell/20 px-4 py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-sell" />
              <h3 className="text-sm font-bold text-text-primary">Needs Attention Now</h3>
              <span className="rounded-full bg-sell/15 px-2 py-0.5 text-[11px] font-bold text-sell">{highSeverityAlerts.length}</span>
            </div>
            {onNavigate && (
              <button onClick={() => onNavigate("/alerts")} className="flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover">
                All alerts <ChevronRight className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="divide-y divide-sell/10">
            {highSeverityAlerts.slice(0, 3).map((alert) => (
              <button
                key={alert.id}
                onClick={() => handleCardClick(alert.card_id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-sell/5 min-h-[44px]"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-primary truncate">{alert.card_name}</span>
                    <TrustBadge variant={alert.magnitude >= 3 ? "manual-review" : "sentiment-spike"} />
                  </div>
                  <p className="mt-0.5 text-xs text-text-secondary truncate">{alert.message}</p>
                </div>
                <span className="shrink-0 text-xs text-text-muted">{new Date(alert.created_at).toLocaleTimeString()}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ─── Stale / Missing Predictions ─── */}
      {staleCards.length > 0 && (
        <section className="rounded-lg border border-warning/30 bg-warning/5 shadow-sm">
          <div className="flex items-center justify-between border-b border-warning/20 px-4 py-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-warning" />
              <h3 className="text-sm font-bold text-text-primary">Stale Predictions</h3>
              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-bold text-warning">{staleCards.length}</span>
            </div>
          </div>
          <div className="divide-y divide-warning/10">
            {staleCards.slice(0, 5).map((card) => (
              <button
                key={card.card_id}
                onClick={() => handleCardClick(card.card_id)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-warning/5 min-h-[44px]"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-text-primary truncate block">{card.name}</span>
                  <span className="text-xs text-text-muted">{card.category.replace(/_/g, " ")}</span>
                </div>
                <TrustBadge
                  variant={card.staleness === "no_prediction" ? "manual-review" : "stale"}
                  detail={card.staleness === "no_prediction" ? "No prediction" : `Last: ${card.predicted_at ? new Date(card.predicted_at).toLocaleDateString() : "unknown"}`}
                />
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ─── Pending Recommendations ─── */}
      {pendingRecommendations.length > 0 && (
        <section className="rounded-lg border border-border bg-bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-buy" />
              <h3 className="text-sm font-bold text-text-primary">Saved Recommendations</h3>
              <span className="rounded-full bg-buy/10 px-2 py-0.5 text-[11px] font-bold text-buy">
                {pendingRecommendations.length}
              </span>
            </div>
            {onNavigate && (
              <button onClick={() => onNavigate("/evaluate")} className="flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover">
                New lot <ChevronRight className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="divide-y divide-border">
            {pendingRecommendations.map((rec) => (
              <div key={rec.id} className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => handleCardClick(rec.card_id)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-semibold text-text-primary">{rec.card_name}</p>
                  <p className="text-xs text-text-muted">
                    {rec.grading_company} {rec.grade} · {rec.decision.replace(/_/g, " ")} · ${rec.offered_price.toFixed(0)} offer
                  </p>
                </button>
                <TrustBadge variant={rec.confidence === "HIGH" ? "high-confidence" : rec.confidence === "LOW" ? "low-confidence" : "medium-confidence"} />
                <button
                  onClick={() => void handleRecommendationReview(rec.id, "approved")}
                  className="rounded-md bg-buy/10 p-2 text-buy hover:bg-buy/20"
                  aria-label="Approve recommendation"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => void handleRecommendationReview(rec.id, "rejected")}
                  className="rounded-md bg-sell/10 p-2 text-sell hover:bg-sell/20"
                  aria-label="Reject recommendation"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── Two-Column Queue: Buy Opportunities + Big Moves ─── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Buy Opportunities (biggest decliners = potential bargains) */}
        <section className="rounded-lg border border-border bg-bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-buy" />
              <h3 className="text-sm font-bold text-text-primary">Buy Opportunities</h3>
            </div>
            {onNavigate && (
              <button onClick={() => onNavigate("/evaluate")} className="flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover">
                Evaluate <ChevronRight className="h-3 w-3" />
              </button>
            )}
          </div>
          <div>
            {topBuys.length > 0 ? topBuys.map((m, i) => (
              <button
                key={m.card_id}
                onClick={() => handleCardClick(m.card_id)}
                className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-bg-hover min-h-[44px] ${
                  i < topBuys.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-buy/10 text-xs font-bold text-buy">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{m.name}</p>
                    <p className="text-xs text-text-muted">{m.grading_company} {m.grade} &middot; ${m.recent_avg.toFixed(0)}</p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-sm font-bold text-sell">{m.change_pct.toFixed(1)}%</span>
                  <p className="text-[11px] text-text-muted">was ${m.prior_avg.toFixed(0)}</p>
                </div>
              </button>
            )) : (
              <div className="px-4 py-6 text-center text-sm text-text-muted">No opportunities detected</div>
            )}
          </div>
        </section>

        {/* Big Price Moves (gainers needing review) */}
        <section className="rounded-lg border border-border bg-bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-bold text-text-primary">Major Price Moves</h3>
            </div>
          </div>
          <div>
            {bigMoves.length > 0 ? bigMoves.map((m, i) => (
              <button
                key={m.card_id}
                onClick={() => handleCardClick(m.card_id)}
                className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-bg-hover min-h-[44px] ${
                  i < bigMoves.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{m.name}</p>
                    <p className="text-xs text-text-muted">{m.grading_company} {m.grade}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <TrustBadge variant={Math.abs(m.change_pct) >= 25 ? "manual-review" : "sentiment-spike"} detail={`${m.change_pct > 0 ? "+" : ""}${m.change_pct.toFixed(0)}%`} />
                  <span className="text-sm font-bold text-text-primary">${m.recent_avg.toFixed(0)}</span>
                </div>
              </button>
            )) : (
              <div className="px-4 py-6 text-center text-sm text-text-muted">No major moves this week</div>
            )}
          </div>
        </section>
      </div>

      {/* ─── Medium-Priority Alerts ─── */}
      {medSeverityAlerts.length > 0 && (
        <section className="rounded-lg border border-border bg-bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-hold" />
              <h3 className="text-sm font-bold text-text-primary">Review Queue</h3>
              <span className="rounded-full bg-hold/10 px-2 py-0.5 text-[11px] font-bold text-hold">{medSeverityAlerts.length}</span>
            </div>
            {onNavigate && (
              <button onClick={() => onNavigate("/alerts")} className="flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover">
                View all <ChevronRight className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="divide-y divide-border">
            {medSeverityAlerts.slice(0, 4).map((alert) => (
              <button
                key={alert.id}
                onClick={() => handleCardClick(alert.card_id)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-bg-hover min-h-[44px]"
              >
                <span className="text-sm text-text-primary truncate flex-1">{alert.card_name}</span>
                <span className="shrink-0 rounded-sm bg-bg-secondary px-1.5 py-0.5 text-[11px] text-text-muted">{alert.alert_type.replace(/_/g, " ")}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ─── Trending (Sentiment-Driven) ─── */}
      {trendingCards.length > 0 && (
        <section className="rounded-lg border border-border bg-bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Zap className="h-4 w-4 text-warning" />
            <h3 className="text-sm font-bold text-text-primary">Trending Now</h3>
            <TrustBadge variant="sentiment-spike" detail="Social signal" />
          </div>
          <div className="flex gap-3 overflow-x-auto p-4">
            {trendingCards.map((t: Record<string, unknown>) => (
              <button
                key={t.card_id as string}
                onClick={() => handleCardClick(t.card_id as string)}
                className="shrink-0 rounded-lg border border-border bg-bg-primary px-3 py-2 text-left transition-colors hover:border-accent/30 hover:bg-bg-hover min-h-[44px]"
              >
                <p className="text-sm font-semibold text-text-primary truncate max-w-[150px]">{t.name as string}</p>
                <p className="text-xs text-text-muted">{t.mention_count as number} mentions</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ─── Top Gainers ─── */}
      {moversUp?.movers && moversUp.movers.length > 0 && (
        <section className="rounded-lg border border-border bg-bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <TrendingUp className="h-4 w-4 text-buy" />
            <h3 className="text-sm font-bold text-text-primary">Top Gainers (7d)</h3>
          </div>
          <div className="grid gap-0 sm:grid-cols-2">
            {moversUp.movers.slice(0, 6).map((m, i) => (
              <button
                key={m.card_id}
                onClick={() => handleCardClick(m.card_id)}
                className="flex items-center justify-between border-b border-border px-4 py-2.5 text-left transition-colors hover:bg-bg-hover min-h-[44px] last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-bold text-text-muted">{i + 1}</span>
                  <span className="text-sm font-medium text-text-primary truncate">{m.name}</span>
                </div>
                <span className="shrink-0 text-sm font-bold text-buy">+{m.change_pct.toFixed(1)}%</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
