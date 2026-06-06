import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { User, LogOut, Menu, X, Car } from "lucide-react";
import { useState } from "react";

export default function Header() {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isHome = location === "/";

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isHome ? "bg-transparent" : "bg-white/95 backdrop-blur-sm shadow-sm border-b border-border"
      }`}
    >
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <img src="/logo-1313.png" alt="Такси 1313" className="w-9 h-9 rounded-xl object-cover" />
          <span className={`text-xl font-bold ${isHome ? "text-white" : "text-foreground"}`}>
            Такси 1313
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-6">
          <Link
            href="/"
            className={`text-sm font-medium transition-colors ${
              isHome ? "text-white/90 hover:text-white" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Поиск
          </Link>
          {user && (
            <Link
              href="/my-trips"
              className={`text-sm font-medium transition-colors ${
                isHome ? "text-white/90 hover:text-white" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Мои поездки
            </Link>
          )}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-3">
              <Link
                href="/profile"
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isHome
                    ? "text-white/90 hover:bg-white/10"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                <User className="w-4 h-4" />
                {user.name}
              </Link>
              <button
                onClick={logout}
                className={`p-2 rounded-lg transition-colors ${
                  isHome ? "text-white/70 hover:text-white hover:bg-white/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isHome
                  ? "bg-white text-primary hover:bg-white/90"
                  : "bg-primary text-white hover:bg-primary/90"
              }`}
            >
              Войти
            </Link>
          )}
        </div>

        <button
          className={`md:hidden p-2 rounded-lg ${isHome ? "text-white" : "text-foreground"}`}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {menuOpen && (
        <div className="md:hidden bg-white border-b border-border shadow-lg">
          <div className="px-4 py-3 space-y-1">
            <Link
              href="/"
              className="block px-3 py-2 rounded-lg text-sm font-medium text-foreground hover:bg-muted"
              onClick={() => setMenuOpen(false)}
            >
              Поиск
            </Link>
            {user && (
              <>
                <Link
                  href="/my-trips"
                  className="block px-3 py-2 rounded-lg text-sm font-medium text-foreground hover:bg-muted"
                  onClick={() => setMenuOpen(false)}
                >
                  Мои поездки
                </Link>
                <Link
                  href="/profile"
                  className="block px-3 py-2 rounded-lg text-sm font-medium text-foreground hover:bg-muted"
                  onClick={() => setMenuOpen(false)}
                >
                  Профиль
                </Link>
                <button
                  onClick={() => {
                    logout();
                    setMenuOpen(false);
                  }}
                  className="block w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-destructive hover:bg-muted"
                >
                  Выйти
                </button>
              </>
            )}
            {!user && (
              <Link
                href="/login"
                className="block px-3 py-2 rounded-lg text-sm font-medium text-primary hover:bg-muted"
                onClick={() => setMenuOpen(false)}
              >
                Войти
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
