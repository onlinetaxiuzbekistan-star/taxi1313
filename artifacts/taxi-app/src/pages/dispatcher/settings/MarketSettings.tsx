import { useState } from "react";
import { ShoppingCart, Package, ArrowLeftRight, DollarSign } from "lucide-react";
import { useSettings } from "./use-settings";
import { SettingsGroup, SettingRow, SettingsSkeleton } from "./SettingsCard";
import { SettingsPageLayout } from "./SettingsPageLayout";

const GROUPS = [
  { title: "Маркетплейс", icon: <ShoppingCart className="w-4 h-4" />, keys: ["market_enabled", "market_bidding"] },
  { title: "Лимиты заказов", icon: <Package className="w-4 h-4" />, keys: ["max_active_orders", "max_orders_per_day"] },
  { title: "Передача заказов", icon: <ArrowLeftRight className="w-4 h-4" />, keys: ["max_transfers", "transfer_time_limit_minutes"] },
  { title: "Лимиты цен", icon: <DollarSign className="w-4 h-4" />, keys: ["min_order_price", "max_order_price"] },
];

export default function MarketSettings() {
  const { settings, loading, editValues, setEditValues, saving, savedKeys, hasChanges, saveAll } = useSettings("market");
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const ok = await saveAll();
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  };

  const onChange = (key: string, val: string) => setEditValues(v => ({ ...v, [key]: val }));
  const settingMap = new Map(settings.map(s => [s.key, s]));

  return (
    <SettingsPageLayout
      title="Маркет"
      subtitle="Маркетплейс, лимиты, передача"
      icon={<ShoppingCart className="w-5 h-5" />}
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
