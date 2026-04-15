import { Clock, Shield, ShieldAlert, BarChart3, MessageCircle, AlertTriangle } from "lucide-react";

type BadgeVariant = "fresh" | "stale" | "high-confidence" | "medium-confidence" | "low-confidence" | "sparse-comps" | "rich-comps" | "sentiment-spike" | "manual-review";

interface TrustBadgeProps {
  variant: BadgeVariant;
  detail?: string;
}

const config: Record<BadgeVariant, { icon: React.ReactNode; label: string; className: string }> = {
  fresh: {
    icon: <Clock className="h-3 w-3" />,
    label: "Fresh",
    className: "bg-buy/10 text-buy border-buy/20",
  },
  stale: {
    icon: <Clock className="h-3 w-3" />,
    label: "Stale",
    className: "bg-warning/10 text-warning border-warning/20",
  },
  "high-confidence": {
    icon: <Shield className="h-3 w-3" />,
    label: "High confidence",
    className: "bg-buy/10 text-buy border-buy/20",
  },
  "medium-confidence": {
    icon: <Shield className="h-3 w-3" />,
    label: "Medium confidence",
    className: "bg-hold/10 text-hold border-hold/20",
  },
  "low-confidence": {
    icon: <ShieldAlert className="h-3 w-3" />,
    label: "Low confidence",
    className: "bg-sell/10 text-sell border-sell/20",
  },
  "sparse-comps": {
    icon: <BarChart3 className="h-3 w-3" />,
    label: "Sparse comps",
    className: "bg-warning/10 text-warning border-warning/20",
  },
  "rich-comps": {
    icon: <BarChart3 className="h-3 w-3" />,
    label: "",
    className: "bg-buy/10 text-buy border-buy/20",
  },
  "sentiment-spike": {
    icon: <MessageCircle className="h-3 w-3" />,
    label: "Sentiment spike",
    className: "bg-info/10 text-info border-info/20",
  },
  "manual-review": {
    icon: <AlertTriangle className="h-3 w-3" />,
    label: "Manual review recommended",
    className: "bg-sell/10 text-sell border-sell/20",
  },
};

export function TrustBadge({ variant, detail }: TrustBadgeProps) {
  const c = config[variant];
  const label = detail || c.label;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-tight ${c.className}`}>
      {c.icon}
      {label}
    </span>
  );
}

export function getConfidenceBadge(confidence: "HIGH" | "MEDIUM" | "LOW"): BadgeVariant {
  return confidence === "HIGH" ? "high-confidence" : confidence === "LOW" ? "low-confidence" : "medium-confidence";
}

export function getFreshnessBadge(updatedAt: string | null): BadgeVariant {
  if (!updatedAt) return "stale";
  const age = Date.now() - new Date(updatedAt).getTime();
  return age < 24 * 60 * 60 * 1000 ? "fresh" : "stale";
}

export function getCompsBadge(sales30d: number): { variant: BadgeVariant; detail: string } {
  if (sales30d >= 10) return { variant: "rich-comps", detail: `Based on ${sales30d} sales` };
  if (sales30d >= 3) return { variant: "rich-comps", detail: `${sales30d} recent comps` };
  return { variant: "sparse-comps", detail: sales30d === 0 ? "No recent comps" : `Only ${sales30d} comp${sales30d > 1 ? "s" : ""}` };
}
