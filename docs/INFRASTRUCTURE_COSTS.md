# Infrastructure Costs

Estimated monthly Cloudflare costs for the GameCards Dynamic Pricing Engine, based on current [Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/) as of April 2026.

All estimates assume the **Workers Paid plan** ($5/mo base) and a catalog of **~5,000 cards** with active price tracking.

---

## Cost Summary

| Service        | Estimated Monthly Cost | Notes |
|----------------|----------------------:|-------|
| Workers Paid   | $5.00                 | Base plan — covers requests + CPU |
| D1             | $0.00 - $0.75        | Included in paid plan for this volume |
| KV             | $0.00                 | Well within included limits |
| R2             | $0.00                 | Free tier covers model artifacts |
| Queues         | $0.00 - $0.40        | ~1M ops/mo, within or near included |
| Workers AI     | $3.00 - $12.00       | Sentiment + NER, main variable cost |
| **Cloudflare total** | **$8 - $18/mo** | |
| SoldComps API  | $59.00               | External — licensed eBay data |
| PriceCharting  | $15 - $30            | External — aggregated prices |
| Reddit API     | $0.00                | Free tier (100 RPM sufficient) |
| **All-in total** | **$82 - $107/mo**  | Cloudflare + external data sources (free Reddit tier) |

---

## Detailed Breakdown

### Workers (Compute)

**Pricing:** $5/mo base includes 10M requests + 30M CPU ms.

| Source | Requests/mo | CPU ms/mo (est.) |
|--------|------------:|------------------:|
| API requests (price, evaluate, etc.) | ~100K | ~500K |
| Cron: SoldComps (every 15min) | ~2,880 | ~300K |
| Cron: Reddit (every 5min) | ~8,640 | ~900K |
| Cron: PriceCharting (daily) | ~30 | ~150K |
| Cron: Population (daily) | ~30 | ~100K |
| Cron: Aggregates + features (daily) | ~30 | ~2M |
| Cron: Batch predict (daily) | ~30 | ~1M |
| Cron: Anomaly detection (daily) | ~30 | ~500K |
| Cron: Sentiment rollup (hourly) | ~720 | ~300K |
| Queue consumers (ingestion + sentiment) | ~50K | ~1M |
| **Total** | **~162K** | **~6.8M** |

Both are well within the 10M request / 30M CPU ms included allowance. **No overage charges.**

**Cost: $5.00/mo** (base plan only)

### D1 (Database)

**Pricing:** 25B rows read + 50M rows written included. Overage: $0.001/M reads, $1.00/M writes. Storage: 5 GB included, $0.75/GB-mo.

| Operation | Estimate | How |
|-----------|----------|-----|
| **Rows read/mo** | ~50M | Cron jobs query card_catalog + price_observations + feature lookups. 5K cards × ~30 queries/day × ~30 rows/query × 30 days. API reads add ~5M. |
| **Rows written/mo** | ~500K | ~300K price observations + ~100K sentiment_raw + ~50K aggregates + ~15K features + ~15K predictions + ~5K alerts/logs. |
| **Storage** | ~0.5 - 2 GB | 5K cards, ~300K observations/mo accumulating. Indexes roughly double raw table size. Stays under 5 GB for the first year. |

All within included limits for the first year. As data accumulates past 5 GB, storage overage is $0.75/GB-mo.

**Cost: $0.00** (year 1), scaling to ~$0.75 - $3.00/mo as data grows past 5 GB.

### KV (Price Cache)

**Pricing:** 10M reads + 1M writes included. Overage: $0.50/M reads, $5.00/M writes. Storage: 1 GB included.

| Operation | Estimate | How |
|-----------|----------|-----|
| **Reads/mo** | ~200K | API price lookups (~100K) + market index cache reads + Reddit token cache reads. |
| **Writes/mo** | ~20K | Cache sets on price responses (~5K unique cards × ~3 cache misses/mo) + batch predict invalidations (~5K) + Reddit tokens. |
| **Storage** | < 10 MB | ~5K cached price responses (~1 KB each) + market index + Reddit token. |

Well within included limits.

**Cost: $0.00**

### R2 (Object Storage)

**Pricing:** 10 GB + 1M Class A + 10M Class B free. Then $0.015/GB-mo, $4.50/M Class A, $0.36/M Class B. No egress charges.

