import {
  Database,
  Bot,
  TrendingUp,
  Shield,
  Activity,
  Zap,
  Globe,
  Cpu,
  ArrowRight,
  Layers,
  Brain,
} from "lucide-react";

export function Architecture() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">System Architecture</h1>
        <p className="mt-1 text-sm text-text-secondary">
          How GMEstart prices 500+ collectible cards in real time using ML, autonomous agents, and edge computing.
        </p>
      </div>

      {/* ─── Data Flow ─── */}
      <section>
        <SectionHeader icon={<Layers className="h-5 w-5" />} title="Data Pipeline" subtitle="From market data to actionable pricing" />
        <div className="mt-4 grid gap-3 lg:grid-cols-5">
          <PipelineStep
            step={1}
            title="Ingest"
            description="SoldComps pulls real eBay sold prices every 15 min. PriceCharting imports daily reference prices. GemRate scraped for PSA population data."
            color="text-info"
            items={["1,000+ eBay sales/run", "Daily price snapshots", "Population reports"]}
          />
          <PipelineArrow />
          <PipelineStep
            step={2}
            title="Clean & Detect"
            description="Anomaly detection flags shill bids, lot sales, and statistical outliers before they corrupt downstream models."
            color="text-warning"
            items={["IQR outlier detection", "Seller concentration", "Best Offer discount (0.80x)"]}
          />
          <PipelineArrow />
          <PipelineStep
            step={3}
            title="Predict"
            description="Features computed across 22 dimensions. Quantile regression produces fair value with confidence intervals."
            color="text-buy"
            items={["589 features daily", "NRV-based buy thresholds", "Conformal calibration"]}
          />
        </div>
      </section>

      {/* ─── ML Model ─── */}
      <section>
        <SectionHeader icon={<Brain className="h-5 w-5" />} title="ML Pricing Model" subtitle="LightGBM quantile regression with retail economics" />
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-bg-card p-5 shadow-sm">
            <h4 className="text-sm font-bold text-text-primary mb-3">How Pricing Works</h4>
            <div className="space-y-3 text-xs text-text-secondary">
              <ModelStep number="1" title="Fair Value (p50)" desc="Median predicted sale price from quantile regression across 7 quantiles (p10–p90)." />
              <ModelStep number="2" title="Net Realizable Value" desc="Fair value minus 13% marketplace fees, $5 shipping, 3% returns = what GameStop actually nets." />
              <ModelStep number="3" title="Max Buy Price" desc="NRV × 0.80 = maximum price to achieve 20% margin. Below this → STRONG_BUY." />
              <ModelStep number="4" title="Confidence Band" desc="Width of p10–p90 interval relative to fair value. High volume + low volatility = HIGH confidence." />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-bg-card p-5 shadow-sm">
            <h4 className="text-sm font-bold text-text-primary mb-3">Feature Groups (22 dimensions)</h4>
            <div className="space-y-2">
              <FeatureBar label="Grade + Population" pct={28} color="bg-accent" desc="PSA/BGS/CGC grade, pop at grade, pop ratio" />
              <FeatureBar label="Price History" pct={20} color="bg-info" desc="7d/30d/90d averages, momentum, volatility" />
              <FeatureBar label="Demand Signals" pct={18} color="bg-buy" desc="Sales velocity, sell-through trend" />
              <FeatureBar label="Population Supply" pct={12} color="bg-warning" desc="Pop growth rate, pop-1 rarity" />
              <FeatureBar label="Social Sentiment" pct={8} color="bg-accent" desc="Reddit mention volume and trend" />
              <FeatureBar label="Seasonality" pct={5} color="bg-hold" desc="Holiday, tax refund, sport season" />
              <FeatureBar label="GameStop Internal" pct={9} color="bg-sell" desc="Trade-in volume, inventory, foot traffic" />
            </div>
          </div>
        </div>
      </section>

      {/* ─── Agents ─── */}
      <section>
        <SectionHeader icon={<Bot className="h-5 w-5" />} title="Autonomous Agents" subtitle="4 Durable Objects running 24/7 on Cloudflare's edge" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <AgentCard
            icon={<Activity className="h-5 w-5 text-accent" />}
            name="Price Monitor"
            schedule="Every 15 min"
            desc="Detects price spikes (>30% from 30d average) and viral social events (>3x normal mention volume). Triggers immediate cache invalidation for affected cards."
            capabilities={["Real-time anomaly detection", "Viral event detection", "Automatic cache bust"]}
          />
          <AgentCard
            icon={<Brain className="h-5 w-5 text-info" />}
            name="Market Intelligence"
            schedule="Daily 7 AM"
            desc="Generates natural language market briefings using Gemma 4 26B. Identifies top movers, sentiment shifts, and emerging trends across all card categories."
            capabilities={["AI-powered market analysis", "Top gainers/decliners", "Sentiment scoring"]}
          />
          <AgentCard
            icon={<TrendingUp className="h-5 w-5 text-warning" />}
            name="Competitor Tracker"
            schedule="Every 6 hours"
            desc="Compares GameStop's fair values against PriceCharting and SoldComps data. Identifies overpriced cards (markdown needed) and underpriced opportunities."
            capabilities={["Cross-platform price gaps", "Overpriced detection", "Arbitrage opportunities"]}
          />
          <AgentCard
            icon={<Shield className="h-5 w-5 text-buy" />}
            name="Pricing Recommendations"
            schedule="Daily 8 AM"
            desc="Generates BUY/SELL/REPRICE recommendations using NRV-based thresholds. Queues for human approval — no auto-execution on high-value decisions."
            capabilities={["NRV-based buy/sell signals", "Human approval workflow", "48h auto-expiry"]}
          />
        </div>
      </section>

      {/* ─── Tech Stack ─── */}
      <section>
        <SectionHeader icon={<Cpu className="h-5 w-5" />} title="Technology Stack" subtitle="100% Cloudflare — zero servers, global edge deployment" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TechCard icon={<Globe />} name="Workers" desc="Hono API framework, edge-deployed globally" />
          <TechCard icon={<Database />} name="D1 (SQLite)" desc="10 tables, 641 cards, sub-ms queries" />
          <TechCard icon={<Zap />} name="Workers AI" desc="Gemma 4 26B for NER + market analysis" />
          <TechCard icon={<Bot />} name="Agents SDK" desc="4 Durable Objects with persistent state" />
          <TechCard icon={<Database />} name="KV Cache" desc="5-min TTL on hot price lookups" />
          <TechCard icon={<Database />} name="R2 Storage" desc="Model artifacts + data archive" />
          <TechCard icon={<Activity />} name="Queues" desc="Async ingestion + sentiment processing" />
          <TechCard icon={<Globe />} name="Browser Rendering" desc="Headless Chrome for Reddit + GemRate scraping" />
        </div>
        <div className="mt-4 rounded-lg border border-border bg-bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
            <span><strong className="text-text-primary">Cost:</strong> ~$280-360/month (all-in)</span>
            <span><strong className="text-text-primary">Latency:</strong> &lt;5ms price lookups</span>
            <span><strong className="text-text-primary">Uptime:</strong> Cloudflare global edge (300+ cities)</span>
            <span><strong className="text-text-primary">ML Training:</strong> LightGBM offline → ONNX → R2 → edge serving</span>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── Sub-components ───

