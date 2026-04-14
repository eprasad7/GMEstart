# API Specification

Base URL: `https://<worker>.workers.dev/v1`

All responses are JSON. Errors return `{ "error": "<message>" }` with an appropriate HTTP status code.

---

## Health Check

```
GET /
```

**Response** `200`
```json
{
  "service": "GameCards Dynamic Pricing Engine",
  "version": "1.0.0",
  "status": "healthy"
}
```

---

## Cards

### Search Cards

```
GET /v1/cards/search?q=charizard&category=pokemon&limit=20&offset=0
```

| Param      | Type   | Default | Description                           |
|------------|--------|---------|---------------------------------------|
| `q`        | string |         | Search name, player_character, set_name (LIKE match) |
| `category` | string |         | Filter by category enum               |
| `limit`    | int    | 20      | Max 100                               |
| `offset`   | int    | 0       | Pagination offset                     |

**Response** `200`
```json
{
  "cards": [
    {
      "id": "pokemon-base-set-4",
      "name": "Charizard",
      "set_name": "Base Set",
      "set_year": 1999,
      "card_number": "4",
      "category": "pokemon",
      "player_character": "Charizard",
      "team": null,
      "rarity": "Holo Rare",
      "image_url": null,
      "pricecharting_id": "12345",
      "psa_cert_lookup_id": "67890",
      "created_at": "2026-04-10T00:00:00.000Z",
      "updated_at": "2026-04-14T00:00:00.000Z"
    }
  ],
  "meta": { "limit": 20, "offset": 0 }
}
```

### Get Card

```
GET /v1/cards/:id
```

**Response** `200` — single Card object (same shape as above).

**Response** `404`
```json
{ "error": "Card not found" }
```

### Create/Upsert Card

```
POST /v1/cards/
Content-Type: application/json
```

**Request Body**
```json
{
  "name": "Charizard",
  "set_name": "Base Set",
  "set_year": 1999,
  "card_number": "4",
  "category": "pokemon",
  "player_character": "Charizard",
  "rarity": "Holo Rare",
  "pricecharting_id": "12345",
  "psa_cert_lookup_id": "67890"
}
```

Optional fields: `id` (auto-generated from category-set-number if omitted), `team`, `image_url`.

**Response** `201`
```json
{ "id": "pokemon-base-set-4", "status": "created" }
```

### Bulk Upsert Cards

```
POST /v1/cards/bulk
Content-Type: application/json
```

**Request Body**
```json
{
  "cards": [
    { "name": "Charizard", "set_name": "Base Set", "set_year": 1999, "card_number": "4", "category": "pokemon" },
    { "name": "Pikachu", "set_name": "Base Set", "set_year": 1999, "card_number": "58", "category": "pokemon" }
  ]
}
```

**Response** `200`
```json
{ "status": "ok", "count": 2 }
```

---

## Prices

### Get Current Price

```
GET /v1/price/:cardId?grade=10&grading_company=PSA
```

| Param             | Type   | Default | Description        |
|-------------------|--------|---------|--------------------|
| `grade`           | string | `RAW`   | Grade value        |
| `grading_company` | string | `RAW`   | PSA, BGS, CGC, SGC, RAW |

Checks KV cache (5-min TTL), then reads latest `model_predictions` row.

**Response** `200`
```json
{
  "card_id": "pokemon-base-set-4",
  "card_name": "Charizard",
  "grade": "10",
  "grading_company": "PSA",
  "price": 245.00,
  "lower": 195.00,
  "upper": 310.00,
  "confidence": "HIGH",
  "last_sale": "2026-04-12",
  "sales_30d": 18,
  "trend": "rising",
  "updated_at": "2026-04-14T05:00:00.000Z"
}
```

**Trend logic:** `rising` if 7d MA > 30d MA * 1.05, `falling` if 7d MA < 30d MA * 0.95, else `stable`.

**Response** `404`
```json
{ "error": "No pricing data available for this card" }
```

### Get All Grades

```
GET /v1/price/:cardId/all
```

