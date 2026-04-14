import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Card } from "../lib/api";
import { PriceChart } from "./PriceChart";
import { SentimentGauge } from "./SentimentGauge";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";

interface CardDetailProps {
  card: Card;
  onBack: () => void;
}

const GRADES = ["RAW", "1", "2", "3", "4", "5", "6", "7", "8", "8.5", "9", "9.5", "10"];
const GRADING_COMPANIES = ["PSA", "BGS", "CGC", "SGC", "RAW"];

export function CardDetail({ card, onBack }: CardDetailProps) {
  const [grade, setGrade] = useState("10");
  const [gradingCompany, setGradingCompany] = useState("PSA");
  const [historyDays, setHistoryDays] = useState(90);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={onBack}
          className="mt-1 shrink-0 rounded-md p-2 text-text-muted transition-colors hover:bg-bg-secondary hover:text-text-primary min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Go back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-1 items-start gap-4">
          {card.image_url ? (
            <img src={card.image_url} alt={card.name} className="h-24 w-20 rounded-lg border border-border object-cover shadow-sm" />
          ) : (
            <div className="flex h-24 w-20 items-center justify-center rounded-lg border border-border bg-bg-secondary text-2xl text-text-muted shadow-sm">?</div>
          )}
          <div>
            <h2 className="text-xl font-bold text-text-primary">{card.name}</h2>
            <p className="text-sm text-text-secondary">
              {card.set_name} ({card.set_year}) &middot; #{card.card_number}
            </p>
            <span className="mt-1 inline-block rounded bg-bg-secondary px-2 py-0.5 text-xs font-medium text-text-secondary">
              {card.category.replace(/_/g, " ")}
            </span>
          </div>
        </div>
      </div>

      {/* Grade selector */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-card p-4 shadow-sm">
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
        <div className="rounded-lg border border-border bg-bg-card p-5 shadow-sm">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Fair Value</p>
              <p className="mt-0.5 text-3xl font-extrabold text-text-primary">${price.price.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Price Range (90% CI)</p>
              <p className="mt-0.5 text-lg font-bold text-text-primary">${price.lower.toFixed(0)} &ndash; ${price.upper.toFixed(0)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Sales (30d)</p>
              <p className="mt-0.5 text-lg font-bold text-text-primary">{price.sales_30d}</p>
              <p className="text-xs text-text-muted">
                {price.last_sale ? `Last: ${new Date(price.last_sale).toLocaleDateString()}` : "No recent sales"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Trend</p>
              <p className={`mt-0.5 text-lg font-bold capitalize ${price.trend === "rising" ? "text-buy" : price.trend === "falling" ? "text-sell" : "text-text-primary"}`}>
                {price.trend}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Confidence</p>
              <p className={`mt-0.5 text-lg font-bold ${price.confidence === "HIGH" ? "text-buy" : price.confidence === "LOW" ? "text-sell" : "text-hold"}`}>
                {price.confidence}
              </p>
            </div>
          </div>
        </div>
      ) : null}

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
              buyThreshold={price?.lower}
              sellThreshold={price?.upper}
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
