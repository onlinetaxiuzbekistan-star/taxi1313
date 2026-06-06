import { useState } from "react";
import { TrendingUp, Sun, Sunset, Moon, Zap, BarChart3 } from "lucide-react";
import { useSettings } from "./use-settings";
import { SettingsGroup, SettingRow, SettingsSkeleton } from "./SettingsCard";
import { SettingsPageLayout } from "./SettingsPageLayout";

const GROUPS = [
  { title: "Множители", icon: <TrendingUp className="w-4 h-4" />, keys: ["surge_min", "surge_max", "demand_supply_multiplier"] },
  { title: "Динамический спрос", icon: <BarChart3 className="w-4 h-4" />, keys: ["demand_threshold", "demand_surge_bonus"] },
  { title: "Утренний пик", icon: <Sun className="w-4 h-4" />, keys: ["peak_morning_start", "peak_morning_end", "peak_morning_bonus"] },
  { title: "Вечерний пик", icon: <Sunset className="w-4 h-4" />, keys: ["peak_evening_start", "peak_evening_end", "peak_evening_bonus"] },
  { title: "Ночное время", icon: <Moon className="w-4 h-4" />, keys: ["night_start", "night_end", "night_bonus"] },
  { title: "Срочные заказы", icon: <Zap className="w-4 h-4" />, keys: ["urgent_multiplier"] },
];

export default function PricingSettings() {
  const { settings, loading, editValues, setEditValues, saving, savedKeys, hasChanges, saveAll } = useSettings("pricing");
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const ok = await saveAll();
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  };

  const onChange = (key: string, val: string) => setEditValues(v => ({ ...v, [key]: val }));
  const settingMap = new Map(settings.map(s => [s.key, s]));

  return (
    <SettingsPageLayout
      title="Цены"
      subtitle="Динамическое ценообразование, спрос, пиковые часы"
      icon={<TrendingUp className="w-5 h-5" />}
      hasChanges={hasChanges}
      saving={saving}
      onSave={handleSave}
      saved={saved}
    >
      {loading ? <SettingsSkeleton /> : (
        <div className="space-y-5">
          {GROUPS.map(group => {
            const items = group.keys.map(k => settingMap.get(k)).filter(Boolean);
            if (items.length === 0) return null;
            return (
              <SettingsGroup key={group.title} title={group.title} icon={group.icon}>
                {items.map(s => (
                  <SettingRow
                    key={s!.key}
                    setting={s!}
                    value={editValues[s!.key] || ""}
                    originalValue={s!.value}
                    onChange={onChange}
                    isSaved={savedKeys.has(s!.key)}
                  />
                ))}
              </SettingsGroup>
            );
          })}
        </div>
      )}
    </SettingsPageLayout>
  );
}
