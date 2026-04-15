# Architecture

## System Overview

GameCards runs entirely on Cloudflare's platform: a single Worker handles the API, scheduled data ingestion, and queue-based async processing. The ML training pipeline runs separately in Python and uploads model artifacts to R2.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        External Data Sources                         │
│  SoldComps · PriceCharting · Reddit · GemRate (PSA pop)             │
└─────────┬──────────────┬──────────────┬──────────────┬──────────────┘
          │ every 15min  │ daily 2am    │ every 5min   │ daily 3am
          ▼              ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Cloudflare Worker (Hono)                         │
│                                                                      │
│  ┌─────────────┐  ┌──────────────────┐  ┌────────────────────┐      │
│  │  API Routes  │  │  Cron Scheduler  │  │   Queue Consumers  │      │
│  │  /v1/price   │  │  8 cron triggers │  │  ingestion queue   │      │
│  │  /v1/evaluate│  │  → ingest data   │  │  sentiment queue   │      │
│  │  /v1/history │  │  → compute feats │  │  → insert to D1    │      │
│  │  /v1/alerts  │  │  → batch predict │  │  → Workers AI NLP  │      │
│  │  /v1/market  │  │  → detect anomal │  │                    │      │
│  │  /v1/cards   │  │  → rollup sentim │  │                    │      │
│  │  /v1/sentim  │  │                  │  │                    │      │
│  └──────┬───────┘  └──────────────────┘  └────────────────────┘      │
│         │                                                             │
│  ┌──────┴───────────────────────────────────────────────────────┐    │
│  │                      Cloudflare Bindings                      │    │
│  │  DB (D1)  ·  PRICE_CACHE (KV)  ·  MODELS (R2)  ·  AI        │    │
│  │  DATA_ARCHIVE (R2)  ·  INGESTION_QUEUE  ·  SENTIMENT_QUEUE   │    │
│  └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
          │
          │ model artifacts via R2
          │
