import { useState } from "react";
import { Zap, Radio, RotateCcw, ShieldBan } from "lucide-react";
import { useSettings } from "./use-settings";
import { SettingsGroup, SettingRow, SettingsSkeleton } from "./SettingsCard";
import { SettingsPageLayout } from "./SettingsPageLayout";

const GROUPS = [
  { title: "Автоназначение", icon: <Zap className="w-4 h-4" />, keys: ["auto_dispatch_enabled", "driver_search_radius_km", "offer_timeout_seconds", "max_offers_per_round"] },
  { title: "Очередь", icon: <Radio className="w-4 h-4" />, keys: ["queue_enabled", "queue_priority_mode"] },
  { title: "Повторы", icon: <RotateCcw className="w-4 h-4" />, keys: ["retry_on_reject", "max_retry_count"] },
  { title: "Баны", icon: <ShieldBan className="w-4 h-4" />, keys: ["max_consecutive_ignores", "ban_duration_minutes"] },
];

export default function DispatchSettings() {
  const { settings, loading, editValues, setEditValues, saving, savedKeys, hasChanges, saveAll } = useSettings("dispatch");
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const ok = await saveAll();
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  };

  const onChange = (key: string, val: string) => setEditValues(v => ({ ...v, [key]: val }));
  const settingMap = new Map(settings.map(s => [s.key, s]));

  return (
    <SettingsPageLayout
      title="Диспетчеризация"
      subtitle="Автоназначение, очередь, баны"
      icon={<Zap className="w-5 h-5" />}
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
