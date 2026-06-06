import { useState } from "react";
import { Bell, Clock, MessageCircle } from "lucide-react";
import { useSettings } from "./use-settings";
import { SettingsGroup, SettingRow, SettingsSkeleton } from "./SettingsCard";
import { SettingsPageLayout } from "./SettingsPageLayout";

const GROUPS = [
  {
    title: "Уведомления клиента",
    icon: <Bell className="w-4 h-4" />,
    keys: [
      "sms_on_order_accepted",
      "sms_on_order_in_progress",
      "sms_on_order_completed",
      "sms_on_order_cancelled",
      "sms_on_verification_code",
    ],
  },
  {
    title: "Авто-отмена заказов",
    icon: <Clock className="w-4 h-4" />,
    keys: [
      "order_auto_cancel_enabled",
      "order_auto_cancel_minutes",
    ],
  },
  {
    title: "Шаблоны SMS",
    icon: <MessageCircle className="w-4 h-4" />,
    keys: [
      "sms_text_accepted",
      "sms_text_in_progress",
      "sms_text_completed",
      "sms_text_cancelled",
      "sms_text_auto_cancelled",
      "sms_text_verification",
    ],
  },
];

export default function NotificationSettings() {
  const { settings, loading, editValues, setEditValues, saving, savedKeys, hasChanges, saveAll } = useSettings("notifications");
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const ok = await saveAll();
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  };

  const onChange = (key: string, val: string) => setEditValues(v => ({ ...v, [key]: val }));
  const settingMap = new Map(settings.map(s => [s.key, s]));

  return (
    <SettingsPageLayout
      title="Уведомления клиента"
      subtitle="Какие СМС отправлять клиентам"
      icon={<Bell className="w-5 h-5" />}
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

          <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 space-y-2">
            <h4 className="text-sm font-semibold text-amber-700 flex items-center gap-2">
              <MessageCircle className="w-4 h-4" />
              Переменные для шаблонов
            </h4>
            <div className="text-xs text-amber-600/80 space-y-1">
              <p><code className="bg-amber-100 px-1 rounded">{"{driver}"}</code> — имя водителя</p>
              <p><code className="bg-amber-100 px-1 rounded">{"{driver_phone}"}</code> — телефон водителя</p>
              <p><code className="bg-amber-100 px-1 rounded">{"{car}"}</code> — марка и номер авто</p>
              <p><code className="bg-amber-100 px-1 rounded">{"{code}"}</code> — код подтверждения (6 цифр)</p>
              <p><code className="bg-amber-100 px-1 rounded">{"{price}"}</code> — цена поездки</p>
              <p><code className="bg-amber-100 px-1 rounded">{"{from}"}</code> — адрес отправления</p>
              <p><code className="bg-amber-100 px-1 rounded">{"{to}"}</code> — адрес назначения</p>
            </div>
          </div>
        </div>
      )}
    </SettingsPageLayout>
  );
}