┌─────────┴──────────────────────────────┐    ┌────────────────────────┐
│    Python ML Training Pipeline          │    │   React Dashboard      │
│    LightGBM quantile regression         │    │   Vite + TanStack Query│
│    ONNX export + batch score → R2       │    │   Recharts + Tailwind  │
│    Conformal calibration + MLflow       │    │   Reads /v1/* API      │
└─────────────────────────────────────────┘    └────────────────────────┘
```

## Data Flow

### 1. Ingestion

Cron triggers fire at configured intervals. Each ingestion job:
1. Queries the card catalog for cards to update (LRU by last ingestion time).
2. Calls the external API (SoldComps, PriceCharting, Reddit, GemRate).
3. Sends messages to the appropriate Cloudflare Queue.
4. Queue consumers apply data quality filters and insert into D1.

**Ingestion queue** handles price observations:
- Filters: price > $0, price < $1M.
- Best Offer adjustment: multiplies listed price by 0.80 (accepted offers average ~80% of listing).
- SoldComps ingestion also filters lot/bundle sales via regex and parses grade from title.

**Sentiment queue** handles Reddit posts:
- Workers AI (`distilbert-sst-2-int8`) classifies sentiment on a -1 to +1 scale.
- Card mentions are extracted from post text using Workers AI (`llama-3.1-8b-instruct`).
- Raw observations go to `sentiment_raw`, then hourly rollup aggregates into `sentiment_scores`.

### 2. Anomaly Detection (daily 4am)

Four detection methods run sequentially before features are recomputed:
1. **Price outliers**: flags observations >3x observed 30-day range from mean.
2. **Seller concentration**: flags sellers with avg price >1.5x market (3+ sales).
3. **Data quality**: flags graded cards (grade >= 8) priced under $1.
4. **Price spikes/crashes**: creates alerts when 7d avg diverges >30% from 30d avg.

Anomalous observations are marked `is_anomaly = 1` and excluded from all downstream aggregation, feature computation, and prediction.

### 3. Feature Computation (daily 5am)

Runs after ingestion completes. For each card+grade+grading_company triple with price data in the last year:
1. Computes the feature-store payload from parallel D1 queries (sales stats, population, sentiment, seasonality).
2. Classifies volume bucket: high (90d sales >= 50), medium (>= 10), low (< 10).
3. Upserts the feature vector as a JSON blob into `feature_store`.

### 4. Prediction Materialization (daily 6am)

Iterates all rows in `feature_store`:
1. Attempts to load the latest `batch_predictions.json` from R2.
2. If present, uses those pre-scored ML predictions for the current card+grade+company.
3. If absent, computes a statistical fallback from the feature store.
4. Inserts the resolved prediction into `model_predictions` and invalidates KV cache.

The batch-scoring file is produced by the external Python scoring step (`batch_score.py`). This is the current serving contract for ML predictions.

### 5. Serving

API requests hit the Hono router:
- **Price lookup**: checks KV cache (5-min TTL) → reads latest `model_predictions` row → computes trend from 7d/30d moving averages.
- **Evaluate**: reads latest prediction → computes NRV → applies decision logic.
- **Market index**: checks KV cache (15-min TTL) → computes category indices from `price_observations`.

## Scheduled Jobs

| Cron           | Job                    | Source file                          |
|----------------|------------------------|--------------------------------------|
| `*/15 * * * *` | SoldComps ingestion    | `services/ingestion/soldcomps.ts`    |
| `*/5 * * * *`  | Reddit sentiment       | `services/ingestion/reddit.ts`       |
| `0 * * * *`    | Sentiment rollup       | `services/sentiment-rollup.ts`       |
| `0 2 * * *`    | PriceCharting daily    | `services/ingestion/pricecharting.ts`|
| `0 3 * * *`    | Population reports     | `services/ingestion/population.ts`   |
| `0 4 * * *`    | Anomaly detection      | `services/anomaly.ts`                |
| `0 5 * * *`    | Aggregates + features  | `services/aggregates.ts` + `features.ts` |
| `0 6 * * *`    | Batch predictions      | `services/inference.ts`              |

All jobs log to `ingestion_log` with status, record count, and error messages.

## Key Design Decisions

**Cloudflare over AWS/Airflow.** The spec originally proposed TimescaleDB + Airflow + FastAPI + Redis (~$3,900/mo). The implementation uses Cloudflare Workers + D1 + KV + Queues + R2 (~$8-18/mo Cloudflare costs). This collapses the entire backend into a single deployable unit with no infrastructure to manage. The trade-off is D1's SQLite limitations (no PERCENTILE_CONT, no window functions in older compatibility dates) plus more application-managed workflows.

**D1 (SQLite) over PostgreSQL/TimescaleDB.** D1 is fully managed, zero cold starts, edge-deployed, and ~$5-20/mo at moderate scale. SQLite is sufficient for this data volume (thousands of cards, tens of thousands of price observations). The schema uses application-level aggregation (daily/weekly/monthly rollups) instead of TimescaleDB continuous aggregates. D1 has a **10 GB per-database limit** — the plan is to archive old observations to R2 (Parquet/CSV) at approximately the 6-month mark. See [INFRASTRUCTURE_COSTS.md](INFRASTRUCTURE_COSTS.md) for storage growth projections.

**Batch predictions before statistical fallback.** Workers do not run live ONNX inference. Instead, the Python pipeline pre-scores cards into `batch_predictions.json` in R2, and the Worker falls back to statistical estimation only when that artifact is unavailable or missing a card.

**Reddit-only sentiment first.** Twitter/X API costs ~$500-1K/mo. Reddit is free at 100 RPM. The sentiment pipeline is designed to add sources later (the schema supports `reddit` and `twitter` source types).

**Queues for ingestion.** Decouples API latency from external API reliability. Ingestion jobs produce messages, queue consumers write to D1. If an external API is slow or down, the queue buffers and retries.

**ML serving: batch + statistical.** The Worker reads pre-scored batch predictions from R2 and materializes them into D1 on the daily prediction cron. The Python scorer is currently an external step rather than a repo-managed scheduled workflow, which is the main remaining operational gap in the serving path.

**Monitoring: Cloudflare Analytics Engine.** The spec moved from Grafana + Prometheus to Cloudflare's built-in Analytics Engine plus the `ingestion_log` table for pipeline health. Workers analytics provide request metrics, error rates, and CPU time out of the box.

## Agentic Layer (Cloudflare Agents SDK)

Four Durable Object agents provide stateful, autonomous capabilities beyond the cron-based pipeline. They use the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) and are backed by DO-native SQLite for persistent state.

| Agent | Schedule | Purpose |
|-------|----------|---------|
| **PriceMonitorAgent** | Every 15 min | Detects price spikes/crashes (>30% 1d vs 30d) and viral social events (>3x normal mentions in 6h). Triggers immediate KV cache invalidation for affected cards. |
| **MarketIntelligenceAgent** | Daily 7am | Aggregates market movements, generates an AI-written daily briefing (via Llama 3.1 8B), stores last 30 reports in state. |
| **CompetitorTrackerAgent** | Every 6 hours | Compares GameStop's fair values against PriceCharting and CardHedger prices. Flags cards where GameStop is >15% above or below market. |
| **PricingRecommendationAgent** | Daily 8am | Generates BUY/SELL/REPRICE recommendations with a human approval queue. Recommendations expire after 48h. Tracks approval/rejection history. |

Agents are exposed via two interfaces:
- **REST API** at `/v1/agents/*` — routed through `src/routes/agents.ts` using `DurableObjectNamespace.get().fetch()`.
- **Agents SDK WebSocket/RPC** — routed via `routeAgentRequest()` in `src/index.ts` for real-time agent interaction.

Wrangler config declares 4 DO bindings and a DO migration (`tag: "v1"` with `new_sqlite_classes`).

## Security

The spec (section 7.1.1) defines security requirements for production. Current status:

| Requirement | Status |
|-------------|--------|
| **API key authentication** | Implemented — `X-API-Key` header validated against `API_KEY` secret. Skipped in development mode. (`middleware/auth.ts`) |
| **Rate limiting** | Implemented — KV-based sliding window, 120 requests/min per API key. Returns `429` with `X-RateLimit-Remaining` header. (`middleware/auth.ts`) |
| **CORS restriction** | Not started — still `cors("*")`. Must lock to GameStop domains. |
| **GameStop SSO for dashboard** | Not started. |
| **`seller_id` hashing** | Not started — stored as plaintext. |
| **Secrets management** | Implemented — all keys via `wrangler secret put`. |
| **D1 access restriction** | Implemented — Workers bindings only. |