**Response** `200`
```json
{
  "card_id": "pokemon-base-set-4",
  "grades": [
    {
      "card_id": "pokemon-base-set-4",
      "card_name": "Charizard",
      "grade": "9",
      "grading_company": "PSA",
      "fair_value": 120.00,
      "p10": 85.00,
      "p25": 100.00,
      "p50": 120.00,
      "p75": 145.00,
      "p90": 170.00,
      "confidence": "MEDIUM",
      "volume_bucket": "medium"
    }
  ]
}
```

---

## History

### Raw Price History

```
GET /v1/history/:cardId?grade=10&grading_company=PSA&days=90&source=soldcomps
```

| Param             | Type   | Default | Description        |
|-------------------|--------|---------|--------------------|
| `grade`           | string |         | Filter by grade    |
| `grading_company` | string |         | Filter by company  |
| `days`            | int    | 90      | Lookback window    |
| `source`          | string |         | Filter by source   |

Returns up to 500 non-anomalous observations, newest first.

**Response** `200`
```json
{
  "card_id": "pokemon-base-set-4",
  "sales": [
    {
      "id": 1234,
      "card_id": "pokemon-base-set-4",
      "card_name": "Charizard",
      "source": "soldcomps",
      "price_usd": 250.00,
      "sale_date": "2026-04-12",
      "grade": "10",
      "grading_company": "PSA",
      "sale_type": "auction",
      "listing_url": "https://ebay.com/...",
      "seller_id": "seller123",
      "bid_count": 12,
      "is_anomaly": 0
    }
  ]
}
```

### Aggregated History

```
GET /v1/history/:cardId/aggregates?grade=10&grading_company=PSA&period=daily&days=90
```

| Param             | Type   | Default | Description                 |
|-------------------|--------|---------|-----------------------------|
| `grade`           | string | `10`    | Grade value                 |
| `grading_company` | string | `PSA`   | Grading company             |
| `period`          | string | `daily` | `daily`, `weekly`, `monthly`|
| `days`            | int    | 90      | Lookback window             |

**Response** `200`
```json
{
  "card_id": "pokemon-base-set-4",
  "aggregates": [
    {
      "card_id": "pokemon-base-set-4",
      "grade": "10",
      "grading_company": "PSA",
      "period": "daily",
      "period_start": "2026-04-13",
      "avg_price": 248.50,
      "median_price": 248.50,
      "min_price": 240.00,
      "max_price": 257.00,
      "sale_count": 3,
      "volume_bucket": "medium"
    }
  ]
}
```

---

## Evaluate

### Buy/Sell Decision

```
POST /v1/evaluate
Content-Type: application/json
```

**Request Body**
```json
{
  "card_id": "pokemon-base-set-4",
  "offered_price": 150.00,
  "grade": "10",
  "grading_company": "PSA"
}
```

`grade` defaults to `"RAW"`, `grading_company` defaults to `"RAW"`.

**Response** `200`
```json
{
  "decision": "STRONG_BUY",
  "fair_value": 245.00,
  "margin": 24.6,
  "confidence": "HIGH",
  "reasoning": "Price $150.00 is below max buy price $159.60 (NRV: $199.50, fair value: $245.00). Expected 24.6% net margin after fees, shipping, and returns. HIGH confidence, high volume."
}
```

**Decision values:**
- `STRONG_BUY` — price below max buy and confidence is MEDIUM or HIGH
- `REVIEW_BUY` — price below max buy but confidence is LOW
- `FAIR_VALUE` — price is between max buy and p80 (not a strong buy, not a sell)
- `SELL_SIGNAL` — price exceeds p80

**Response** `400`
```json
{ "error": "card_id and offered_price are required" }
```

**Response** `404`
```json
{ "error": "Insufficient data to evaluate this card" }
```

---

## Sentiment

### Card Sentiment Score

```
GET /v1/sentiment/:cardId
```

**Response** `200`
```json
{
  "card_id": "pokemon-base-set-4",
  "score": 0.65,
  "mentions_7d": 47,
  "trend": "rising",
  "breakdown": [
    {
      "card_id": "pokemon-base-set-4",
      "source": "reddit",
      "score": 0.72,
      "mention_count": 12,
      "period": "24h",
      "top_posts": "[\"https://reddit.com/...\"]",
      "rollup_date": "2026-04-14"
    }
  ],
  "top_posts": ["https://reddit.com/..."]
}
```

