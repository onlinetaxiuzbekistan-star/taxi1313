import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/core";
import { LogOut, User } from "lucide-react";

export function Navbar() {
  const { user, logout } = useAuth();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-amber-200 flex items-center justify-center shadow-lg shadow-primary/20 group-hover:shadow-primary/40 transition-all">
              <span className="text-primary-foreground font-display font-bold text-xl">B</span>
            </div>
            <span className="font-display font-bold text-2xl tracking-tight text-white">
              Bux<span className="text-primary">Taxi</span>
            </span>
          </Link>

          <div className="flex items-center gap-4">
            {!user ? (
              <>
                <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-white transition-colors">
                  Войти
                </Link>
                <Link href="/register">
                  <Button size="sm">Регистрация</Button>
                </Link>
              </>
            ) : (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 hidden sm:flex">
                  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                    <User className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium leading-none">{user.name}</span>
                    <span className="text-xs text-muted-foreground mt-1 capitalize">{user.role}</span>
                  </div>
                </div>
                {user.role === 'driver' && (
                  <Link href="/driver">
                    <Button variant="outline" size="sm">Панель водителя</Button>
                  </Link>
                )}
                {user.role === 'dispatcher' && (
                  <Link href="/management">
                    <Button variant="outline" size="sm">Диспетчер</Button>
                  </Link>
                )}
                <Button variant="ghost" size="icon" onClick={logout} title="Выйти">
                  <LogOut className="w-5 h-5 text-muted-foreground hover:text-destructive transition-colors" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
