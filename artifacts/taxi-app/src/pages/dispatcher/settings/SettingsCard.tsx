import { type ReactNode } from "react";
import { type Setting } from "./use-settings";

interface SettingRowProps {
  setting: Setting;
  value: string;
  originalValue: string;
  onChange: (key: string, val: string) => void;
  isSaved: boolean;
  inputType?: string;
}

export function SettingRow({ setting, value, originalValue, onChange, isSaved, inputType }: SettingRowProps) {
  const isTimeField = setting.key.endsWith("_start") || setting.key.endsWith("_end");
  const isBool = originalValue === "true" || originalValue === "false";
  const changed = value !== originalValue;

  return (
    <div className={`px-5 py-4 flex items-center gap-4 transition-colors ${isSaved ? "bg-emerald-500/5" : changed ? "bg-amber-500/5" : ""}`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{setting.label}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{setting.key}</p>
      </div>
      <div className="flex items-center gap-2">
        {isBool ? (
          <button
            onClick={() => onChange(setting.key, value === "true" ? "false" : "true")}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              value === "true" ? "bg-emerald-500" : "bg-muted"
            }`}
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
              value === "true" ? "left-[26px]" : "left-0.5"
            }`} />
          </button>
        ) : isTimeField ? (
          <input
            type="time"
            value={value || ""}
            onChange={e => onChange(setting.key, e.target.value)}
            className="w-36 border border-border rounded-lg px-3 py-2 text-sm bg-background outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
        ) : (
          <input
            type={inputType || "text"}
            value={value || ""}
            onChange={e => onChange(setting.key, e.target.value)}
            placeholder={inputType === "password" ? "Введите новое значение" : undefined}
            className="w-48 border border-border rounded-lg px-3 py-2 text-sm text-right bg-background outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
        )}
      </div>
    </div>
  );
}

interface SettingsGroupProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  badge?: string;
}

export function SettingsGroup({ title, icon, children, badge }: SettingsGroupProps) {
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border bg-muted/50 flex items-center gap-2.5">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {badge && (
          <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">{badge}</span>
        )}
      </div>
      <div className="divide-y divide-border">
        {children}
      </div>
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3.5 bg-muted/50 border-b border-border">
            <div className="h-4 w-32 bg-muted rounded animate-pulse" />
          </div>
          <div className="divide-y divide-border">
            {[...Array(3)].map((_, j) => (
              <div key={j} className="px-5 py-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="h-4 w-40 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-24 bg-muted rounded animate-pulse mt-1.5" />
                </div>
                <div className="h-9 w-32 bg-muted rounded-lg animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