**Composite score:** weighted average across periods: 24h (weight 0.5) + 7d (0.3) + 30d (0.2).

**Trend values:** `spiking` (24h > 7d * 1.3), `rising` (> 1.1), `falling` (< 0.9), `crashing` (< 0.7), `stable`.

### Trending Cards

```
GET /v1/sentiment/trending/all?limit=20
```

| Param   | Type | Default | Description |
|---------|------|---------|-------------|
| `limit` | int  | 20      | Max 50      |

Returns cards with >5 mentions in the last 24h, sorted by score descending.

**Response** `200`
```json
{
  "trending": [
    {
      "card_id": "pokemon-base-set-4",
      "name": "Charizard",
      "category": "pokemon",
      "score": 0.85,
      "mention_count": 23,
      "source": "reddit",
      "period": "24h"
    }
  ]
}
```

---

## Alerts

### Active Alerts

```
GET /v1/alerts/active?category=pokemon&type=price_spike&limit=50
```

| Param      | Type   | Default | Description                       |
|------------|--------|---------|-----------------------------------|
| `category` | string |         | Filter by card category           |
| `type`     | string |         | Filter by alert_type enum         |
| `limit`    | int    | 50      | Max 200                           |

**Response** `200`
```json
{
  "alerts": [
    {
      "id": 42,
      "card_id": "pokemon-base-set-4",
      "card_name": "Charizard",
      "category": "pokemon",
      "alert_type": "price_spike",
      "magnitude": 35.2,
      "trigger_source": "anomaly_detection",
      "message": "Price spike: +35.2% (7d avg $312.00 vs 30d avg $230.80)",
      "is_active": 1,
      "created_at": "2026-04-14T06:00:00.000Z",
      "resolved_at": null
    }
  ]
}
```

**Alert types:** `price_spike`, `price_crash`, `viral_social`, `anomaly_detected`, `new_high`, `new_low`.

### Resolve Alert

```
POST /v1/alerts/:id/resolve
```

**Response** `200`
```json
{ "status": "resolved" }
```

### Alert History

```
GET /v1/alerts/history?days=30&limit=100
```

| Param   | Type | Default | Description          |
|---------|------|---------|----------------------|
| `days`  | int  | 30      | Lookback window      |
| `limit` | int  | 100     | Max 500              |

Returns all alerts (active + resolved) within the date range.

---

## Market

### Market Index

```
GET /v1/market/index
```

KV cached for 15 minutes.

**Response** `200`
```json
{
  "pokemon_index": 1284500,
  "sports_index": 892300,
  "trend_30d": "+3.2%",
  "volatility": "moderate",
  "updated_at": "2026-04-14T12:00:00.000Z"
}
```

**Index:** `AVG(price_usd) * COUNT(DISTINCT card_id)` for the category over the last 30 days.

**Volatility:** coefficient of variation of daily average prices. `high` (CV > 0.15), `moderate` (> 0.08), `low`.

### Price Movers

```
GET /v1/market/movers?direction=up&days=7&limit=20
```

| Param       | Type   | Default | Description                    |
|-------------|--------|---------|--------------------------------|
| `direction` | string | `up`    | `up` or `down`                 |
| `days`      | int    | 7       | Compare recent N days to prior N days |
| `limit`     | int    | 20      | Max 50                         |

**Response** `200`
```json
{
  "direction": "up",
  "days": 7,
  "movers": [
    {
      "card_id": "pokemon-base-set-4",
      "name": "Charizard",
      "category": "pokemon",
      "grading_company": "PSA",
      "grade": "10",
      "recent_avg": 312.00,
      "prior_avg": 230.80,
      "change_pct": 35.2
    }
  ]
}
```

---

## Error Shapes

All errors follow the same shape:

```json
{ "error": "<human-readable message>" }
```

| Status | When |
|--------|------|
| 400    | Missing or invalid request parameters |
| 404    | Card not found, or insufficient data for evaluation |
| 500    | Internal error (D1 query failure, external API error) |
