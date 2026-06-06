import { useEffect } from "react";
import { useLocation } from "wouter";
import { User, Phone, LogOut, Car, ArrowRight, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function Profile() {
  const [, navigate] = useLocation();
  const { user, logout, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) navigate("/login");
  }, [isLoading, user]);

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-muted/30 pt-16 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 pt-16">
      <div className="bg-white border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-5">
          <h1 className="text-xl font-bold">Профиль</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="bg-white rounded-xl border border-border/50 p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 rounded-full hero-gradient flex items-center justify-center">
              <User className="w-8 h-8 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold">{user.name}</h2>
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Phone className="w-3.5 h-3.5" />
                {user.phone}
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={() => navigate("/my-trips")}
          className="w-full bg-white rounded-xl border border-border/50 p-4 flex items-center justify-between hover:shadow-sm transition-shadow"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Car className="w-5 h-5 text-primary" />
            </div>
            <div className="text-left">
              <div className="font-medium text-sm">Мои поездки</div>
              <div className="text-xs text-muted-foreground">
                История бронирований
              </div>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
        </button>

        <button
          onClick={() => {
            logout();
            navigate("/");
          }}
          className="w-full bg-white rounded-xl border border-border/50 p-4 flex items-center gap-3 hover:shadow-sm transition-shadow text-destructive"
        >
          <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center">
            <LogOut className="w-5 h-5" />
          </div>
          <span className="font-medium text-sm">Выйти из аккаунта</span>
        </button>
      </div>
    </div>
  );
}
