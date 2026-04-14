import { useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { api, type Card } from "./lib/api";
import { SearchBar } from "./components/SearchBar";
import { MarketOverview } from "./components/MarketOverview";
import { CardDetail } from "./components/CardDetail";
import { EvaluateCard } from "./components/EvaluateCard";
import { AlertsList } from "./components/AlertsList";
import {
  LayoutDashboard,
  Search,
  Bell,
  Calculator,
  Menu,
  X,
} from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

type View = "dashboard" | "search" | "alerts" | "evaluate";

const CATEGORIES = [
  { label: "All Cards", value: "" },
  { label: "Pokemon", value: "pokemon" },
  { label: "Baseball", value: "sports_baseball" },
  { label: "Basketball", value: "sports_basketball" },
  { label: "Football", value: "sports_football" },
  { label: "MTG", value: "tcg_mtg" },
  { label: "Yu-Gi-Oh", value: "tcg_yugioh" },
] as const;

const navTabs = [
  { id: "dashboard" as const, label: "Dashboard", icon: LayoutDashboard },
  { id: "search" as const, label: "Card Search", icon: Search },
  { id: "evaluate" as const, label: "Evaluate", icon: Calculator },
  { id: "alerts" as const, label: "Alerts", icon: Bell },
];

function AppContent() {
  const [view, setView] = useState<View>("dashboard");
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [activeCategory, setActiveCategory] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: alertsData, refetch: refetchAlerts } = useQuery({
    queryKey: ["alerts"],
    queryFn: api.getAlerts,
    refetchInterval: 30_000,
  });

  const alerts = alertsData?.alerts || [];

  const handleResolveAlert = async (id: number) => {
    await api.resolveAlert(id);
    refetchAlerts();
  };

  const handleSelectCard = (card: Card) => {
    setSelectedCard(card);
    setView("search");
  };

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* ─── Top Nav ─── */}
      <header className="sticky top-0 z-30 bg-bg-nav">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <div className="flex items-center gap-2">
            <span className="text-xl font-extrabold tracking-tight text-text-inverse">
              Game<span className="text-accent">Cards</span>
            </span>
            <span className="hidden rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-text-inverse sm:block">
              Pricing Engine
            </span>
          </div>

          <nav className="ml-8 hidden items-center gap-1 md:flex">
            {navTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setView(tab.id); setSelectedCard(null); }}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === tab.id
                    ? "bg-bg-nav-hover text-text-inverse"
                    : "text-text-inverse/70 hover:bg-bg-nav-hover hover:text-text-inverse"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
                {tab.id === "alerts" && alerts.length > 0 && (
                  <span className="ml-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-text-inverse">
                    {alerts.length}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="ml-auto hidden flex-1 justify-end lg:flex">
            <SearchBar onSelect={handleSelectCard} />
          </div>

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="ml-auto rounded-md p-2 text-text-inverse md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-bg-nav-hover px-4 pb-3 md:hidden">
            {navTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setView(tab.id); setSelectedCard(null); setMobileMenuOpen(false); }}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium min-h-[44px] ${
                  view === tab.id ? "bg-bg-nav-hover text-text-inverse" : "text-text-inverse/70"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* ─── Category Tabs (functional) ─── */}
      <div className="border-b border-border bg-bg-card">
        <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4 py-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setActiveCategory(cat.value)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeCategory === cat.value
                  ? "bg-accent/10 text-accent"
                  : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Main Content ─── */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-4 lg:hidden">
          <SearchBar onSelect={handleSelectCard} />
        </div>

        {selectedCard ? (
          <CardDetail card={selectedCard} onBack={() => setSelectedCard(null)} />
        ) : view === "dashboard" ? (
          <div className="space-y-6">
            <MarketOverview onCardSelect={handleSelectCard} />
            {alerts.length > 0 && (
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-bold text-text-primary">Active Alerts</h2>
                  <button onClick={() => setView("alerts")} className="text-sm font-medium text-accent hover:text-accent-hover">
                    View all
                  </button>
                </div>
                <AlertsList alerts={alerts.slice(0, 5)} onResolve={handleResolveAlert} />
              </div>
            )}
          </div>
        ) : view === "search" ? (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold text-text-primary">Card Search</h1>
            <p className="text-sm text-text-secondary">
              Find any graded card and view real-time pricing data
              {activeCategory && ` — filtered to ${CATEGORIES.find((c) => c.value === activeCategory)?.label}`}
            </p>
          </div>
        ) : view === "evaluate" ? (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold text-text-primary">Price Evaluator</h1>
            <p className="mb-2 text-sm text-text-secondary">
              Get a buy/sell/hold recommendation at a given price
            </p>
            <EvaluateCard onCardSelect={handleSelectCard} />
          </div>
        ) : view === "alerts" ? (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-text-primary">Alerts</h1>
              <p className="text-sm text-text-secondary">
                {alerts.length} active alert{alerts.length !== 1 ? "s" : ""}
              </p>
            </div>
            <AlertsList alerts={alerts} onResolve={handleResolveAlert} />
          </div>
        ) : null}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
