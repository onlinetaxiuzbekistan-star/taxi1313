import { useState, useRef, useEffect, useCallback } from "react";
import { MapPin, Loader2, X } from "lucide-react";

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

interface AddressSearchProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (result: { address: string; lat: number; lng: number }) => void;
  cityNameRu: string;
  placeholder?: string;
  className?: string;
}

const CITY_NAME_MAP: Record<string, string> = {
  "Бухара": "Bukhara",
  "Самарканд": "Samarkand",
  "Ташкент": "Tashkent",
  "Наманган": "Namangan",
  "Андижан": "Andijan",
  "Фергана": "Fergana",
  "Нукус": "Nukus",
  "Ургенч": "Urgench",
  "Карши": "Qarshi",
  "Термез": "Termez",
  "Джиззах": "Jizzakh",
  "Навои": "Navoiy",
};

export default function AddressSearch({
  value,
  onChange,
  onSelect,
  cityNameRu,
  placeholder = "Введите адрес...",
  className = "",
}: AddressSearchProps) {
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipNextSearch = useRef(false);

  const searchAddress = useCallback(async (query: string) => {
    if (!query.trim() || query.trim().length < 2) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    const cityEn = CITY_NAME_MAP[cityNameRu] || cityNameRu;
    const fullQuery = `${query}, ${cityEn}, Uzbekistan`;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: fullQuery,
        format: "json",
        limit: "5",
        countrycodes: "uz",
        addressdetails: "1",
      });

      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { "Accept-Language": "ru" },
      });

      if (!res.ok) throw new Error("Nominatim error");
      const data: NominatimResult[] = await res.json();

      const cityLower = cityNameRu.toLowerCase();
      const cityEnLower = cityEn.toLowerCase();
      const filtered = data.filter(r => {
        const dn = r.display_name.toLowerCase();
        return dn.includes(cityLower) || dn.includes(cityEnLower);
      });

      setSuggestions(filtered);
      setShowDropdown(filtered.length > 0);
      setSelectedIndex(-1);
    } catch {
      setSuggestions([]);
      setShowDropdown(false);
    } finally {
      setLoading(false);
    }
  }, [cityNameRu]);

  const handleInputChange = (newValue: string) => {
    onChange(newValue);

    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchAddress(newValue), 400);
  };

  const handleSelect = (result: NominatimResult) => {
    const parts = result.display_name.split(",");
    const shortAddress = parts.slice(0, 3).map(p => p.trim()).join(", ");

    skipNextSearch.current = true;
    onChange(shortAddress);
    setSuggestions([]);
    setShowDropdown(false);

    onSelect?.({
      address: shortAddress,
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" && selectedIndex >= 0) {
      e.preventDefault();
      handleSelect(suggestions[selectedIndex]);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const handleClear = () => {
    onChange("");
    setSuggestions([]);
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <MapPin className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => handleInputChange(e.target.value)}
          onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={`w-full text-sm border border-border rounded-lg pl-8 pr-8 py-2 outline-none focus:border-emerald-500 placeholder:text-muted-foreground ${className}`}
        />
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin" />
        ) : value ? (
          <button onClick={handleClear} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        ) : null}
      </div>

      {showDropdown && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {suggestions.map((s, i) => {
            const parts = s.display_name.split(",");
            const main = parts.slice(0, 2).map(p => p.trim()).join(", ");
            const secondary = parts.slice(2, 4).map(p => p.trim()).join(", ");

            return (
              <button
                key={s.place_id}
                onClick={() => handleSelect(s)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-muted active:bg-accent transition-colors flex items-start gap-2 border-b border-border last:border-b-0 ${
                  i === selectedIndex ? "bg-muted" : ""
                }`}
              >
                <MapPin className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-foreground truncate">{main}</p>
                  {secondary && <p className="text-[11px] text-muted-foreground truncate">{secondary}</p>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