function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">{icon}</div>
      <div>
        <h2 className="text-lg font-bold text-text-primary">{title}</h2>
        <p className="text-xs text-text-muted">{subtitle}</p>
      </div>
    </div>
  );
}

function PipelineStep({ step, title, description, color, items }: { step: number; title: string; description: string; color: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full bg-bg-secondary text-xs font-bold ${color}`}>{step}</span>
        <span className="text-sm font-bold text-text-primary">{title}</span>
      </div>
      <p className="text-xs text-text-secondary mb-2">{description}</p>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <div className={`h-1 w-1 rounded-full ${color.replace("text-", "bg-")}`} />
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelineArrow() {
  return (
    <div className="hidden lg:flex items-center justify-center">
      <ArrowRight className="h-5 w-5 text-text-muted" />
    </div>
  );
}

function ModelStep({ number, title, desc }: { number: string; title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[10px] font-bold text-accent">{number}</span>
      <div>
        <span className="font-semibold text-text-primary">{title}</span>
        <span className="text-text-muted"> — {desc}</span>
      </div>
    </div>
  );
}

function FeatureBar({ label, pct, color, desc }: { label: string; pct: number; color: string; desc: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="font-medium text-text-primary">{label}</span>
        <span className="text-text-muted">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-bg-secondary overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-text-muted mt-0.5">{desc}</p>
    </div>
  );
}

function AgentCard({ icon, name, schedule, desc, capabilities }: { icon: React.ReactNode; name: string; schedule: string; desc: string; capabilities: string[] }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-bold text-text-primary">{name}</span>
        </div>
        <span className="rounded bg-bg-secondary px-2 py-0.5 text-[10px] font-medium text-text-muted">{schedule}</span>
      </div>
      <p className="text-xs text-text-secondary mb-3">{desc}</p>
      <div className="flex flex-wrap gap-1.5">
        {capabilities.map((cap, i) => (
          <span key={i} className="rounded-md bg-bg-secondary px-2 py-0.5 text-[10px] font-medium text-text-secondary">{cap}</span>
        ))}
      </div>
    </div>
  );
}

function TechCard({ icon, name, desc }: { icon: React.ReactNode; name: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-bg-card p-3 shadow-sm">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-secondary text-text-muted">{icon}</div>
      <div>
        <p className="text-xs font-bold text-text-primary">{name}</p>
        <p className="text-[11px] text-text-muted">{desc}</p>
      </div>
    </div>
  );
}
