import { useState } from "react";
import { Car, ShieldCheck, MapPin, Clock, Wallet } from "lucide-react";
import { useSettings } from "./use-settings";
import { SettingsGroup, SettingRow, SettingsSkeleton } from "./SettingsCard";
import { SettingsPageLayout } from "./SettingsPageLayout";

const GROUPS = [
  { title: "Верификация", icon: <ShieldCheck className="w-4 h-4" />, keys: ["driver_approval_required", "driver_docs_required", "driver_min_rating"] },
  { title: "Активность", icon: <Clock className="w-4 h-4" />, keys: ["driver_max_idle_minutes", "driver_location_interval_sec"] },
  { title: "Автомобиль", icon: <Car className="w-4 h-4" />, keys: ["driver_default_seats"] },
  { title: "Баланс", icon: <Wallet className="w-4 h-4" />, keys: ["min_driver_balance"] },
];

export default function DriversSettings() {
  const { settings, loading, editValues, setEditValues, saving, savedKeys, hasChanges, saveAll } = useSettings("drivers");
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const ok = await saveAll();
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  };

  const onChange = (key: string, val: string) => setEditValues(v => ({ ...v, [key]: val }));
  const settingMap = new Map(settings.map(s => [s.key, s]));

  return (
    <SettingsPageLayout
      title="Водители"
      subtitle="Верификация, активность, авто"
      icon={<Car className="w-5 h-5" />}
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