| Resource | Estimate | How |
|----------|----------|-----|
| **Storage** | < 100 MB | 7 ONNX models (~50-200 KB each) + metadata JSON + batch_predictions.json. |
| **Class A (writes)** | ~30/mo | Model uploads after retraining (weekly or less). |
| **Class B (reads)** | ~5K/mo | Model metadata reads (cached 5 min per isolate, ~30 reads/day × 30 days). Batch predictions JSON reads. |

Negligible — entirely within free tier.

**Cost: $0.00**

### Queues

**Pricing:** 1M operations/mo included. Overage: $0.40/M operations. Each message = 3 operations (write + read + delete).

| Queue | Messages/mo | Operations/mo |
|-------|------------:|--------------:|
| Ingestion (price observations) | ~300K | ~900K |
| Sentiment (Reddit posts) | ~50K | ~150K |
| **Total** | **~350K** | **~1.05M** |

Calculation: SoldComps sends ~10 cards × 50 results × 96 runs/day × 30 days = ~1.4M messages at peak, but realistically deduplication and sparse catalog keep it around 300K. Reddit sends ~175 posts/run × 288 runs/day × 30 days = ~1.5M raw, but only matched cards get queued (~3-5% match rate) = ~50K.

Borderline on the 1M included limit. Overage would be $0.40 for the next million.

**Cost: $0.00 - $0.40/mo**

### Workers AI

**Pricing:** $0.011 per 1,000 Neurons. 10,000 Neurons/day free (300K/mo).

This is the main variable cost because every Reddit post requires two AI calls:

#### Sentiment Classification (distilbert-sst-2-int8)

- **Rate:** 2,394 Neurons per 1M input tokens (~$0.026/M input tokens)
- **Usage:** ~50K posts/mo × ~100 tokens/post = 5M input tokens/mo
- **Neurons:** 5M × 2,394 / 1M = ~12K Neurons/mo
- **Cost:** ~$0.13/mo

#### Card Mention Extraction (llama-3.1-8b-instruct)

- **Rate:** 25,608 Neurons/M input tokens + 75,147 Neurons/M output tokens
- **Usage:** ~260K Reddit posts scanned/mo (before card matching) × ~200 input tokens + ~50 output tokens
- **Input Neurons:** 52M tokens × 25,608 / 1M = ~1.33M Neurons/mo
- **Output Neurons:** 13M tokens × 75,147 / 1M = ~977K Neurons/mo
- **Total Neurons:** ~2.3M Neurons/mo
- **Cost:** 2.3M / 1000 × $0.011 = **~$25/mo**

The Llama 3.1 NER extraction dominates AI costs because it runs on every Reddit post (not just matched ones). With the 300K free Neurons/mo, effective cost is:

**(2.3M - 300K) / 1000 × $0.011 = ~$22/mo**

#### Optimization Note

The Reddit NER step is the biggest cost lever. Options to reduce:
1. **Keyword pre-filter:** Only send posts to Llama that contain card-related keywords. A simple regex check (card names, set names, "PSA", "graded") could cut 80% of posts before hitting the LLM. This alone would drop AI cost from ~$22 to ~$3-5/mo.
2. **Use a smaller model** for NER if Cloudflare adds one.
3. **Reduce subreddit count** — the 7 subreddits could be trimmed to 3-4 high-signal ones.

With keyword pre-filtering (recommended):

**Cost: $3 - $5/mo**

Without pre-filtering:

**Cost: $20 - $25/mo**

---

## External Data Sources

These are not Cloudflare costs but are required for the system to function.

| Source | Cost | Tier | Notes |
|--------|-----:|------|-------|
| **SoldComps** | $59/mo | Scale | 5,000 req/mo, 240 results/req, 365 days eBay history |
| **PriceCharting** | $15-30/mo | Legendary | Aggregated market prices |
| **Reddit API** | $0/mo | Free | 100 RPM, sufficient for 7 subreddits every 5 min |
| **GemRate** | $0/mo | Free | Population report data |
| **CardHedger** | $49+/mo | — | Not yet integrated. Would add when ready. |
| **eBay Marketplace API** | Negotiate | — | Not yet available. Requires business relationship. |
| ML training compute (Modal/Railway) | $20-50/mo | — | Spec-recommended; not yet set up |

### Reddit API Tier: Free vs. Standard

The estimates above assume the **Reddit free tier** (100 requests/min), which is sufficient for 7 subreddits every 5 minutes. The updated spec's cost table includes **Reddit Standard tier at $1,000/mo** for commercial use. If GameStop requires the Standard tier for compliance with Reddit's commercial-use policy, the all-in total rises to **~$1,082 - $1,107/mo**.

