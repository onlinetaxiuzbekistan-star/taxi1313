import { type ReactNode } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Save, Loader2, Check } from "lucide-react";
import DispatcherLayout from "../DispatcherLayout";

interface SettingsPageLayoutProps {
  title: string;
  subtitle: string;
  icon: ReactNode;
  children: ReactNode;
  hasChanges: boolean;
  saving: boolean;
  onSave: () => void;
  saved?: boolean;
  hideSaveButton?: boolean;
}

export function SettingsPageLayout({ title, subtitle, icon, children, hasChanges, saving, onSave, saved, hideSaveButton }: SettingsPageLayoutProps) {
  const [, navigate] = useLocation();

  return (
    <DispatcherLayout>
      <div className="p-6 space-y-6 max-w-4xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/management/settings")}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-muted-foreground" />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                {icon}
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground">{title}</h2>
                <p className="text-xs text-muted-foreground">{subtitle}</p>
              </div>
            </div>
          </div>
          {!hideSaveButton && (
            <button
              onClick={onSave}
              disabled={!hasChanges || saving}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                saved
                  ? "bg-emerald-500 text-white"
                  : hasChanges
                    ? "bg-primary text-primary-foreground hover:opacity-90 shadow-lg shadow-primary/25"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
              }`}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> :
               saved ? <Check className="w-4 h-4" /> :
               <Save className="w-4 h-4" />}
              {saved ? "Сохранено" : "Сохранить"}
            </button>
          )}
        </div>

        {children}
      </div>
    </DispatcherLayout>
  );
}
