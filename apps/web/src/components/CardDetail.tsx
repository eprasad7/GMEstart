import { useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { api, type Card, type PriceResponse } from "../lib/api";
import { PriceChart } from "./PriceChart";
import { SentimentGauge } from "./SentimentGauge";
import { TrustBadge, getConfidenceBadge, getFreshnessBadge, getCompsBadge } from "./TrustBadge";
import { ArrowLeft, Loader2, AlertCircle, Info, GitCompare } from "lucide-react";

interface CardDetailProps {
  card: Card;
  onBack: () => void;
}

const GRADES = ["RAW", "1", "2", "3", "4", "5", "6", "7", "8", "8.5", "9", "9.5", "10"];
const GRADING_COMPANIES = ["PSA", "BGS", "CGC", "SGC", "RAW"];
const COMPARE_GRADES = ["8", "9", "9.5", "10"];
const COMPARE_COMPANIES = ["PSA", "BGS", "CGC"];

export function CardDetail({ card, onBack }: CardDetailProps) {
  const [grade, setGrade] = useState("RAW");
  const [gradingCompany, setGradingCompany] = useState("RAW");
  const [historyDays, setHistoryDays] = useState(90);
  const [showExplainer, setShowExplainer] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [compareMode, setCompareMode] = useState<"grade" | "company">("grade");

  const { data: price, isLoading: priceLoading, isError: priceError } = useQuery({
    queryKey: ["price", card.id, grade, gradingCompany],
    queryFn: () => api.getPrice(card.id, grade, gradingCompany),
  });

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ["history", card.id, grade, gradingCompany, historyDays],
    queryFn: () => api.getHistory(card.id, historyDays, grade, gradingCompany),
  });

  const { data: sentiment } = useQuery({
    queryKey: ["sentiment", card.id],
    queryFn: () => api.getSentiment(card.id),
  });

  // Evidence query — only fire when explainer is open
  const { data: evidence } = useQuery({
    queryKey: ["evidence", card.id, grade, gradingCompany],
    queryFn: () => api.getPriceEvidence(card.id, grade, gradingCompany),
    enabled: showExplainer,
  });

  // Grade comparison queries — only fire when comparison is open
  const comparisonItems = compareMode === "grade"
    ? COMPARE_GRADES.map((g) => ({ grade: g, company: gradingCompany }))
    : COMPARE_COMPANIES.map((c) => ({ grade, company: c }));

  const comparisonQueries = useQueries({
    queries: comparisonItems.map((item) => ({
      queryKey: ["price", card.id, item.grade, item.company],
      queryFn: () => api.getPrice(card.id, item.grade, item.company),
      enabled: showComparison,
      retry: 0,
    })),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3 sm:gap-4">
        <button
          onClick={onBack}
          className="mt-1 shrink-0 rounded-md p-2 text-text-muted transition-colors hover:bg-bg-secondary hover:text-text-primary min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Go back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-1 items-start gap-3 sm:gap-4">
          {card.image_url ? (
            <img src={card.image_url} alt={card.name} className="hidden h-24 w-20 rounded-lg border border-border object-cover shadow-sm sm:block" />
          ) : (
            <div className="hidden h-24 w-20 items-center justify-center rounded-lg border border-border bg-bg-secondary text-2xl text-text-muted shadow-sm sm:flex">?</div>
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-text-primary truncate sm:text-xl">{card.name}</h2>
            <p className="text-sm text-text-secondary">
              {card.set_name} ({card.set_year}) &middot; #{card.card_number}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="inline-block rounded bg-bg-secondary px-2 py-0.5 text-xs font-medium text-text-secondary">
                {card.category.replace(/_/g, " ")}
              </span>
              {price && (
                <>
                  <TrustBadge variant={getConfidenceBadge(price.confidence)} />
                  <TrustBadge variant={getFreshnessBadge(price.has_prediction ? price.updated_at : null)} />
                  <TrustBadge {...getCompsBadge(price.sales_30d)} />
                  {!price.has_prediction && (
                    <TrustBadge variant="manual-review" detail="No ML prediction" />
                  )}
                </>
              )}
              {sentiment && sentiment.trend === "spiking" && (
                <TrustBadge variant="sentiment-spike" />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Grade selector */}
      <div className="rounded-lg border border-border bg-bg-card p-3 shadow-sm sm:p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="detail-company" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted">Grading Co.</label>
            <select
              id="detail-company"
              value={gradingCompany}
              onChange={(e) => setGradingCompany(e.target.value)}
              className="rounded-md border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
            >
              {GRADING_COMPANIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="detail-grade" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted">Grade</label>
            <select
              id="detail-grade"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="rounded-md border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
            >
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setShowExplainer(!showExplainer)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors min-h-[44px] ${
              showExplainer ? "bg-info/10 text-info border border-info/20" : "bg-bg-secondary text-text-secondary hover:bg-bg-hover"
            }`}
          >
            <Info className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Why this price?</span>
            <span className="sm:hidden">Why?</span>
          </button>
          <button
            onClick={() => setShowComparison(!showComparison)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors min-h-[44px] ${
              showComparison ? "bg-accent/10 text-accent border border-accent/20" : "bg-bg-secondary text-text-secondary hover:bg-bg-hover"
            }`}
          >
            <GitCompare className="h-3.5 w-3.5" />
            Compare
          </button>
        </div>
      </div>

      {/* Pricing */}
      {priceLoading ? (
        <div className="flex h-24 items-center justify-center rounded-lg border border-border bg-bg-card shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
          <span className="ml-2 text-sm text-text-muted">Loading pricing...</span>
        </div>
      ) : priceError ? (
        <div className="flex h-24 items-center justify-center gap-2 rounded-lg border border-danger/30 bg-danger/5 shadow-sm">
          <AlertCircle className="h-5 w-5 text-danger" />
          <span className="text-sm text-danger">No pricing data available for this grade</span>
        </div>
      ) : price ? (
        <div className="rounded-lg border border-border bg-bg-card p-4 shadow-sm sm:p-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 sm:gap-6">
            <div className="col-span-2 sm:col-span-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Fair Value</p>
              <p className="mt-0.5 text-2xl font-extrabold text-text-primary sm:text-3xl">${price.price.toFixed(2)}</p>
              <p className="text-[11px] text-text-muted">90% CI: ${price.lower.toFixed(0)}–${price.upper.toFixed(0)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Max Buy Price</p>
              {price.buy_threshold > 0 ? (
                <>
                  <p className="mt-0.5 text-lg font-bold text-buy">${price.buy_threshold.toFixed(0)}</p>
                  <p className="text-[11px] text-text-muted">Below this = strong buy</p>
                </>
              ) : (
                <>
                  <p className="mt-0.5 text-lg font-bold text-text-muted">--</p>
                  <p className="text-[11px] text-text-muted">No model prediction</p>
                </>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Expected Margin</p>
              {price.buy_threshold > 0 ? (
                <p className={`mt-0.5 text-lg font-bold ${price.price > price.buy_threshold ? "text-buy" : "text-sell"}`}>
                  {`${(((price.price - price.buy_threshold) / price.buy_threshold) * 100).toFixed(0)}%`}
                </p>
              ) : (
                <p className="mt-0.5 text-lg font-bold text-text-muted">--</p>
              )}
              <p className="text-[11px] text-text-muted">Buy at threshold, sell at fair</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Trend</p>
              <p className={`mt-0.5 text-lg font-bold capitalize ${price.trend === "rising" ? "text-buy" : price.trend === "falling" ? "text-sell" : "text-text-primary"}`}>
                {price.trend}
              </p>
              <p className="text-[11px] text-text-muted">{price.sales_30d} sales in 30d</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Confidence</p>
              <p className={`mt-0.5 text-lg font-bold ${price.confidence === "HIGH" ? "text-buy" : price.confidence === "LOW" ? "text-sell" : "text-hold"}`}>
                {price.confidence}
              </p>
              <p className="text-[11px] text-text-muted">
                {price.last_sale ? `Last: ${new Date(price.last_sale).toLocaleDateString()}` : "No recent sales"}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* ─── Why This Price? Explainer ─── */}
      {showExplainer && price && (
        <div className="rounded-lg border border-info/20 bg-info/5 p-5 shadow-sm">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-text-primary">
            <Info className="h-4 w-4 text-info" />
            Why this price?
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ExplainerRow
              label="Recent Comps"
              value={price.sales_30d > 0 ? `${price.sales_30d} sales in 30d` : "No recent sales"}
              detail={price.trend === "rising" ? "Prices trending up" : price.trend === "falling" ? "Prices trending down" : "Prices stable"}
              signal={price.trend === "rising" ? "up" : price.trend === "falling" ? "down" : "neutral"}
            />
            <ExplainerRow
              label="Price Range"
              value={`$${price.lower.toFixed(0)} – $${price.upper.toFixed(0)}`}
              detail={`Fair value sits at $${price.price.toFixed(0)} within 90% CI`}
              signal="neutral"
            />
            <ExplainerRow
              label="Confidence Driver"
              value={price.confidence}
              detail={
                price.confidence === "HIGH" ? "Strong comp volume, consistent pricing"
                : price.confidence === "LOW" ? "Few comps or high variance — treat estimate cautiously"
                : "Moderate comp volume, some price variance"
              }
              signal={price.confidence === "HIGH" ? "up" : price.confidence === "LOW" ? "down" : "neutral"}
            />
            {/* Source Breakdown */}
            {evidence && evidence.sources.length > 0 && (
              <ExplainerRow
                label="Comp Sources"
                value={evidence.sources.map((s) => `${s.source} (${s.count})`).join(", ")}
                detail={evidence.sources.length === 1 ? "Single source — cross-reference recommended" : `${evidence.sources.length} sources provide diversity`}
                signal={evidence.sources.length >= 2 ? "up" : "down"}
              />
            )}
            {/* Anomaly Exclusions */}
            {evidence && evidence.anomalies.excluded_count > 0 && (
              <ExplainerRow
                label="Anomalies Excluded"
                value={`${evidence.anomalies.excluded_count} sale${evidence.anomalies.excluded_count > 1 ? "s" : ""} removed`}
                detail={evidence.anomalies.avg_anomaly_price ? `Avg anomaly price: $${evidence.anomalies.avg_anomaly_price.toFixed(0)} (excluded from model)` : "Outliers excluded from fair value calculation"}
                signal="neutral"
              />
            )}
            {/* Population Signal */}
            {evidence?.population && (
              <ExplainerRow
                label="Population"
                value={`${evidence.population.count} at this grade`}
                detail={`${evidence.population.higher_grades} graded higher out of ${evidence.population.total} total${evidence.population.snapshot_date ? ` (${new Date(evidence.population.snapshot_date).toLocaleDateString()})` : ""}`}
                signal={evidence.population.count < 50 ? "up" : "neutral"}
              />
            )}
            {evidence?.internal && (
              <ExplainerRow
                label="Store Demand"
                value={`${evidence.internal.trade_in_count} trade-ins, ${evidence.internal.store_views} views`}
                detail={`Inventory ${evidence.internal.inventory_units}, foot traffic index ${evidence.internal.foot_traffic_index.toFixed(1)} (${new Date(evidence.internal.snapshot_date).toLocaleDateString()})`}
                signal={evidence.internal.foot_traffic_index >= 1 ? "up" : "neutral"}
              />
            )}
            {sentiment && (
              <>
                <ExplainerRow
                  label="Sentiment Effect"
                  value={sentiment.score > 0.2 ? "Bullish" : sentiment.score < -0.2 ? "Bearish" : "Neutral"}
                  detail={`${sentiment.mentions_7d} mentions this week, trend ${sentiment.trend}`}
                  signal={sentiment.score > 0.2 ? "up" : sentiment.score < -0.2 ? "down" : "neutral"}
                />
                <ExplainerRow
                  label="Social Trend"
                  value={sentiment.trend}
                  detail={sentiment.trend === "spiking" ? "Unusual social activity may move price" : "Social activity at normal levels"}
                  signal={sentiment.trend === "spiking" || sentiment.trend === "rising" ? "up" : "neutral"}
                />
              </>
            )}
            <ExplainerRow
              label="Data Freshness"
              value={price.has_prediction && price.updated_at ? new Date(price.updated_at).toLocaleDateString() : price.has_prediction ? "Unknown" : "No model — using sales average"}
              detail={price.last_sale ? `Last sale: ${new Date(price.last_sale).toLocaleDateString()}` : "No recent transaction data"}
              signal={price.has_prediction && getFreshnessBadge(price.updated_at) === "fresh" ? "up" : "down"}
            />
          </div>
        </div>
      )}

      {/* ─── Grade / Company Comparison ─── */}
      {showComparison && (
        <div className="rounded-lg border border-border bg-bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-text-primary">
              <GitCompare className="h-4 w-4 text-accent" />
              {compareMode === "grade" ? "Grade Comparison" : "Grading Company Comparison"}
            </h3>
            <div className="flex gap-1 rounded-md bg-bg-secondary p-0.5">
              <button
                onClick={() => setCompareMode("grade")}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
                  compareMode === "grade" ? "bg-bg-card text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"
                }`}
              >
                By Grade
              </button>
              <button
                onClick={() => setCompareMode("company")}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] ${
                  compareMode === "company" ? "bg-bg-card text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"
                }`}
              >
                By Company
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="pb-2 pr-4 text-left text-xs font-semibold uppercase text-text-muted">
                    {compareMode === "grade" ? "Grade" : "Company"}
                  </th>
                  <th className="pb-2 px-4 text-right text-xs font-semibold uppercase text-text-muted">Fair Value</th>
                  <th className="pb-2 px-4 text-right text-xs font-semibold uppercase text-text-muted">Max Buy</th>
                  <th className="pb-2 px-4 text-right text-xs font-semibold uppercase text-text-muted">Sales (30d)</th>
                  <th className="pb-2 px-4 text-right text-xs font-semibold uppercase text-text-muted">Trend</th>
                  <th className="pb-2 pl-4 text-right text-xs font-semibold uppercase text-text-muted">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {comparisonItems.map((item, i) => {
                  const q = comparisonQueries[i];
                  const p = q?.data as PriceResponse | undefined;
                  const isActive = compareMode === "grade"
                    ? item.grade === grade
                    : item.company === gradingCompany;

                  return (
                    <tr
                      key={`${item.company}-${item.grade}`}
                      className={`border-b border-border last:border-b-0 ${isActive ? "bg-accent/5" : ""}`}
                    >
                      <td className="py-2.5 pr-4">
                        <button
                          onClick={() => {
                            if (compareMode === "grade") setGrade(item.grade);
                            else setGradingCompany(item.company);
                          }}
                          className="font-medium text-text-primary hover:text-accent"
                        >
                          {compareMode === "grade" ? item.grade : item.company}
                          {isActive && <span className="ml-1.5 text-[10px] text-accent">(viewing)</span>}
                        </button>
                      </td>
                      {q?.isLoading ? (
                        <td colSpan={5} className="py-2.5 text-center">
                          <Loader2 className="inline h-3.5 w-3.5 animate-spin text-text-muted" />
                        </td>
                      ) : q?.isError || !p ? (
                        <td colSpan={5} className="py-2.5 px-4 text-text-muted">No data</td>
                      ) : (
                        <>
                          <td className="py-2.5 px-4 text-right font-bold text-text-primary">${p.price.toFixed(0)}</td>
                          <td className="py-2.5 px-4 text-right text-buy">{p.buy_threshold > 0 ? `$${p.buy_threshold.toFixed(0)}` : "--"}</td>
                          <td className="py-2.5 px-4 text-right text-text-secondary">{p.sales_30d}</td>
                          <td className={`py-2.5 px-4 text-right capitalize ${p.trend === "rising" ? "text-buy" : p.trend === "falling" ? "text-sell" : "text-text-secondary"}`}>
                            {p.trend}
                          </td>
                          <td className="py-2.5 pl-4 text-right">
                            <TrustBadge variant={getConfidenceBadge(p.confidence)} />
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Charts and Sentiment */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {historyLoading ? (
            <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-bg-card shadow-sm">
              <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
            </div>
          ) : (
            <PriceChart
              sales={history?.sales || []}
              fairValue={price?.price}
              buyThreshold={price?.buy_threshold || undefined}
              sellThreshold={price?.sell_threshold || undefined}
              onRangeChange={setHistoryDays}
            />
          )}
        </div>
        <div>
          {sentiment && <SentimentGauge sentiment={sentiment} />}
        </div>
      </div>
    </div>
  );
}

// ─── Explainer Row ───

function ExplainerRow({ label, value, detail, signal }: {
  label: string;
  value: string | number;
  detail: string;
  signal: "up" | "down" | "neutral";
}) {
  const signalColor = signal === "up" ? "text-buy" : signal === "down" ? "text-sell" : "text-text-secondary";
  return (
    <div className="rounded-md bg-bg-card/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-bold capitalize ${signalColor}`}>{value}</p>
      <p className="mt-0.5 text-xs text-text-muted">{detail}</p>
    </div>
  );
}
