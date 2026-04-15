# GameCards Dynamic Pricing Engine

A real-time dynamic pricing engine for collectible trading cards (Pokemon, sports, TCG) built on Cloudflare Workers. Combines multi-source market data, social sentiment analysis, ML-based price prediction with uncertainty quantification, and anomaly detection.

## Architecture

```
apps/api/          Cloudflare Worker — Hono API, D1, KV, R2, Queues, Workers AI
apps/web/          React dashboard — Vite, TanStack Query, Recharts, Tailwind v4
packages/ml-training/  Python ML pipeline — LightGBM quantile regression, ONNX export
```

**Cloudflare bindings:**

| Binding            | Service | Purpose                              |
|--------------------|---------|--------------------------------------|
| `DB`               | D1      | SQLite database (12 tables)          |
| `PRICE_CACHE`      | KV      | Hot price cache, rate limiting       |
| `MODELS`           | R2      | ONNX model artifacts                 |
| `DATA_ARCHIVE`     | R2      | Raw data exports                     |
| `INGESTION_QUEUE`  | Queue   | Async price observation processing   |
| `SENTIMENT_QUEUE`  | Queue   | Async sentiment analysis via Workers AI |
| `AI`               | Workers AI | Sentiment classification, NER       |
| `PriceMonitorAgent` | Durable Object | Real-time price anomaly detection |
| `MarketIntelligenceAgent` | Durable Object | AI-generated daily market briefs |
| `CompetitorTrackerAgent` | Durable Object | Cross-platform price comparison |
| `PricingRecommendationAgent` | Durable Object | Buy/sell/reprice approval queue |

## Quick Start

**Prerequisites:** Node.js >= 20, pnpm, Wrangler CLI (`npm i -g wrangler`)

```bash
# Install dependencies
pnpm install

# Run API locally (uses local D1, KV, R2, Queues)
pnpm dev:api

# Run dashboard locally
pnpm dev:web
```

### Database Setup

```bash
# Create D1 database (first time)
wrangler d1 create gamecards-db

# Apply migrations (local)
pnpm db:migrate

# Apply migrations (remote)
pnpm --filter api db:migrate:prod
```

### Set Secrets

```bash
cd apps/api
wrangler secret put SOLDCOMPS_API_KEY
wrangler secret put PRICECHARTING_API_KEY
wrangler secret put REDDIT_CLIENT_ID
wrangler secret put REDDIT_CLIENT_SECRET
```

### Deploy

```bash
pnpm deploy:api    # Cloudflare Workers
pnpm deploy:web    # Cloudflare Pages (or Vite build + static host)
```

## Workspace Commands

| Command             | Description                          |
|---------------------|--------------------------------------|
| `pnpm dev:api`      | Start API dev server (Wrangler)      |
| `pnpm dev:web`      | Start dashboard dev server (Vite)    |
| `pnpm deploy:api`   | Deploy API to Cloudflare Workers (dev) |
| `pnpm --filter api deploy:prod` | Deploy API to production   |
| `pnpm deploy:web`   | Deploy dashboard                     |
| `pnpm db:migrate`   | Run D1 migrations locally            |
| `pnpm --filter api test` | Run API tests (Vitest)          |
| `pnpm typecheck`    | Typecheck all packages               |

### ML Training Pipeline

```bash
cd packages/ml-training
pip install -e .

# Export features and training data from D1
gamecards-export-features \
  --account-id YOUR_CF_ACCOUNT_ID \
  --database-id YOUR_D1_DATABASE_ID \
  --api-token YOUR_CF_API_TOKEN \
  --output-features features.csv \
  --output-training training_data.csv

# Train models
gamecards-train --data training_data.csv --output models/

# Walk-forward backtest
gamecards-backtest --data training_data.csv

# Export to ONNX and upload to R2
gamecards-export --model-dir models/ --output onnx_models/ --upload

# Batch-score all cards and upload to R2
gamecards-score --model-dir models/ --features features.csv --upload

# Or run the full pipeline in one shot:
./scripts/run_pipeline.sh training_data.csv features.csv
```

## Environment Variables

**Secrets** (via `wrangler secret put`):

