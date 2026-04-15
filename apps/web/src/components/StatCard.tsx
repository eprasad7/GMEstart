import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  trend?: "up" | "down" | "stable";
  trendValue?: string;
  variant?: "default" | "buy" | "sell" | "hold";
}

export function StatCard({ label, value, subtitle, trend, trendValue, variant = "default" }: StatCardProps) {
  const borderColor = {
    default: "border-border",
    buy: "border-buy/40",
    sell: "border-sell/40",
    hold: "border-hold/40",
  }[variant];

  const trendIcon = {
    up: <TrendingUp className="h-3.5 w-3.5 text-buy" />,
    down: <TrendingDown className="h-3.5 w-3.5 text-sell" />,
    stable: <Minus className="h-3.5 w-3.5 text-text-muted" />,
  };

  return (
    <div className={`rounded-lg border bg-bg-card p-3 shadow-sm sm:p-4 ${borderColor}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted sm:text-xs">{label}</p>
      <p className="mt-0.5 text-xl font-bold text-text-primary sm:mt-1 sm:text-2xl">{value}</p>
      <div className="mt-0.5 flex items-center gap-1.5 sm:mt-1">
        {trend && trendIcon[trend]}
        {trendValue && (
          <span className={`text-xs font-medium sm:text-sm ${trend === "up" ? "text-buy" : trend === "down" ? "text-sell" : "text-text-muted"}`}>
            {trendValue}
          </span>
        )}
        {subtitle && <span className="text-[11px] text-text-muted sm:text-xs">{subtitle}</span>}
      </div>
    </div>
  );
}
