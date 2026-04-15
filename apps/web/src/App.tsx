import { useState } from "react";
import { BrowserRouter, Routes, Route, useNavigate, useParams, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { api, ApiError, type Card } from "./lib/api";
import { SearchBar } from "./components/SearchBar";
import { MarketOverview } from "./components/MarketOverview";
import { CardDetail } from "./components/CardDetail";
import { EvaluateCard } from "./components/EvaluateCard";
import { AlertsList } from "./components/AlertsList";
import { AgentDashboard, AgentSummary } from "./components/AgentDashboard";
import { SignIn } from "./components/SignIn";
import { CategoryBrowse } from "./components/CategoryBrowse";
import { Architecture } from "./components/Architecture";
import {
  LayoutDashboard,
  Search,
  Bell,
  Calculator,
  Bot,
  Cpu,
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
  { path: "/", label: "Action Queue", icon: LayoutDashboard },
  { path: "/search", label: "Card Search", icon: Search },
  { path: "/evaluate", label: "Evaluate", icon: Calculator },
  { path: "/alerts", label: "Alerts", icon: Bell },
  { path: "/agents", label: "Agents", icon: Bot },
  { path: "/architecture", label: "How It Works", icon: Cpu },
];

// ─── Card Detail Page (route-aware) ───
function CardPage() {
  const { cardId } = useParams<{ cardId: string }>();
  const navigate = useNavigate();

  const { data: card, isLoading, error, isError } = useQuery({
    queryKey: ["card", cardId],
    queryFn: () => api.getCard(cardId!),
    enabled: !!cardId,
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (isError || !card) {
    const status = error instanceof ApiError ? error.status : 0;
    const message = error instanceof Error ? error.message : "Unknown error";

    let title: string;
    let detail: string;
    if (status === 401 || status === 403) {
      title = "Authentication required";
      detail = "Check your API key in settings";
    } else if (status === 404 || (!error && !card)) {
      title = "Card not found";
      detail = `The card "${cardId}" doesn\u2019t exist or has been removed`;
    } else {
      title = "Failed to load card";
      detail = message;
    }

    return (
      <div className="py-12 text-center">
        <p className="text-lg font-semibold text-text-primary">{title}</p>
        <p className="mt-1 text-sm text-text-muted">{detail}</p>
        <button onClick={() => navigate(-1)} className="mt-4 rounded-md bg-bg-secondary px-4 py-2 text-sm font-medium text-text-primary hover:bg-bg-hover min-h-[44px]">
          Go back
        </button>
      </div>
    );
  }

  return <CardDetail card={card as Card} onBack={() => navigate(-1)} />;
}

// ─── App Shell ───
function AppShell() {
  const navigate = useNavigate();
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
    navigate(`/card/${card.id}`);
  };

  // Determine active path for nav highlighting
  const currentPath = window.location.pathname;
  const activeTab = navTabs.find((t) => t.path === currentPath)?.path || "/";

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* ─── Top Nav ─── */}
      <header className="sticky top-0 z-30 bg-bg-nav">
        <div className="flex h-14 items-center gap-4 px-6 lg:px-10">
          <button onClick={() => navigate("/")} className="flex items-center gap-2">
            <span className="text-xl font-extrabold tracking-tight text-text-inverse">
              GME<span className="text-accent">start</span>
            </span>
            <span className="hidden rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-text-inverse sm:block">
              Pricing Engine
            </span>
          </button>

          <nav className="ml-8 hidden items-center gap-1 md:flex">
            {navTabs.map((tab) => (
              <button
                key={tab.path}
                onClick={() => navigate(tab.path)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === tab.path
                    ? "bg-bg-nav-hover text-text-inverse"
                    : "text-text-inverse/70 hover:bg-bg-nav-hover hover:text-text-inverse"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
                {tab.path === "/alerts" && alerts.length > 0 && (
                  <span className="ml-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-text-inverse">
                    {alerts.length}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="ml-auto hidden flex-1 justify-end lg:flex">
            <SearchBar onSelect={handleSelectCard} category={activeCategory} />
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
                key={tab.path}
                onClick={() => { navigate(tab.path); setMobileMenuOpen(false); }}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium min-h-[44px] ${
                  activeTab === tab.path ? "bg-bg-nav-hover text-text-inverse" : "text-text-inverse/70"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* ─── Category Tabs ─── */}
      <div className="border-b border-border bg-bg-card">
        <div className="flex items-center gap-1 overflow-x-auto px-6 py-1 lg:px-10">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => {
                setActiveCategory(cat.value);
                if (cat.value) {
                  navigate("/search");
                }
              }}
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

      {/* ─── Main Content (routed) ─── */}
      <main className="px-6 py-6 lg:px-10">
        <div className="mb-4 lg:hidden">
          <SearchBar onSelect={handleSelectCard} category={activeCategory} />
        </div>

        <Routes>
          <Route
            path="/"
            element={
              <div className="space-y-6">
                <MarketOverview alerts={alerts} onNavigate={navigate} />
                <AgentSummary />
              </div>
            }
          />
          <Route
            path="/search"
            element={
              <div className="space-y-6">
                <h1 className="text-2xl font-bold text-text-primary">
                  {activeCategory
                    ? CATEGORIES.find((c) => c.value === activeCategory)?.label || "Cards"
                    : "Card Search"}
                </h1>
                <p className="text-sm text-text-secondary">
                  {activeCategory
                    ? `Browse ${CATEGORIES.find((c) => c.value === activeCategory)?.label} cards with live pricing`
                    : "Find any graded card and view real-time pricing data"}
                </p>
                <div className="lg:hidden">
                  <SearchBar onSelect={handleSelectCard} category={activeCategory} />
                </div>
                <CategoryBrowse category={activeCategory} onCardSelect={handleSelectCard} />
              </div>
            }
          />
          <Route path="/card/:cardId" element={<CardPage />} />
          <Route
            path="/evaluate"
            element={
              <div className="space-y-6">
                <h1 className="text-2xl font-bold text-text-primary">Price Evaluator</h1>
                <p className="mb-2 text-sm text-text-secondary">
                  Get a buy/sell/hold recommendation at a given price
                </p>
                <EvaluateCard />
              </div>
            }
          />
          <Route
            path="/alerts"
            element={
              <div className="space-y-6">
                <div>
                  <h1 className="text-2xl font-bold text-text-primary">Alert Triage</h1>
                  <p className="text-sm text-text-secondary">
                    {alerts.length} active alert{alerts.length !== 1 ? "s" : ""} — resolve, snooze, or investigate
                  </p>
                </div>
                <AlertsList alerts={alerts} onResolve={handleResolveAlert} onRefresh={refetchAlerts} onCardClick={(cardId) => navigate(`/card/${cardId}`)} showControls />
              </div>
            }
          />
          <Route path="/agents" element={<AgentDashboard />} />
          <Route path="/architecture" element={<Architecture />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(
    () => localStorage.getItem("gmestart_authenticated") === "true"
  );

  if (!authenticated) {
    return <SignIn onAuthenticated={() => setAuthenticated(true)} />;
  }

  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>
    </BrowserRouter>
  );
}
