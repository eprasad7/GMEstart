import { useQuery } from "@tanstack/react-query";
import { api, type Card } from "../lib/api";
import { StatCard } from "./StatCard";
import { TrendingUp, TrendingDown, Zap } from "lucide-react";

interface MarketOverviewProps {
  onCardSelect?: (card: Card) => void;
}

export function MarketOverview({ onCardSelect }: MarketOverviewProps) {
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

  const handleMoverClick = (cardId: string, name: string) => {
    if (!onCardSelect) return;
    onCardSelect({ id: cardId, name, set_name: "", set_year: 0, card_number: "", category: "", player_character: null, image_url: null });
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

  return (
    <div className="space-y-6">
      {/* Index Cards — per-category trends */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          label="Market Volatility"
          value={market?.volatility ?? "--"}
          subtitle="30-day measure"
        />
        <StatCard
          label="Last Updated"
          value={market?.updated_at ? new Date(market.updated_at).toLocaleTimeString() : "--"}
          subtitle="Auto-refreshes"
        />
      </div>

      {/* Trending Cards (from sentiment) */}
      {trending?.trending && trending.trending.length > 0 && (
        <div className="rounded-lg border border-border bg-bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Zap className="h-4 w-4 text-warning" />
            <h3 className="text-sm font-bold text-text-primary">Trending Now</h3>
          </div>
          <div className="flex gap-3 overflow-x-auto p-4">
            {trending.trending.slice(0, 8).map((t: Record<string, unknown>, i: number) => (
              <button
                key={i}
                onClick={() => handleMoverClick(t.card_id as string, t.name as string)}
                className="shrink-0 rounded-lg border border-border bg-bg-primary px-3 py-2 text-left transition-colors hover:border-accent/30 hover:bg-bg-hover min-h-[44px]"
              >
                <p className="text-sm font-semibold text-text-primary truncate max-w-[150px]">{t.name as string}</p>
                <p className="text-xs text-text-muted">{t.mention_count as number} mentions</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Movers — clickable */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <TrendingUp className="h-4 w-4 text-buy" />
            <h3 className="text-sm font-bold text-text-primary">Top Gainers (7d)</h3>
          </div>
          <div>
            {moversUp?.movers?.slice(0, 5).map((m, i) => (
              <button
                key={m.card_id}
                onClick={() => handleMoverClick(m.card_id, m.name)}
                className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-bg-hover min-h-[44px] ${
                  i < 4 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-secondary text-xs font-bold text-text-muted">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{m.name}</p>
                    <p className="text-xs text-text-muted">{m.grading_company} {m.grade}</p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-sm font-bold text-buy">+{m.change_pct.toFixed(1)}%</span>
                  <p className="text-xs text-text-muted">${m.recent_avg.toFixed(2)}</p>
                </div>
              </button>
            )) || (
              <div className="px-4 py-6 text-center text-sm text-text-muted">No data yet</div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <TrendingDown className="h-4 w-4 text-sell" />
            <h3 className="text-sm font-bold text-text-primary">Top Decliners (7d)</h3>
          </div>
          <div>
            {moversDown?.movers?.slice(0, 5).map((m, i) => (
              <button
                key={m.card_id}
                onClick={() => handleMoverClick(m.card_id, m.name)}
                className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-bg-hover min-h-[44px] ${
                  i < 4 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-secondary text-xs font-bold text-text-muted">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{m.name}</p>
                    <p className="text-xs text-text-muted">{m.grading_company} {m.grade}</p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-sm font-bold text-sell">{m.change_pct.toFixed(1)}%</span>
                  <p className="text-xs text-text-muted">${m.recent_avg.toFixed(2)}</p>
                </div>
              </button>
            )) || (
              <div className="px-4 py-6 text-center text-sm text-text-muted">No data yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