| Variable                  | Description                       |
|---------------------------|-----------------------------------|
| `API_KEY`                 | API authentication key (required in production) |
| `SOLDCOMPS_API_KEY`       | SoldComps API token               |
| `PRICECHARTING_API_KEY`   | PriceCharting API token           |
| `CARDHEDGER_API_KEY`      | CardHedger API token (future)     |
| `REDDIT_CLIENT_ID`        | Reddit OAuth app client ID        |
| `REDDIT_CLIENT_SECRET`    | Reddit OAuth app client secret    |
| `POKEMON_PRICE_TRACKER_KEY` | PokemonPriceTracker API key (future) |

**Authentication:** All `/v1/*` endpoints require an `X-API-Key` header in production. Skipped when `ENVIRONMENT=development`. Rate limited to 120 requests/min per key.

**Config** (via `wrangler.jsonc` vars):

| Variable      | Default       | Description         |
|---------------|---------------|---------------------|
| `ENVIRONMENT` | `development` | Runtime environment |

## API

Base path: `/v1`

| Method | Endpoint                         | Description                    |
|--------|----------------------------------|--------------------------------|
| GET    | `/v1/price/:cardId`              | Current price + confidence     |
| GET    | `/v1/price/:cardId/all`          | All grades for a card          |
| GET    | `/v1/history/:cardId`            | Raw price observations         |
| GET    | `/v1/history/:cardId/aggregates` | Daily/weekly/monthly rollups   |
| POST   | `/v1/evaluate`                   | Buy/sell decision              |
| GET    | `/v1/sentiment/:cardId`          | Composite sentiment score      |
| GET    | `/v1/sentiment/trending/all`     | Cards with spiking sentiment   |
| GET    | `/v1/alerts/active`              | Active price alerts            |
| POST   | `/v1/alerts/:id/resolve`         | Resolve an alert               |
| GET    | `/v1/alerts/history`             | Resolved alerts history        |
| GET    | `/v1/market/index`               | Market indices + trend         |
| GET    | `/v1/market/movers`              | Biggest price movers           |
| GET    | `/v1/cards/search`               | Search card catalog            |
| GET    | `/v1/cards/:id`                  | Get card details               |
| POST   | `/v1/cards/`                     | Create/upsert card             |
| POST   | `/v1/cards/bulk`                 | Bulk upsert cards              |
| GET    | `/v1/agents/monitor/status`      | Price monitor agent status     |
| POST   | `/v1/agents/monitor/check`       | Trigger monitoring check       |
| GET    | `/v1/agents/intelligence/latest` | Latest market report           |
| POST   | `/v1/agents/intelligence/generate` | Generate market report       |
| GET    | `/v1/agents/competitors/gaps`    | Competitor price gaps          |
| GET    | `/v1/agents/recommendations/pending` | Pending buy/sell recommendations |
| POST   | `/v1/agents/recommendations/:id/approve` | Approve a recommendation |
| POST   | `/v1/agents/recommendations/:id/reject` | Reject a recommendation |
| GET    | `/v1/system/health`              | Pipeline health + prediction freshness |
| GET    | `/v1/system/model`               | Current model version metadata |
| POST   | `/v1/system/rollback`            | Rollback to a previous prediction version |
| POST   | `/v1/system/bootstrap`           | Bootstrap card catalog from PriceCharting CSV |

See [docs/API_SPEC.md](docs/API_SPEC.md) for full request/response contracts.

## Documentation

| Document                                                          | Description                                        |
|-------------------------------------------------------------------|----------------------------------------------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                     | System architecture and data flow                  |
| [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md)   | What's implemented, partial, or planned            |
| [docs/API_SPEC.md](docs/API_SPEC.md)                             | API request/response contracts                     |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md)                         | Database schema, table purposes, invariants        |
| [docs/ML_DESIGN.md](docs/ML_DESIGN.md)                           | Feature set, training, serving, fallback behavior  |
| [docs/OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md)         | Deploy, migrate, backfill, rotate secrets          |
| [docs/INFRASTRUCTURE_COSTS.md](docs/INFRASTRUCTURE_COSTS.md)     | Cloudflare + external API cost estimates           |
| [docs/PRD.md](docs/PRD.md)                                       | Product goals, users, use cases, success metrics   |
| [GameStop_Dynamic_Pricing_Solution.md](GameStop_Dynamic_Pricing_Solution.md) | Original technical spec and vision doc |
