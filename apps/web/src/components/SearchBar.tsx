import { useState, useEffect } from "react";
import { Search, Loader2 } from "lucide-react";
import { api, type Card } from "../lib/api";
import { useDebounce } from "../lib/hooks";

interface SearchBarProps {
  onSelect: (card: Card) => void;
  category?: string;
}

export function SearchBar({ onSelect, category }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.searchCards(debouncedQuery, category || undefined)
      .then((data) => {
        if (!cancelled) {
          setResults(data.cards);
          setOpen(data.cards.length > 0);
        }
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [debouncedQuery, category]);

  return (
    <div className="relative w-full lg:max-w-md" role="combobox" aria-expanded={open} aria-haspopup="listbox">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Search cards by name, set, or player..."
          aria-label="Search cards"
          className="w-full rounded-md border-0 bg-bg-card py-2 pl-9 pr-10 text-sm text-text-primary shadow-sm placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-accent"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-text-muted" />}
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-bg-card shadow-lg" role="listbox">
          {results.map((card) => (
            <button
              key={card.id}
              role="option"
              onClick={() => {
                onSelect(card);
                setOpen(false);
                setQuery(card.name);
              }}
              className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-0 hover:bg-bg-hover"
            >
              {card.image_url ? (
                <img src={card.image_url} alt="" className="h-10 w-8 rounded object-cover" />
              ) : (
                <div className="flex h-10 w-8 items-center justify-center rounded bg-bg-secondary text-xs text-text-muted">?</div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">{card.name}</p>
                <p className="text-xs text-text-muted">{card.set_name} ({card.set_year})</p>
              </div>
              <span className="shrink-0 rounded bg-bg-secondary px-2 py-0.5 text-xs font-medium text-text-secondary">
                {card.category.replace(/_/g, " ")}
              </span>
            </button>
          ))}
        </div>
      )}

      {open && results.length === 0 && !loading && debouncedQuery.length >= 2 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-bg-card p-4 text-center text-sm text-text-muted shadow-lg">
          No cards found for "{debouncedQuery}"
        </div>
      )}
    </div>
  );
}
