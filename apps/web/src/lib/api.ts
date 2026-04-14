const API_BASE = "/v1";

// API key injected at build time or read from localStorage for production.
// In development (Vite proxy), auth is bypassed server-side.
function getApiKey(): string | undefined {
  if (typeof window !== "undefined") {
    return localStorage.getItem("gamecards_api_key") || undefined;
  }
  return undefined;
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
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((error as { error: string }).error || res.statusText);
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
  confidence: "HIGH" | "MEDIUM" | "LOW";
  last_sale: string | null;
  sales_30d: number;
  trend: "rising" | "stable" | "falling";
  updated_at: string;
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
  created_at: string;
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

  // Alerts
  getAlerts: () =>
    fetchApi<{ alerts: Alert[] }>("/alerts/active"),

  resolveAlert: (id: number) =>
    fetchApi<{ status: string }>(`/alerts/${id}/resolve`, { method: "POST" }),

  // Market
  getMarketIndex: () =>
    fetchApi<MarketIndex>("/market/index"),

  getMovers: (direction: "up" | "down" = "up", days = 7) =>
    fetchApi<{ movers: Mover[] }>(`/market/movers?direction=${direction}&days=${days}`),
};
