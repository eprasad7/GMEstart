# Product Requirements Document

## Problem

GameStop's collectibles business prices graded trading cards using daily batch scrapes from eBay. There is no price history storage, no sentiment analysis, and no ML-based pricing. Pricing decisions rely on manual lookup and operator judgment.

## Product Goal

Build a dynamic pricing engine that generates **fair value estimates with confidence intervals** for collectible trading cards, enabling automated buy/sell decisions with margin targets that account for marketplace fees, shipping, and returns.

## Users

| User              | Need                                                     |
|-------------------|----------------------------------------------------------|
| **Store associate**   | Instant buy/sell decision when a customer walks in with a card |
| **Pricing analyst**   | Market trends, anomalies, and portfolio-level price health   |
| **Inventory buyer**   | Batch evaluation of card lots at offered prices              |
| **Engineering team**  | Reliable data pipeline, model observability, clear APIs      |

## Use Cases

### UC-1: Real-Time Trade-In Pricing
A customer brings a PSA 10 Base Set Charizard to the counter. The associate enters the card and offered price. The system returns STRONG_BUY, REVIEW_BUY, FAIR_VALUE, or SELL_SIGNAL with margin estimate and reasoning.

### UC-2: Price Monitoring and Alerts
The pricing team receives alerts when a card's 7-day moving average diverges >30% from its 30-day average (spike or crash), or when social sentiment surges.

### UC-3: Market Overview
Analysts view market indices (Pokemon, sports), top movers, and trending cards from social media to make category-level buying decisions.

### UC-4: Batch Lot Evaluation
A buyer evaluates a lot of 50 cards at a single offered price per card. The system returns per-card decisions with aggregate margin estimate.

### UC-5: Anomaly Investigation
A pricing analyst investigates flagged anomalies — price outliers, data quality issues, or seller concentration patterns — and resolves alerts.

## Non-Goals

- **Retail customer-facing pricing page.** This is an internal tool.
- **Automated purchase execution.** The system recommends; humans decide.
- **Ungraded card pricing.** RAW cards are tracked for data completeness but pricing confidence is low.
- **Non-card collectibles.** Scoped to graded trading cards only (Pokemon, sports, TCG).

## Pricing Workflow

```
Customer arrives with card
        │
        ▼
  Associate enters card + offered price
        │
        ▼
  System fetches latest prediction (model_predictions table)
        │
        ├─ No prediction available → fall back to 90-day sales average
        │
        ▼
  Compute NRV (Net Realizable Value):
    NRV = fair_value × (1 - 13% marketplace fee) × (1 - 3% return rate) - $5 shipping
        │
        ▼
  Max buy price = NRV × (1 - 20% required margin)
        │
        ├─ offered_price < max_buy → STRONG_BUY (or REVIEW_BUY if LOW confidence)
        ├─ offered_price > p80     → SELL_SIGNAL
        └─ otherwise               → FAIR_VALUE
```

## Success Metrics

| Metric                           | Target        | Measurement                              |
|----------------------------------|---------------|------------------------------------------|
| Median Absolute % Error (MdAPE)  | < 15%         | Walk-forward backtest, stratified by volume |
| 90% prediction interval coverage | > 85%         | Actual prices within p10-p90 bands        |
| Evaluation latency (p95)         | < 200ms       | API response time for `/v1/evaluate`      |
| Data freshness                   | < 1 hour      | Time since last ingestion for active cards |
| Alert precision                  | > 80%         | % of alerts that analysts consider actionable |
| Buy decision accuracy            | > 70%         | % of STRONG_BUY cards that sell above buy price + margin target |

## Acceptance Criteria

1. API returns a price response for any card in the catalog within 200ms (cached or computed).
2. Buy/sell decisions include fair value, margin %, confidence level, and human-readable reasoning.
3. All data sources ingest on schedule with failures logged and recoverable.
4. Anomaly detection flags price outliers, seller concentration, and data quality issues daily.
5. Dashboard shows market overview, card search, evaluation tool, and alerts.
6. ML models are retrained on new data and deployed without downtime via R2 artifact swap.
