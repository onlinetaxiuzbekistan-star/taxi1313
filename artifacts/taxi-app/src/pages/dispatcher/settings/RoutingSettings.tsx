import { useState } from "react";
import { Route, Users, MapPin } from "lucide-react";
import { useSettings } from "./use-settings";
import { SettingsGroup, SettingRow, SettingsSkeleton } from "./SettingsCard";
import { SettingsPageLayout } from "./SettingsPageLayout";

const GROUPS = [
  { title: "Попутчики (Pool)", icon: <Users className="w-4 h-4" />, keys: ["allow_multi_passenger", "time_window_minutes", "max_detour_minutes", "default_seats"] },
  { title: "Маршрут", icon: <MapPin className="w-4 h-4" />, keys: ["waypoints_max", "route_optimization"] },
];

export default function RoutingSettings() {
  const { settings, loading, editValues, setEditValues, saving, savedKeys, hasChanges, saveAll } = useSettings("routing");
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const ok = await saveAll();
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  };

  const onChange = (key: string, val: string) => setEditValues(v => ({ ...v, [key]: val }));
  const settingMap = new Map(settings.map(s => [s.key, s]));

  return (
    <SettingsPageLayout
      title="Маршруты"
      subtitle="Попутчики, маршрутизация"
      icon={<Route className="w-5 h-5" />}
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
