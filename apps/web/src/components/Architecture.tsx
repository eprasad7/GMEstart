import {
  Database,
  Bot,
  TrendingUp,
  Shield,
  Activity,
  Zap,
  Globe,
  Cpu,
  ArrowDown,
  Layers,
  Brain,
  Target,
  AlertTriangle,
  CheckCircle2,
  BarChart3,
} from "lucide-react";

export function Architecture() {
  return (
    <div className="space-y-16 pb-12">
      {/* ─── Hero ─── */}
      <div className="text-center pt-4">
        <h1 className="text-3xl font-extrabold text-text-primary">How GMEstart Works</h1>
        <p className="mt-2 text-base text-text-secondary max-w-2xl mx-auto">
          A real-time collectibles pricing engine that combines multi-source market data,
          ML prediction with uncertainty quantification, and autonomous AI agents — all running
          on Cloudflare's global edge.
        </p>
      </div>

      {/* ─── Data Flow Diagram ─── */}
      <section>
        <SectionHeader icon={<Layers className="h-6 w-6" />} title="Data Pipeline" />

        {/* Row 1: Sources */}
        <div className="mt-8 grid grid-cols-3 gap-4 max-w-4xl mx-auto">
          <SourceCard icon={<BarChart3 />} name="eBay / SoldComps" detail="1,000+ sold listings every 15 min" color="text-info" />
          <SourceCard icon={<Database />} name="PriceCharting" detail="Daily reference prices for 500+ cards" color="text-buy" />
          <SourceCard icon={<Globe />} name="Reddit / GemRate" detail="Social sentiment + PSA population data" color="text-accent" />
        </div>

        {/* Arrow down */}
        <div className="flex justify-center my-4">
          <div className="flex flex-col items-center gap-1">
            <ArrowDown className="h-6 w-6 text-text-muted" />
            <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">Cron Triggers + Queues</span>
          </div>
        </div>

        {/* Row 2: Processing pipeline — simple 4-col grid */}
        <div className="max-w-5xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-4">
          <PipelineBlock
            number="1"
            title="Anomaly Detection"
            icon={<AlertTriangle className="h-5 w-5" />}
            color="bg-sell/10 border-sell/20 text-sell"
            items={["IQR outlier flagging", "Seller concentration", "Best Offer 0.80x discount", "Lot/bundle filtering"]}
          />
          <PipelineBlock
            number="2"
            title="Feature Engineering"
            icon={<Cpu className="h-5 w-5" />}
            color="bg-hold/10 border-hold/20 text-hold"
            items={["22 features per card", "Grade + population", "Price momentum", "Social sentiment"]}
          />
          <PipelineBlock
            number="3"
            title="ML Prediction"
            icon={<Brain className="h-5 w-5" />}
            color="bg-buy/10 border-buy/20 text-buy"
            items={["7 quantile models", "Confidence intervals", "NRV buy thresholds", "Volume-aware routing"]}
          />
          <PipelineBlock
            number="4"
            title="Serving"
            icon={<Zap className="h-5 w-5" />}
            color="bg-info/10 border-info/20 text-info"
            items={["<5ms edge lookups", "KV price cache", "Real-time evaluate", "Dashboard + API"]}
          />
        </div>

        {/* Stats bar */}
        <div className="mt-8 max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatBlock value="700+" label="Predictions generated daily" />
          <StatBlock value="1,880" label="Population records scraped" />
          <StatBlock value="2,000+" label="eBay sales ingested daily" />
          <StatBlock value="<5ms" label="Price lookup latency" />
        </div>
      </section>

      {/* ─── ML Model ─── */}
      <section>
        <SectionHeader icon={<Brain className="h-6 w-6" />} title="ML Pricing Model" />

        <div className="mt-8 max-w-5xl mx-auto grid gap-8 lg:grid-cols-5">
          {/* Left: NRV explanation */}
          <div className="lg:col-span-2 space-y-4">
            <h3 className="text-lg font-bold text-text-primary">From Fair Value to Buy Decision</h3>
            <p className="text-sm text-text-secondary">
              The model doesn't just predict a price — it computes the full economic picture
              for a retail trade-in decision, accounting for fees, shipping, returns, and margin targets.
            </p>

            <div className="space-y-3">
              <NrvStep
                number="1"
                label="Fair Value"
                value="$191.20"
                desc="LightGBM quantile regression (p50 median)"
                color="text-text-primary"
              />
              <div className="pl-6 border-l-2 border-border">
                <p className="text-xs text-text-muted italic">minus 13% marketplace fees, $5 shipping, 3% returns</p>
              </div>
              <NrvStep
                number="2"
                label="Net Realizable Value"
                value="$153.87"
                desc="What GameStop actually nets after a sale"
                color="text-info"
              />
              <div className="pl-6 border-l-2 border-border">
                <p className="text-xs text-text-muted italic">then adjusted by inventory, demand, competition, channel</p>
              </div>
              <NrvStep
                number="3"
                label="Optimized List Price"
                value="$223.33"
                desc="+3% demand, +8% underpriced vs market, +5% in-store"
                color="text-accent"
              />
              <NrvStep
                number="4"
                label="Max Trade-In Offer"
                value="$178.66"
                desc="Highest price we'd pay and still hit margin target"
                color="text-buy"
              />
              <div className="rounded-lg border-2 border-buy/30 bg-buy/5 p-3 mt-2">
                <p className="text-sm font-semibold text-buy">Customer offers $120? → BUY</p>
                <p className="text-xs text-text-secondary mt-0.5">$103 expected profit in ~15 days. Risk: medium.</p>
              </div>
            </div>
          </div>

          {/* Right: Feature importance */}
          <div className="lg:col-span-3 rounded-xl border border-border bg-bg-card p-6 shadow-sm">
            <h3 className="text-lg font-bold text-text-primary mb-1">Feature Importance</h3>
            <p className="text-xs text-text-muted mb-5">22 features across 7 groups — what drives the price prediction</p>

            <div className="space-y-4">
              <FeatureBar label="Grade + Population" pct={28} color="bg-accent" example="PSA 10 with pop 5 vs pop 500 = 10x difference" />
              <FeatureBar label="Recent Sale Prices" pct={20} color="bg-info" example="7d/30d/90d moving averages and momentum" />
              <FeatureBar label="Demand Velocity" pct={18} color="bg-buy" example="Sales per week trend — accelerating or cooling" />
              <FeatureBar label="Population Supply" pct={12} color="bg-warning" example="How many exist at this grade, growth rate" />
              <FeatureBar label="GameStop Internal" pct={9} color="bg-sell" example="Trade-in volume, inventory days, store views" />
              <FeatureBar label="Social Sentiment" pct={8} color="bg-accent" example="Reddit mentions, viral detection, trend direction" />
              <FeatureBar label="Seasonality" pct={5} color="bg-hold" example="Holiday season, tax refund period, sport season" />
            </div>
          </div>
        </div>
      </section>

      {/* ─── Trade-In Decision Engine ─── */}
      <section>
        <SectionHeader icon={<Target className="h-6 w-6" />} title="Trade-In Decision Engine" />
        <p className="text-sm text-text-secondary mt-2 max-w-3xl">
          When a customer walks into a GameStop store with a card, the system tells the associate
          whether to buy it, at what price, and what profit to expect — in real time, at the counter.
        </p>

        <div className="mt-8 max-w-5xl mx-auto">
          {/* Scenario walkthrough */}
          <div className="rounded-xl border border-border bg-bg-card shadow-sm overflow-hidden">
            <div className="bg-bg-nav px-6 py-4">
              <p className="text-base font-bold text-text-inverse">Scenario: Customer offers $120 for a Charizard #4</p>
              <p className="text-xs text-text-inverse/60 mt-0.5">Store associate scans the card — system responds in &lt;100ms</p>
            </div>

            <div className="p-6 grid gap-6 lg:grid-cols-3">
              {/* Column 1: Decision */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Decision</p>
                <div className="rounded-lg bg-buy/10 border border-buy/20 p-4 text-center">
                  <p className="text-2xl font-extrabold text-buy">BUY</p>
                  <p className="text-xs text-text-secondary mt-1">Below max offer — profitable trade-in</p>
                </div>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-text-muted">Fair Value</span><span className="font-semibold text-text-primary">$191.20</span></div>
                  <div className="flex justify-between"><span className="text-text-muted">List Price</span><span className="font-semibold text-text-primary">$223.33</span></div>
                  <div className="flex justify-between"><span className="text-text-muted">Max Offer</span><span className="font-semibold text-buy">$178.66</span></div>
                  <div className="flex justify-between"><span className="text-text-muted">Customer Asks</span><span className="font-semibold text-text-primary">$120.00</span></div>
                </div>
              </div>

              {/* Column 2: Adjustments */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Price Adjustments</p>
                <div className="space-y-2">
                  <AdjustmentRow label="Accelerating demand" impact="+3%" color="text-buy" />
                  <AdjustmentRow label="Underpriced vs market by 43%" impact="+8%" color="text-buy" />
                  <AdjustmentRow label="In-store premium (impulse)" impact="+5%" color="text-buy" />
                </div>
                <div className="mt-4 rounded-lg bg-bg-secondary p-3">
                  <p className="text-xs text-text-muted">Other possible adjustments:</p>
                  <div className="mt-1 space-y-1 text-xs text-text-secondary">
                    <p>Overstocked (8 units, 45d aging) → <span className="text-sell">-5%</span></p>
                    <p>Low sell-through (20%) → <span className="text-sell">-8%</span></p>
                    <p>Viral social spike → <span className="text-hold font-semibold">HOLD</span></p>
                    <p>Pop growing 20%+ → <span className="text-sell">-3%</span></p>
                  </div>
                </div>
              </div>

              {/* Column 3: Risk */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Risk Assessment</p>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm"><span className="text-text-muted">Expected Profit</span><span className="font-bold text-buy">$103.33</span></div>
                  <div className="flex justify-between text-sm"><span className="text-text-muted">Days to Sell</span><span className="font-semibold text-text-primary">~15 days</span></div>
                  <div className="flex justify-between text-sm"><span className="text-text-muted">Risk Level</span><span className="rounded bg-hold/10 px-2 py-0.5 text-xs font-bold text-hold">MEDIUM</span></div>
                  <div className="flex justify-between text-sm"><span className="text-text-muted">Worst Case Exit</span><span className="font-semibold text-text-primary">$133.08</span></div>
                  <div className="flex justify-between text-sm"><span className="text-text-muted">Confidence</span><span className="font-semibold text-text-primary">LOW</span></div>
                </div>
                <div className="mt-4 rounded-lg bg-bg-secondary p-3 text-xs text-text-muted">
                  <p className="font-medium text-text-secondary mb-1">Worst case:</p>
                  <p>Liquidate on eBay at 80% of fair value minus 13% fees = $133. Still profitable at $120 buy price.</p>
                </div>
              </div>
            </div>

            <div className="border-t border-border px-6 py-3 bg-bg-secondary">
              <p className="text-xs text-text-muted">
                This combines ML fair value, real-time inventory position, demand velocity, competitive pricing, and social sentiment — evaluated in &lt;100ms at the point of sale. It moves beyond "what is this card worth" to "should we buy it, and at what price."
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Agents ─── */}
      <section>
        <SectionHeader icon={<Bot className="h-6 w-6" />} title="Autonomous Agents" />
        <p className="text-sm text-text-secondary mt-2 max-w-3xl">
          Four Durable Objects run autonomously on Cloudflare's edge. Each maintains persistent state,
          runs on its own schedule, and can be triggered on-demand from the dashboard.
        </p>

        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <AgentCard
            icon={<Activity className="h-6 w-6 text-accent" />}
            name="Price Monitor"
            schedule="Every 15 min"
            desc="Detects price spikes (>30% from 30d average) and viral social events (>3x normal mention volume in 6 hours). Triggers immediate cache invalidation so the next price lookup reflects the new reality."
            capabilities={["Real-time anomaly detection", "Viral event alerts", "Auto cache invalidation", "DB alert creation"]}
            color="border-accent/20"
          />
          <AgentCard
            icon={<Brain className="h-6 w-6 text-info" />}
            name="Market Intelligence"
            schedule="Daily"
            desc="Uses Gemma 4 26B to generate natural language market briefings. Analyzes top gainers/decliners, sentiment shifts, volume trends, and active alerts to produce an executive summary."
            capabilities={["AI market analysis (Gemma 4 26B)", "Top movers identification", "Sentiment scoring", "Trend detection"]}
            color="border-info/20"
          />
          <AgentCard
            icon={<TrendingUp className="h-6 w-6 text-warning" />}
            name="Competitor Tracker"
            schedule="Every 6 hours"
            desc="Compares GameStop's predicted fair values against PriceCharting and SoldComps data. Identifies cards where GameStop is overpriced (markdown needed) or underpriced (arbitrage opportunity)."
            capabilities={["Cross-platform price gaps", "Overpriced detection", "Underpriced opportunities", "Grade-specific matching"]}
            color="border-warning/20"
          />
          <AgentCard
            icon={<Shield className="h-6 w-6 text-buy" />}
            name="Pricing Recommendations"
            schedule="Daily"
            desc="Generates BUY/SELL/REPRICE recommendations using NRV-based thresholds. Queues for human approval — no automated execution on high-value decisions. Recommendations expire after 48 hours."
            capabilities={["NRV-based buy/sell signals", "Human approval workflow", "Auto-expiry (48h)", "Margin calculation"]}
            color="border-buy/20"
          />
        </div>
      </section>

      {/* ─── Tech Stack ─── */}
      <section>
        <SectionHeader icon={<Cpu className="h-6 w-6" />} title="Technology Stack" />
        <p className="text-sm text-text-secondary mt-2 max-w-3xl">
          100% Cloudflare — zero servers, globally distributed, ~$300/month all-in.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TechCard icon={<Globe />} name="Workers" desc="Hono API framework with 20+ endpoints, edge-deployed across 300+ cities" badge="Compute" />
          <TechCard icon={<Database />} name="D1 (SQLite)" desc="10 tables, 641 cards, sub-millisecond queries with automatic replication" badge="Database" />
          <TechCard icon={<Brain />} name="Workers AI" desc="Gemma 4 26B for NER, sentiment classification, and market analysis" badge="AI/ML" />
          <TechCard icon={<Bot />} name="Agents SDK" desc="4 Durable Objects with persistent state, scheduling, and WebSocket RPC" badge="Agents" />
          <TechCard icon={<Zap />} name="KV Cache" desc="5-minute TTL on hot price lookups, rate limiting at 120 req/min per key" badge="Cache" />
          <TechCard icon={<Database />} name="R2 Storage" desc="Model artifacts, batch predictions, and cold data archive (S3-compatible)" badge="Storage" />
          <TechCard icon={<Activity />} name="Queues" desc="Async price observation ingestion and sentiment analysis processing" badge="Messaging" />
          <TechCard icon={<Globe />} name="Browser Rendering" desc="Headless Chrome for scraping Reddit and GemRate population data" badge="Scraping" />
        </div>

        {/* Bottom stats */}
        <div className="mt-6 rounded-xl border border-border bg-bg-card p-5 shadow-sm">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            <div>
              <p className="text-2xl font-extrabold text-accent">~$300</p>
              <p className="text-xs text-text-muted mt-0.5">Monthly cost (all-in)</p>
            </div>
            <div>
              <p className="text-2xl font-extrabold text-text-primary">&lt;5ms</p>
              <p className="text-xs text-text-muted mt-0.5">Price lookup latency</p>
            </div>
            <div>
              <p className="text-2xl font-extrabold text-text-primary">300+</p>
              <p className="text-xs text-text-muted mt-0.5">Edge cities worldwide</p>
            </div>
            <div>
              <p className="text-2xl font-extrabold text-text-primary">0</p>
              <p className="text-xs text-text-muted mt-0.5">Servers to manage</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── Sub-components ───

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent">{icon}</div>
      <h2 className="text-2xl font-extrabold text-text-primary">{title}</h2>
    </div>
  );
}

function SourceCard({ icon, name, detail, color }: { icon: React.ReactNode; name: string; detail: string; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-card p-5 shadow-sm text-center">
      <div className={`flex justify-center mb-2 ${color}`}>{icon}</div>
      <p className="text-sm font-bold text-text-primary">{name}</p>
      <p className="text-xs text-text-muted mt-1">{detail}</p>
    </div>
  );
}

function PipelineBlock({ number, title, icon, color, items }: { number: string; title: string; icon: React.ReactNode; color: string; items: string[] }) {
  return (
    <div className={`rounded-xl border p-5 ${color}`}>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <div>
          <span className="text-xs font-medium opacity-60">Step {number}</span>
          <p className="text-sm font-bold">{title}</p>
        </div>
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0 opacity-60" />
            <span className="text-text-secondary">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatBlock({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-card p-4 text-center shadow-sm">
      <p className="text-2xl font-extrabold text-accent">{value}</p>
      <p className="text-xs text-text-muted mt-1">{label}</p>
    </div>
  );
}

function NrvStep({ number, label, value, desc, color }: { number: string; label: string; value: string; desc: string; color: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent">{number}</span>
      <div>
        <div className="flex items-baseline gap-2">
          <span className={`text-base font-bold ${color}`}>{label}</span>
          <span className="text-lg font-extrabold text-text-primary">{value}</span>
        </div>
        <p className="text-xs text-text-muted">{desc}</p>
      </div>
    </div>
  );
}

function FeatureBar({ label, pct, color, example }: { label: string; pct: number; color: string; example: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold text-text-primary">{label}</span>
        <span className="text-sm font-bold text-text-primary">{pct}%</span>
      </div>
      <div className="h-3 rounded-full bg-bg-secondary overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-text-muted mt-1">{example}</p>
    </div>
  );
}

function AgentCard({ icon, name, schedule, desc, capabilities, color }: { icon: React.ReactNode; name: string; schedule: string; desc: string; capabilities: string[]; color: string }) {
  return (
    <div className={`rounded-xl border ${color} bg-bg-card p-6 shadow-sm`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {icon}
          <span className="text-base font-bold text-text-primary">{name}</span>
        </div>
        <span className="rounded-md bg-bg-secondary px-2.5 py-1 text-xs font-medium text-text-muted">{schedule}</span>
      </div>
      <p className="text-sm text-text-secondary leading-relaxed mb-4">{desc}</p>
      <div className="flex flex-wrap gap-2">
        {capabilities.map((cap, i) => (
          <span key={i} className="rounded-md bg-bg-secondary px-2.5 py-1 text-[11px] font-medium text-text-secondary">{cap}</span>
        ))}
      </div>
    </div>
  );
}

function TechCard({ icon, name, desc, badge }: { icon: React.ReactNode; name: string; desc: string; badge: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg-secondary text-text-muted">{icon}</div>
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-text-primary">{name}</p>
            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold text-accent uppercase">{badge}</span>
          </div>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed">{desc}</p>
        </div>
      </div>
    </div>
  );
}

function AdjustmentRow({ label, impact, color }: { label: string; impact: string; color: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-bg-secondary px-3 py-2">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className={`text-sm font-bold ${color}`}>{impact}</span>
    </div>
  );
}
