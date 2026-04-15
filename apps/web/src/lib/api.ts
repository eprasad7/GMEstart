// In dev, Vite proxies /v1 to the Worker. In production, use the full API URL.
const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/v1`
  : "/v1";

// API key injected at build time or read from localStorage for production.
// In development (Vite proxy), auth is bypassed server-side.
function getApiKey(): string | undefined {
  if (typeof window !== "undefined") {
    return localStorage.getItem("gmestart_api_key") || undefined;
  }
  return undefined;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  const apiKey = getApiKey();
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError((body as { error: string }).error || res.statusText, res.status);
  }
  return res.json() as Promise<T>;
}

// ─── Types ───

export interface PriceResponse {
  card_id: string;
  card_name: string;
  grade: string;
  grading_company: string;
  price: number;
  lower: number;
  upper: number;
  buy_threshold: number;
  sell_threshold: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  last_sale: string | null;
  sales_30d: number;
  trend: "rising" | "stable" | "falling";
  updated_at: string | null;
  has_prediction: boolean;
  experiment?: {
    id: number;
    name: string;
    variant: "control" | "challenger";
  };
}

export interface Card {
  id: string;
  name: string;
  set_name: string;
  set_year: number;
  card_number: string;
  category: string;
  player_character: string | null;
  image_url: string | null;
}

export interface SaleRecord {
  id: number;
  card_id: string;
  card_name: string;
  source: string;
  price_usd: number;
  sale_date: string;
  grade: string;
  grading_company: string;
  sale_type: string;
}

export interface SentimentResponse {
  card_id: string;
  score: number;
  mentions_7d: number;
  trend: string;
  breakdown: Array<{
    source: string;
    period: string;
    score: number;
    mention_count: number;
  }>;
  top_posts: string[];
}

export interface EvaluateResponse {
  decision: "STRONG_BUY" | "REVIEW_BUY" | "FAIR_VALUE" | "SELL_SIGNAL";
  fair_value: number;
  margin: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasoning: string;
}

export interface Alert {
  id: number;
  card_id: string;
  card_name: string;
  category: string;
  alert_type: string;
  magnitude: number;
  trigger_source: string;
  message: string;
  is_active: boolean;
  snoozed_until: string | null;
  assigned_to: string | null;
  created_at: string;
}

export interface StaleCard {
  card_id: string;
  name: string;
  category: string;
  predicted_at: string | null;
  confidence: string | null;
  fair_value: number | null;
  staleness: "no_prediction" | "stale";
}

export interface PriceEvidence {
  card_id: string;
  grade: string;
  grading_company: string;
  sources: Array<{ source: string; count: number; avg_price: number }>;
  anomalies: { excluded_count: number; avg_anomaly_price: number | null };
  population: { count: number; higher_grades: number; total: number; snapshot_date: string } | null;
  internal: {
    snapshot_date: string;
    trade_in_count: number;
    avg_trade_in_price: number;
    inventory_units: number;
    store_views: number;
    foot_traffic_index: number;
  } | null;
}

export interface Recommendation {
  id: number;
  card_id: string;
  card_name: string;
  grade: string;
  grading_company: string;
  decision: string;
  offered_price: number;
  fair_value: number;
  margin: number;
  confidence: string;
  channel: string | null;
  notes: string | null;
  status: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
}

export interface BatchEvaluateInput {
  card_id: string;
  offered_price: number;
  grade?: string;
  grading_company?: string;
}

export interface BatchEvaluateResult {
  card_id: string;
  card_name?: string;
  offered_price?: number;
  grade: string;
  grading_company: string;
  decision?: EvaluateResponse["decision"];
  fair_value?: number;
  margin?: number;
  confidence?: EvaluateResponse["confidence"];
  reasoning?: string;
  max_buy_price?: number;
  sell_threshold?: number | null;
  error?: string;
}

export interface SystemHealth {
  status: "healthy" | "warning" | "degraded";
  predictions: {
    stale: boolean;
    latestPredictionAt: string | null;
    hoursSincePrediction: number | null;
    hoursSinceScoring: number | null;
  };
  model: {
    version: string;
    model_version: string;
    cards_scored: number;
    scored_at: string;
  } | null;
  drift: {
    status: string;
    mdapePct: number;
    coverage90: number;
    message: string;
    createdAt: string;
  } | null;
  catalog: { totalCards: number };
  ingestion: { recentRuns: Array<{ source: string; status: string; records: number; at: string }> };
}

export interface ActivityRun {
  source: string;
  status: string;
  records: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

export interface MarketIndex {
  pokemon_index: number;
  pokemon_trend_30d: string;
  sports_index: number;
  sports_trend_30d: string;
  volatility: "low" | "moderate" | "high";
  updated_at: string;
}

export interface Mover {
  card_id: string;
  name: string;
  category: string;
  grading_company: string;
  grade: string;
  recent_avg: number;
  prior_avg: number;
  change_pct: number;
}

// ─── API Functions ───

export const api = {
  // Cards
  searchCards: (q: string, category?: string) =>
    fetchApi<{ cards: Card[] }>(`/cards/search?q=${encodeURIComponent(q)}${category ? `&category=${category}` : ""}`),

  getCard: (id: string) =>
    fetchApi<Card>(`/cards/${id}`),

  // Prices
  getPrice: (cardId: string, grade?: string, gradingCompany?: string) => {
    const params = new URLSearchParams();
    if (grade) params.set("grade", grade);
    if (gradingCompany) params.set("grading_company", gradingCompany);
    return fetchApi<PriceResponse>(`/price/${cardId}?${params}`);
  },

  // History
  getHistory: (cardId: string, days = 90, grade?: string, gradingCompany?: string) => {
    const params = new URLSearchParams({ days: String(days) });
    if (grade) params.set("grade", grade);
    if (gradingCompany) params.set("grading_company", gradingCompany);
    return fetchApi<{ card_id: string; sales: SaleRecord[] }>(`/history/${cardId}?${params}`);
  },

  getAggregates: (cardId: string, period = "daily", days = 90) =>
    fetchApi<{ card_id: string; aggregates: Array<Record<string, unknown>> }>(
      `/history/${cardId}/aggregates?period=${period}&days=${days}`
    ),

  // Sentiment
  getSentiment: (cardId: string) =>
    fetchApi<SentimentResponse>(`/sentiment/${cardId}`),

  getTrending: () =>
    fetchApi<{ trending: Array<Record<string, unknown>> }>("/sentiment/trending/all"),

  // Evaluate
  evaluate: (cardId: string, offeredPrice: number, grade?: string, gradingCompany?: string) =>
    fetchApi<EvaluateResponse>("/evaluate", {
      method: "POST",
      body: JSON.stringify({
        card_id: cardId,
        offered_price: offeredPrice,
        grade,
        grading_company: gradingCompany,
      }),
    }),

  evaluateBatch: (items: BatchEvaluateInput[]) =>
    fetchApi<{ results: BatchEvaluateResult[] }>("/evaluate/batch", {
      method: "POST",
      body: JSON.stringify({ items }),
    }),

  // Alerts
  getAlerts: () =>
    fetchApi<{ alerts: Alert[] }>("/alerts/active"),

  resolveAlert: (id: number) =>
    fetchApi<{ status: string }>(`/alerts/${id}/resolve`, { method: "POST" }),

  snoozeAlert: (id: number, durationMinutes: number) =>
    fetchApi<{ status: string }>(`/alerts/${id}/snooze`, {
      method: "POST",
      body: JSON.stringify({ duration_minutes: durationMinutes }),
    }),

  assignAlert: (id: number, assignedTo: string) =>
    fetchApi<{ status: string }>(`/alerts/${id}/assign`, {
      method: "POST",
      body: JSON.stringify({ assigned_to: assignedTo }),
    }),

  // Evaluate — save recommendation
  saveRecommendation: (rec: {
    card_id: string; grade: string; grading_company: string;
    decision: string; offered_price: number; fair_value: number;
    margin: number; confidence: string; channel?: string; notes?: string;
  }) =>
    fetchApi<{ status: string; id: number }>("/evaluate/save", {
      method: "POST",
      body: JSON.stringify(rec),
    }),

  getRecommendations: (status = "pending") =>
    fetchApi<{ recommendations: Recommendation[] }>(`/evaluate/recommendations?status=${status}`),

  reviewRecommendation: (id: number, status: "approved" | "rejected" | "expired") =>
    fetchApi<{ status: string }>(`/evaluate/recommendations/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),

  // Price evidence
  getPriceEvidence: (cardId: string, grade?: string, gradingCompany?: string) => {
    const params = new URLSearchParams();
    if (grade) params.set("grade", grade);
    if (gradingCompany) params.set("grading_company", gradingCompany);
    return fetchApi<PriceEvidence>(`/price/${cardId}/evidence?${params}`);
  },

  // Market
  getMarketIndex: () =>
    fetchApi<MarketIndex>("/market/index"),

  getMovers: (direction: "up" | "down" = "up", days = 7) =>
    fetchApi<{ movers: Mover[] }>(`/market/movers?direction=${direction}&days=${days}`),

  getStaleCards: (limit = 20) =>
    fetchApi<{ cards: StaleCard[] }>(`/market/stale?limit=${limit}`),

  // System
  getSystemHealth: () =>
    fetchApi<SystemHealth>("/system/health"),

  getActivity: (limit = 25) =>
    fetchApi<{ runs: ActivityRun[] }>(`/system/activity?limit=${limit}`),

  runPipeline: () =>
    fetchApi<Record<string, unknown>>("/system/run-pipeline", { method: "POST" }),

  // Agents
  getMonitorStatus: () =>
    fetchApi<{ lastCheck: string | null; activeAlerts: number; totalChecks: number; totalAnomalies: number; recentAlerts: Array<{ cardId: string; cardName: string; type: string; magnitude: number; detectedAt: string }> }>("/agents/monitor/status"),

  triggerMonitorCheck: () =>
    fetchApi<{ alertsFound: number; total: number }>("/agents/monitor/check", { method: "POST" }),

  getIntelligenceLatest: () =>
    fetchApi<{ id: string; date: string; summary: string; marketSentiment: string; highlights: Array<{ title: string; detail: string; impact: string }> } | null>("/agents/intelligence/latest").catch(() => null),

  generateIntelligenceReport: () =>
    fetchApi<Record<string, unknown>>("/agents/intelligence/generate", { method: "POST" }),

  getCompetitorStatus: () =>
    fetchApi<{ lastScan: string | null; totalScans: number; currentGaps: number; overpriced: number; underpriced: number }>("/agents/competitors/status"),

  triggerCompetitorScan: () =>
    fetchApi<{ gaps: number; scanned: number }>("/agents/competitors/scan", { method: "POST" }),

  getRecommendationStatus: () =>
    fetchApi<{ pendingCount: number; pendingByAction: { buy: number; sell: number; reprice: number }; lastGenerated: string | null; stats: { totalGenerated: number; totalApproved: number; totalRejected: number; totalExpired: number } }>("/agents/recommendations/status"),

  generateRecommendations: () =>
    fetchApi<{ generated: number }>("/agents/recommendations/generate", { method: "POST" }),
};
