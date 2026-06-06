import { useState } from "react";
import { Wallet, Percent, CreditCard, Trophy, Users } from "lucide-react";
import { useSettings } from "./use-settings";
import { SettingsGroup, SettingRow, SettingsSkeleton } from "./SettingsCard";
import { SettingsPageLayout } from "./SettingsPageLayout";

const GROUPS = [
  { title: "Комиссия", icon: <Percent className="w-4 h-4" />, keys: ["commission_percent", "commission_fixed"] },
  { title: "Штрафы", icon: <Wallet className="w-4 h-4" />, keys: ["cancel_penalty_amount", "ignore_penalty_amount"] },
  { title: "Бонусы и рефералы", icon: <Trophy className="w-4 h-4" />, keys: ["milestone_bonus_amount", "milestone_interval", "referral_bonus_inviter", "referral_bonus_invitee"] },
  { title: "Выплаты", icon: <CreditCard className="w-4 h-4" />, keys: ["payout_min_amount", "payout_auto"] },
];

export default function FinanceSettings() {
  const { settings, loading, editValues, setEditValues, saving, savedKeys, hasChanges, saveAll } = useSettings("finance");
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const ok = await saveAll();
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  };

  const onChange = (key: string, val: string) => setEditValues(v => ({ ...v, [key]: val }));
  const settingMap = new Map(settings.map(s => [s.key, s]));

  return (
    <SettingsPageLayout
      title="Финансы"
      subtitle="Комиссия, штрафы, выплаты"
      icon={<Wallet className="w-5 h-5" />}
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
