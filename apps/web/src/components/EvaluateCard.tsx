import { useState } from "react";
import { api, type EvaluateResponse, type Card } from "../lib/api";
import { SearchBar } from "./SearchBar";
import { TrustBadge, getConfidenceBadge } from "./TrustBadge";
import { DollarSign, Loader2, Settings2, Calculator, Info } from "lucide-react";

const CHANNELS = [
  { value: "ebay", label: "eBay", defaultFee: 13.25, defaultShipping: 4.5 },
  { value: "store", label: "GameStop / LCS", defaultFee: 0, defaultShipping: 0 },
  { value: "marketplace", label: "TCGPlayer / COMC", defaultFee: 10.25, defaultShipping: 3.0 },
] as const;

export function EvaluateCard() {
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [price, setPrice] = useState("");
  const [listPrice, setListPrice] = useState("");
  const [grade, setGrade] = useState("10");
  const [gradingCompany, setGradingCompany] = useState("PSA");
  const [channel, setChannel] = useState("ebay");
  const [feeRate, setFeeRate] = useState(13.25);
  const [shippingCost, setShippingCost] = useState(4.5);
  const [targetMargin, setTargetMargin] = useState(20);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [result, setResult] = useState<EvaluateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleChannelChange = (ch: string) => {
    setChannel(ch);
    const preset = CHANNELS.find((c) => c.value === ch);
    if (preset) {
      setFeeRate(preset.defaultFee);
      setShippingCost(preset.defaultShipping);
    }
  };

  const handleEvaluate = async () => {
    if (!selectedCard || !price) return;
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      setError("Please enter a positive price");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await api.evaluate(selectedCard.id, priceNum, grade, gradingCompany);
      setResult(res);
      if (!listPrice && res.fair_value > 0) {
        setListPrice(res.fair_value.toFixed(2));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setLoading(false);
    }
  };

  // What-if calculations (client-side only)
  const buyPrice = parseFloat(price) || 0;
  const sellPrice = parseFloat(listPrice) || (result?.fair_value ?? 0);
  const fees = sellPrice * (feeRate / 100);
  const netRevenue = sellPrice - fees - shippingCost;
  const profit = netRevenue - buyPrice;
  const profitMargin = buyPrice > 0 ? (profit / buyPrice) * 100 : 0;
  const breakEvenList = buyPrice > 0 ? (buyPrice + shippingCost) / (1 - feeRate / 100) : 0;
  const targetListPrice = buyPrice > 0 ? (buyPrice * (1 + targetMargin / 100) + shippingCost) / (1 - feeRate / 100) : 0;

  const decisionStyles: Record<string, string> = {
    STRONG_BUY: "bg-buy/10 text-buy border-buy/30",
    REVIEW_BUY: "bg-hold/10 text-hold border-hold/30",
    FAIR_VALUE: "bg-info/10 text-info border-info/30",
    SELL_SIGNAL: "bg-sell/10 text-sell border-sell/30",
  };

  return (
    <div className="space-y-4">
      {/* ─── Step 1: Card + Price (inputs to model) ─── */}
      <div className="rounded-lg border border-border bg-bg-card p-5 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">Card</label>
            {selectedCard ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-bg-primary px-3 py-2">
                <span className="flex-1 truncate text-sm font-medium text-text-primary">{selectedCard.name}</span>
                <button
                  onClick={() => { setSelectedCard(null); setResult(null); }}
                  className="shrink-0 text-xs text-accent hover:text-accent-hover"
                >
                  Change
                </button>
              </div>
            ) : (
              <SearchBar onSelect={setSelectedCard} />
            )}
          </div>

          <div>
            <label htmlFor="eval-price" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">Offered Price</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                id="eval-price"
                type="number"
                min="0.01"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="250.00"
                className="w-full rounded-md border border-border bg-bg-primary py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-accent"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label htmlFor="eval-grade" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">Grade</label>
              <select
                id="eval-grade"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
              >
                {["RAW", "1", "2", "3", "4", "5", "6", "7", "8", "8.5", "9", "9.5", "10"].map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label htmlFor="eval-company" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">Co.</label>
              <select
                id="eval-company"
                value={gradingCompany}
                onChange={(e) => setGradingCompany(e.target.value)}
                className="w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
              >
                {["PSA", "BGS", "CGC", "SGC", "RAW"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <button
          onClick={handleEvaluate}
          disabled={loading || !selectedCard || !price}
          className="mt-4 flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-50 min-h-[44px]"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
          Evaluate
        </button>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>

      {/* ─── Step 2: Model Decision (from API — not affected by channel) ─── */}
      {result && (
        <div className="rounded-lg border border-border bg-bg-card p-5 shadow-sm">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Model Decision</h3>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <span className={`inline-flex rounded-md border px-4 py-2 text-lg font-extrabold ${decisionStyles[result.decision] || ""}`}>
              {result.decision.replace(/_/g, " ")}
            </span>
            <TrustBadge variant={getConfidenceBadge(result.confidence)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3 mb-4">
            <div>
              <span className="text-xs text-text-muted">Fair Value</span>
              <p className="text-lg font-bold text-text-primary">${result.fair_value.toFixed(2)}</p>
            </div>
            <div>
              <span className="text-xs text-text-muted">Model Margin</span>
              <p className={`text-lg font-bold ${result.margin > 0 ? "text-buy" : "text-sell"}`}>
                {result.margin > 0 ? "+" : ""}{result.margin.toFixed(1)}%
              </p>
            </div>
            <div>
              <span className="text-xs text-text-muted">Confidence</span>
              <p className="text-lg font-bold text-text-primary">{result.confidence}</p>
            </div>
          </div>
          <p className="text-sm text-text-secondary">{result.reasoning}</p>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-text-muted">
            <Info className="h-3 w-3" />
            Uses standard retail economics (13% fee, $5 shipping, 20% margin target). Customize below.
          </p>
        </div>
      )}

      {/* ─── Step 3: Your Economics (client-side what-if — clearly separated) ─── */}
      {result && buyPrice > 0 && (
        <div className="rounded-lg border border-border bg-bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Your Economics</h3>
            <p className="text-[11px] text-text-muted">These settings affect the numbers below, not the model decision above</p>
          </div>

          {/* Channel + Assumptions controls */}
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="eval-channel" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">Sell Channel</label>
              <select
                id="eval-channel"
                value={channel}
                onChange={(e) => handleChannelChange(e.target.value)}
                className="rounded-md border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
              >
                {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>

            <button
              onClick={() => setShowAssumptions(!showAssumptions)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors min-h-[38px] ${
                showAssumptions ? "bg-bg-tertiary text-text-primary" : "bg-bg-secondary text-text-secondary hover:bg-bg-hover"
              }`}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Assumptions
            </button>
          </div>

          {showAssumptions && (
            <div className="mb-4 grid gap-3 rounded-md border border-border bg-bg-primary p-3 sm:grid-cols-3">
              <div>
                <label htmlFor="eval-fee" className="mb-1 block text-[11px] font-medium text-text-muted">Platform Fee %</label>
                <input
                  id="eval-fee"
                  type="number"
                  min="0"
                  max="100"
                  step="0.25"
                  value={feeRate}
                  onChange={(e) => setFeeRate(parseFloat(e.target.value) || 0)}
                  className="w-full rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
                />
              </div>
              <div>
                <label htmlFor="eval-shipping" className="mb-1 block text-[11px] font-medium text-text-muted">Shipping Cost</label>
                <div className="relative">
                  <DollarSign className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                  <input
                    id="eval-shipping"
                    type="number"
                    min="0"
                    step="0.50"
                    value={shippingCost}
                    onChange={(e) => setShippingCost(parseFloat(e.target.value) || 0)}
                    className="w-full rounded-md border border-border bg-bg-card py-1.5 pl-7 pr-3 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="eval-margin" className="mb-1 block text-[11px] font-medium text-text-muted">Target Margin %</label>
                <input
                  id="eval-margin"
                  type="number"
                  min="0"
                  max="200"
                  step="5"
                  value={targetMargin}
                  onChange={(e) => setTargetMargin(parseFloat(e.target.value) || 0)}
                  className="w-full rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
                />
              </div>
            </div>
          )}

          {/* List price input */}
          <div className="mb-4">
            <label htmlFor="eval-list" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
              List Price
            </label>
            <div className="relative max-w-xs">
              <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                id="eval-list"
                type="number"
                min="0.01"
                step="0.01"
                value={listPrice}
                onChange={(e) => setListPrice(e.target.value)}
                placeholder={result.fair_value.toFixed(2)}
                className="w-full rounded-md border border-border bg-bg-primary py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-accent"
              />
            </div>
          </div>

          {/* NRV Breakdown */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ScenarioCell label="Gross Revenue" value={`$${sellPrice.toFixed(2)}`} sub={`List on ${CHANNELS.find((c) => c.value === channel)?.label}`} />
            <ScenarioCell label="Fees + Shipping" value={`-$${(fees + shippingCost).toFixed(2)}`} sub={`${feeRate}% fee + $${shippingCost.toFixed(2)} ship`} variant="muted" />
            <ScenarioCell label="Net Revenue" value={`$${netRevenue.toFixed(2)}`} sub="After all costs" />
            <ScenarioCell
              label="Profit"
              value={`${profit >= 0 ? "+" : ""}$${profit.toFixed(2)}`}
              sub={`${profitMargin >= 0 ? "+" : ""}${profitMargin.toFixed(1)}% margin`}
              variant={profit > 0 ? "buy" : profit < 0 ? "sell" : "default"}
            />
          </div>

          {/* Key Thresholds */}
          <div className="mt-4 flex flex-wrap gap-4 rounded-md bg-bg-primary p-3 text-sm">
            <div>
              <span className="text-xs text-text-muted">Break-even list price</span>
              <p className="font-bold text-text-primary">${breakEvenList.toFixed(2)}</p>
            </div>
            <div>
              <span className="text-xs text-text-muted">List for {targetMargin}% margin</span>
              <p className="font-bold text-buy">${targetListPrice.toFixed(2)}</p>
            </div>
            <div>
              <span className="text-xs text-text-muted">Fair value (model)</span>
              <p className="font-bold text-text-primary">${result.fair_value.toFixed(2)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScenarioCell({ label, value, sub, variant = "default" }: {
  label: string;
  value: string;
  sub: string;
  variant?: "default" | "buy" | "sell" | "muted";
}) {
  const valueColor = variant === "buy" ? "text-buy" : variant === "sell" ? "text-sell" : variant === "muted" ? "text-text-secondary" : "text-text-primary";
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`mt-0.5 text-lg font-bold ${valueColor}`}>{value}</p>
      <p className="text-[11px] text-text-muted">{sub}</p>
    </div>
  );
}