The spec's overall budget of ~$1,800-1,900/mo also includes PokemonPriceTracker ($99/mo), Twitter/X ($500/mo, Phase 2+), and ML training compute — services not yet integrated.

---

## Scaling Scenarios

### 5K Cards (Current Target)

The numbers above. **~$82-107/mo all-in.**

### 25K Cards

| Change | Impact |
|--------|--------|
| D1 rows read | ~250M/mo — still within 25B included |
| D1 rows written | ~2.5M/mo — still within 50M included |
| D1 storage | 5-10 GB by end of year 1 — $0-$4/mo overage |
| Batch predict CPU | ~5M CPU ms/mo — still within 30M |
| SoldComps | May need higher tier if 5K req/mo limit is hit |
| Workers AI | Scales linearly with Reddit volume, not card count |

**Estimated: ~$90-120/mo.** Cloudflare costs barely change; SoldComps tier might need an upgrade.

### 100K Cards

| Change | Impact |
|--------|--------|
| D1 rows read | ~1B/mo — within 25B included |
| D1 rows written | ~10M/mo — within 50M included |
| D1 storage | 20-50 GB — $11-$34/mo storage overage |
| Feature computation | CPU usage increases to ~15M CPU ms/mo |
| SoldComps | Likely need Enterprise tier |
| KV | Cache size grows but still well under 1 GB |

**Estimated: ~$120-180/mo** Cloudflare + renegotiated data source contracts.

---

## Cost Comparison: Cloudflare vs. Original AWS Architecture

The original spec proposed TimescaleDB + Airflow + FastAPI + Redis + S3 on AWS at ~$3,932/mo total. The updated spec moved to Cloudflare at ~$1,800-1,900/mo total (including all external APIs). Infrastructure costs specifically:

| Component | Original (AWS) | Actual (Cloudflare) |
|-----------|---------------:|--------------------:|
| Database | RDS/TimescaleDB: $50-200/mo | D1: $0-3/mo |
| Compute | ECS/Lambda + Airflow: $50-150/mo | Workers: $5/mo |
| Cache | ElastiCache Redis: $15-50/mo | KV: $0/mo |
| Object storage | S3: $1-5/mo | R2: $0/mo |
| Queue | SQS: $1-5/mo | Queues: $0-0.40/mo |
| ML inference | SageMaker/Lambda: $20-100/mo | Workers AI: $3-12/mo |
| Orchestration | Airflow (managed): $50-200/mo | Cron Triggers: $0/mo |
| Monitoring | Grafana + Prometheus: ~$200/mo | Analytics Engine: $0/mo |
| ML training compute | Included in AWS | Modal/Railway: $20-50/mo |
| MLflow | $200/mo hosted | $0-20/mo self-hosted |
| **Infra total** | **~$2,200/mo** | **$28 - $88/mo** |

The Cloudflare architecture is 25-80x cheaper for infrastructure at this scale, primarily because D1, KV, R2, and Queues have generous free tiers and Workers includes 10M requests. The overall budget difference ($3,932 → $1,800-1,900) is smaller because external API costs (SoldComps, PriceCharting, Reddit Standard) dominate.

---

## Free Tier Feasibility

For development and low-traffic testing, the Workers Free plan covers:

| Service | Free Limit | GameCards Dev Usage | Fits? |
|---------|-----------|-------------------|-------|
| Workers | 100K req/day | ~5K/day | Yes |
| D1 | 5M reads + 100K writes/day | ~1.7M reads + ~17K writes/day | Yes |
| KV | 100K reads + 1K writes/day | ~7K reads + ~700 writes/day | Yes |
| R2 | 10 GB + 1M Class A + 10M Class B/mo | < 100 MB + 30 Class A + 5K Class B | Yes |
| Queues | 10K ops/day | ~35K ops/day | **No** — need paid plan for production cron volumes |
| Workers AI | 10K Neurons/day | ~77K Neurons/day | **No** — need paid plan for Reddit NER |

**Verdict:** Development and testing works on the free tier if you disable Reddit ingestion and reduce cron frequency. Production requires the $5/mo paid plan.

Sources:
- [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [KV Pricing](https://developers.cloudflare.com/kv/platform/pricing/)
- [R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [Queues Pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- [Workers AI Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
