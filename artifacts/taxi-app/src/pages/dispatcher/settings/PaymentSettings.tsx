import { useState } from "react";
import { CreditCard, Key, Smartphone } from "lucide-react";
import { useSettings } from "./use-settings";
import { SettingsGroup, SettingRow, SettingsSkeleton } from "./SettingsCard";
import { SettingsPageLayout } from "./SettingsPageLayout";

const GROUPS = [
  {
    title: "Atmos — Подключение",
    icon: <Key className="w-4 h-4" />,
    keys: ["atmos_enabled", "atmos_consumer_key", "atmos_consumer_secret", "atmos_store_id", "atmos_terminal_id"],
  },
  {
    title: "Payme — Подключение",
    icon: <Smartphone className="w-4 h-4" />,
    keys: ["payme_enabled", "payme_merchant_id", "payme_merchant_key", "payme_min_amount", "payme_max_amount"],
  },
];

export default function PaymentSettings() {
  const { settings, loading, editValues, setEditValues, saving, savedKeys, hasChanges, saveAll } = useSettings("payments");
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const ok = await saveAll();
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  };

  const onChange = (key: string, val: string) => setEditValues(v => ({ ...v, [key]: val }));
  const settingMap = new Map(settings.map(s => [s.key, s]));

  return (
    <SettingsPageLayout
      title="Платёжные системы"
      subtitle="Настройки платёжных шлюзов для приёма платежей"
      icon={<CreditCard className="w-5 h-5" />}
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

          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 space-y-2">
            <h4 className="text-sm font-semibold text-blue-700 flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              Как настроить Atmos
            </h4>
            <ol className="text-xs text-blue-600/80 space-y-1 list-decimal list-inside">
              <li>Зарегистрируйтесь на <a href="https://atmos.uz" target="_blank" rel="noopener" className="underline">atmos.uz</a></li>
              <li>Получите Consumer Key и Consumer Secret</li>
              <li>Укажите Store ID вашего магазина</li>
              <li>Включите переключатель «Atmos включён»</li>
              <li>Водители смогут привязывать карты UzCard/Humo и пополнять баланс</li>
            </ol>
          </div>

          <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 space-y-2">
            <h4 className="text-sm font-semibold text-green-700 flex items-center gap-2">
              <Smartphone className="w-4 h-4" />
              Как настроить Payme
            </h4>
            <ol className="text-xs text-green-600/80 space-y-1 list-decimal list-inside">
              <li>Зарегистрируйтесь на <a href="https://payme.uz" target="_blank" rel="noopener" className="underline">payme.uz</a> и создайте кассу с биллингом</li>
              <li>В личном кабинете найдите Merchant ID и Merchant Key</li>
              <li>Укажите URL эндпоинта в настройках кассы Payme: <code className="bg-green-100 px-1 rounded text-green-800">{window.location.origin}/api/payme</code></li>
              <li>Включите переключатель «Payme включён»</li>
              <li>Водители смогут пополнять баланс через приложение Payme, указав свой номер телефона</li>
            </ol>
          </div>
        </div>
      )}
    </SettingsPageLayout>
  );
}
