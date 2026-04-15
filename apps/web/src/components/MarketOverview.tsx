import { useState } from "react";
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
  ChevronDown,
  Clock,
  Check,
  X,
} from "lucide-react";

interface MarketOverviewProps {
  alerts?: Alert[];
  onNavigate?: (path: string) => void;
}

export function MarketOverview({ alerts = [], onNavigate }: MarketOverviewProps) {
  const [showContext, setShowContext] = useState(false);

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

  // Derive action items
  const urgentAlerts = alerts.filter((a) => a.magnitude >= 2);
  const topBuys = moversDown?.movers?.slice(0, 5) || [];
  const staleCards = staleData?.cards || [];
  const pendingRecs = recommendationsQuery.data?.recommendations?.slice(0, 5) || [];
  const trendingCards = trending?.trending?.slice(0, 8) || [];
  const bigMoves = moversUp?.movers?.filter((m) => Math.abs(m.change_pct) >= 10).slice(0, 5) || [];

  const actionCount = urgentAlerts.length + pendingRecs.length;

  return (
    <div className="space-y-8">
      {/* ═══ MARKET PULSE — compact stat strip ═══ */}
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
          label="Needs Action"
          value={actionCount || "0"}
          subtitle={actionCount ? `${urgentAlerts.length} urgent, ${pendingRecs.length} pending` : "All clear"}
          variant={urgentAlerts.length > 0 ? "sell" : "default"}
        />
        <StatCard
          label="Market Volatility"
          value={market?.volatility ?? "--"}
          subtitle={market?.updated_at ? `${new Date(market.updated_at).toLocaleTimeString()}` : ""}
        />
      </div>

      {/* ═══ PRIMARY QUEUE — urgent items + pending decisions ═══ */}
      {(urgentAlerts.length > 0 || pendingRecs.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Urgent alerts */}
          {urgentAlerts.length > 0 && (
            <section className="rounded-xl border-2 border-sell/25 bg-bg-card shadow-sm">
              <SectionHeader
                icon={<AlertTriangle className="h-4 w-4 text-sell" />}
                title="Needs Attention"
                count={urgentAlerts.length}
                countColor="text-sell bg-sell/10"
                action={onNavigate ? { label: "All alerts", onClick: () => onNavigate("/alerts") } : undefined}
              />
              <div>
                {urgentAlerts.slice(0, 4).map((alert, i) => (
                  <button
                    key={alert.id}
                    onClick={() => handleCardClick(alert.card_id)}
                    className={`flex w-full items-center gap-4 px-4 py-3 sm:px-5 text-left transition-colors hover:bg-bg-hover min-h-[56px] ${
                      i < Math.min(urgentAlerts.length, 4) - 1 ? "border-b border-border" : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate">{alert.card_name}</p>
                      <p className="mt-1 text-xs text-text-secondary leading-relaxed line-clamp-2">{alert.message}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="rounded bg-bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-muted">{alert.alert_type.replace(/_/g, " ")}</span>
                        <span className="text-[11px] text-text-muted">{new Date(alert.created_at).toLocaleTimeString()}</span>
                      </div>
                    </div>
                    <TrustBadge variant={alert.magnitude >= 3 ? "manual-review" : "sentiment-spike"} />
                    <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Pending recommendations — or Major Price Moves as fallback */}
          {pendingRecs.length > 0 ? (
            <section className="rounded-xl border border-border bg-bg-card shadow-sm">
              <SectionHeader
                icon={<ShoppingCart className="h-4 w-4 text-buy" />}
                title="Pending Decisions"
                count={pendingRecs.length}
                countColor="text-buy bg-buy/10"
                action={onNavigate ? { label: "Evaluate", onClick: () => onNavigate("/evaluate") } : undefined}
              />
              <div>
                {pendingRecs.map((rec, i) => (
                  <div
                    key={rec.id}
                    className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${
                      i < pendingRecs.length - 1 ? "border-b border-border" : ""
                    }`}
                  >
                    <button onClick={() => handleCardClick(rec.card_id)} className="min-w-0 flex-1 text-left">
                      <p className="truncate text-sm font-semibold text-text-primary hover:text-accent">{rec.card_name}</p>
                      <p className="text-xs text-text-muted">
                        {rec.grading_company} {rec.grade} · ${rec.offered_price.toFixed(0)} · {rec.decision.replace(/_/g, " ")}
                      </p>
                    </button>
                    <TrustBadge variant={rec.confidence === "HIGH" ? "high-confidence" : rec.confidence === "LOW" ? "low-confidence" : "medium-confidence"} />
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        onClick={() => void handleRecommendationReview(rec.id, "approved")}
                        className="rounded-lg bg-buy/10 px-2.5 py-1.5 text-xs font-medium text-buy hover:bg-buy/20 min-h-[36px] flex items-center gap-1"
                      >
                        <Check className="h-3 w-3" /> Approve
                      </button>
                      <button
                        onClick={() => void handleRecommendationReview(rec.id, "rejected")}
                        className="rounded-lg bg-bg-secondary px-2.5 py-1.5 text-xs font-medium text-text-muted hover:bg-bg-hover min-h-[36px] flex items-center gap-1"
                      >
                        <X className="h-3 w-3" /> Pass
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <section className="rounded-xl border border-border bg-bg-card shadow-sm">
              <SectionHeader
                icon={<TrendingUp className="h-4 w-4 text-accent" />}
                title="Major Price Moves"
              />
              <div>
                {bigMoves.length > 0 ? bigMoves.map((m, i) => (
                  <button
                    key={m.card_id}
                    onClick={() => handleCardClick(m.card_id)}
                    className={`flex w-full items-center justify-between px-4 py-3 sm:px-5text-left transition-colors hover:bg-bg-hover min-h-[44px] ${
                      i < bigMoves.length - 1 ? "border-b border-border" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate">{m.name}</p>
                      <p className="text-xs text-text-muted">{m.grading_company} {m.grade}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-bold text-text-primary">${m.recent_avg.toFixed(0)}</span>
                      <span className={`text-xs font-bold ${m.change_pct > 0 ? "text-buy" : "text-sell"}`}>
                        {m.change_pct > 0 ? "+" : ""}{m.change_pct.toFixed(0)}%
                      </span>
                    </div>
                  </button>
                )) : (
                  <div className="px-5 py-10 text-center text-sm text-text-muted">No major moves (&gt;10%) this week</div>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ═══ OPPORTUNITIES — buy signals + stale predictions ═══ */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-bg-card shadow-sm">
          <SectionHeader
            icon={<ShoppingCart className="h-4 w-4 text-buy" />}
            title="Buy Opportunities"
            action={onNavigate ? { label: "Evaluate", onClick: () => onNavigate("/evaluate") } : undefined}
          />
          <div>
            {topBuys.length > 0 ? topBuys.map((m, i) => (
              <button
                key={m.card_id}
                onClick={() => handleCardClick(m.card_id)}
                className={`flex w-full items-center gap-4 px-4 py-3 sm:px-5 text-left transition-colors hover:bg-bg-hover min-h-[56px] ${
                  i < topBuys.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-buy/10 text-xs font-bold text-buy">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">{m.name}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="rounded bg-bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-muted">{m.grading_company} {m.grade}</span>
                    <span className="rounded bg-bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-muted">{m.category.replace(/_/g, " ")}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-base font-bold text-text-primary">${m.recent_avg.toFixed(0)}</p>
                  <p className="text-xs font-semibold text-sell">{m.change_pct.toFixed(1)}% <span className="font-normal text-text-muted">from ${m.prior_avg.toFixed(0)}</span></p>
                </div>
              </button>
            )) : (
              <div className="px-5 py-10 text-center text-sm text-text-muted">No opportunities detected this week</div>
            )}
          </div>
        </section>

        {staleCards.length > 0 ? (
          <section className="rounded-xl border border-warning/20 bg-bg-card shadow-sm">
            <SectionHeader
              icon={<Clock className="h-4 w-4 text-warning" />}
              title="Stale Predictions"
              count={staleCards.length}
              countColor="text-warning bg-warning/10"
            />
            <div>
              {staleCards.slice(0, 5).map((card, i) => (
                <button
                  key={card.card_id}
                  onClick={() => handleCardClick(card.card_id)}
                  className={`flex w-full items-center gap-4 px-4 py-3 sm:px-5 text-left transition-colors hover:bg-bg-hover min-h-[56px] ${
                    i < Math.min(staleCards.length, 5) - 1 ? "border-b border-border" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{card.name}</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="rounded bg-bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-muted">{card.category.replace(/_/g, " ")}</span>
                      {card.fair_value != null && (
                        <span className="text-[11px] text-text-muted">${card.fair_value.toFixed(0)} fair value</span>
                      )}
                    </div>
                  </div>
                  <TrustBadge
                    variant={card.staleness === "no_prediction" ? "manual-review" : "stale"}
                    detail={card.staleness === "no_prediction" ? "No prediction" : `Last: ${card.predicted_at ? new Date(card.predicted_at).toLocaleDateString() : "?"}`}
                  />
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section className="rounded-xl border border-border bg-bg-card shadow-sm">
            <SectionHeader
              icon={<TrendingUp className="h-4 w-4 text-accent" />}
              title="Major Price Moves"
            />
            <div>
              {bigMoves.length > 0 ? bigMoves.map((m, i) => (
                <button
                  key={m.card_id}
                  onClick={() => handleCardClick(m.card_id)}
                  className={`flex w-full items-center justify-between px-4 py-3 sm:px-5text-left transition-colors hover:bg-bg-hover min-h-[44px] ${
                    i < bigMoves.length - 1 ? "border-b border-border" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{m.name}</p>
                    <p className="text-xs text-text-muted">{m.grading_company} {m.grade}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold text-text-primary">${m.recent_avg.toFixed(0)}</span>
                    <span className={`text-xs font-bold ${m.change_pct > 0 ? "text-buy" : "text-sell"}`}>
                      {m.change_pct > 0 ? "+" : ""}{m.change_pct.toFixed(0)}%
                    </span>
                  </div>
                </button>
              )) : (
                <div className="px-5 py-8 text-center text-sm text-text-muted">No major moves this week</div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* ═══ MARKET CONTEXT — collapsible ═══ */}
      {(trendingCards.length > 0 || (moversUp?.movers?.length ?? 0) > 0) && (
        <div>
          <button
            onClick={() => setShowContext(!showContext)}
            className="mb-4 flex items-center gap-2 text-sm font-semibold text-text-secondary hover:text-text-primary transition-colors"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${showContext ? "" : "-rotate-90"}`} />
            Market Context
            <span className="text-xs font-normal text-text-muted">Trending, gainers, and more</span>
          </button>

          {showContext && (
            <div className="space-y-6">
              {/* Trending */}
              {trendingCards.length > 0 && (
                <section className="rounded-xl border border-border bg-bg-card shadow-sm">
                  <SectionHeader
                    icon={<Zap className="h-4 w-4 text-warning" />}
                    title="Trending Now"
                  />
                  <div className="flex gap-3 overflow-x-auto px-4 pb-4 sm:px-5 pt-1">
                    {trendingCards.map((t: Record<string, unknown>) => (
                      <button
                        key={t.card_id as string}
                        onClick={() => handleCardClick(t.card_id as string)}
                        className="shrink-0 rounded-lg border border-border bg-bg-primary px-4 py-2.5 text-left transition-colors hover:border-accent/30 hover:bg-bg-hover min-h-[44px]"
                      >
                        <p className="text-sm font-semibold text-text-primary truncate max-w-[160px]">{t.name as string}</p>
                        <p className="text-xs text-text-muted">{t.mention_count as number} mentions</p>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Top Gainers */}
              {moversUp?.movers && moversUp.movers.length > 0 && (
                <section className="rounded-xl border border-border bg-bg-card shadow-sm">
                  <SectionHeader
                    icon={<TrendingUp className="h-4 w-4 text-buy" />}
                    title="Top Gainers (7d)"
                  />
                  <div className="grid sm:grid-cols-2">
                    {moversUp.movers.slice(0, 6).map((m, i) => (
                      <button
                        key={m.card_id}
                        onClick={() => handleCardClick(m.card_id)}
                        className="flex items-center justify-between border-b border-border px-4 py-2.5 sm:px-5 text-left transition-colors hover:bg-bg-hover min-h-[44px] last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-bold text-text-muted w-4">{i + 1}</span>
                          <span className="text-sm font-medium text-text-primary truncate">{m.name}</span>
                        </div>
                        <span className="shrink-0 text-sm font-bold text-buy">+{m.change_pct.toFixed(1)}%</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Big Price Moves — only show if stale cards took the slot above */}
              {staleCards.length > 0 && bigMoves.length > 0 && (
                <section className="rounded-xl border border-border bg-bg-card shadow-sm">
                  <SectionHeader
                    icon={<TrendingUp className="h-4 w-4 text-accent" />}
                    title="Major Price Moves"
                  />
                  <div>
                    {bigMoves.map((m, i) => (
                      <button
                        key={m.card_id}
                        onClick={() => handleCardClick(m.card_id)}
                        className={`flex w-full items-center justify-between px-4 py-3 sm:px-5text-left transition-colors hover:bg-bg-hover min-h-[44px] ${
                          i < bigMoves.length - 1 ? "border-b border-border" : ""
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-text-primary truncate">{m.name}</p>
                          <p className="text-xs text-text-muted">{m.grading_company} {m.grade}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-sm font-bold text-text-primary">${m.recent_avg.toFixed(0)}</span>
                          <span className={`text-xs font-bold ${m.change_pct > 0 ? "text-buy" : "text-sell"}`}>
                            {m.change_pct > 0 ? "+" : ""}{m.change_pct.toFixed(0)}%
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Shared Section Header ─── */
function SectionHeader({ icon, title, count, countColor, action }: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  countColor?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 sm:px-5">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-bold text-text-primary">{title}</h3>
        {count != null && count > 0 && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${countColor || "text-text-muted bg-bg-secondary"}`}>
            {count}
          </span>
        )}
      </div>
      {action && (
        <button onClick={action.onClick} className="flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover">
          {action.label} <ChevronRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
