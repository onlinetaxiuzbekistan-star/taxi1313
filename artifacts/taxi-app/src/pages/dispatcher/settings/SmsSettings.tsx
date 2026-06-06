import { useState } from "react";
import { MessageSquare, Wifi } from "lucide-react";
import { useSettings } from "./use-settings";
import { SettingsGroup, SettingRow, SettingsSkeleton } from "./SettingsCard";
import { SettingsPageLayout } from "./SettingsPageLayout";

const GROUPS = [
  {
    title: "SMS шлюз — Подключение",
    icon: <Wifi className="w-4 h-4" />,
    keys: ["sms_enabled"],
  },
];

export default function SmsSettings() {
  const { settings, loading, editValues, setEditValues, saving, savedKeys, hasChanges, saveAll } = useSettings("sms");
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const ok = await saveAll();
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  };

  const onChange = (key: string, val: string) => setEditValues(v => ({ ...v, [key]: val }));
  const settingMap = new Map(settings.map(s => [s.key, s]));

  return (
    <SettingsPageLayout
      title="SMS сервис"
      subtitle="Локальный SMS шлюз через USB модемы"
      icon={<MessageSquare className="w-5 h-5" />}
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
                {items.map((s: any) => (
                  <SettingRow
                    key={s.key}
                    setting={s}
                    value={editValues[s.key] ?? s.value}
                    originalValue={s.value}
                    onChange={onChange}
                    isSaved={savedKeys.has(s.key)}
                  />
                ))}
              </SettingsGroup>
            );
          })}

          <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 space-y-2">
            <h4 className="text-sm font-semibold text-green-700 flex items-center gap-2">
              <Wifi className="w-4 h-4" />
              Локальный SMS шлюз
            </h4>
            <ul className="text-xs text-green-600/80 space-y-1 list-disc list-inside">
              <li>SMS отправляются через USB модемы Huawei E3372</li>
              <li>Шлюз: 192.168.1.107:3000</li>
              <li>Включите переключатель «SMS включён» для отправки</li>
              <li>Коды авторизации водителей и уведомления о заказах</li>
            </ul>
          </div>
        </div>
      )}
    </SettingsPageLayout>
  );
}
