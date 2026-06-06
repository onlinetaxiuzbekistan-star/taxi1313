import { useState, useEffect, useCallback } from "react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export interface Setting {
  id: number;
  key: string;
  value: string;
  label: string;
  category: string;
}

export function useSettings(category?: string) {
  const token = localStorage.getItem("authToken");
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = category
        ? `${BASE_URL}/api/settings?category=${category}`
        : `${BASE_URL}/api/settings`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings || []);
        const vals: Record<string, string> = {};
        (data.settings || []).forEach((s: Setting) => { vals[s.key] = s.value; });
        setEditValues(vals);
      }
    } catch {}
    setLoading(false);
  }, [token, category]);

  useEffect(() => { load(); }, [load]);

  const hasChanges = settings.some(s => editValues[s.key] !== s.value);

  const changedKeys = settings
    .filter(s => editValues[s.key] !== s.value)
    .map(s => s.key);

  const saveAll = async (): Promise<boolean> => {
    if (!hasChanges) return false;
    setSaving(true);
    try {
      const items = changedKeys.map(key => ({ key, value: editValues[key] }));
      const res = await fetch(`${BASE_URL}/api/settings/batch`, {
        method: "PATCH", headers,
        body: JSON.stringify({ settings: items }),
      });
      if (res.ok) {
        setSavedKeys(new Set(changedKeys));
        setTimeout(() => setSavedKeys(new Set()), 2000);
        await load();
        setSaving(false);
        return true;
      } else {
        const data = await res.json();
        alert(data.message || "Ошибка сохранения");
        setSaving(false);
        return false;
      }
    } catch {
      alert("Ошибка сети");
      setSaving(false);
      return false;
    }
  };

  const saveSingle = async (key: string) => {
    setSaving(true);
    try {
      const res = await fetch(`${BASE_URL}/api/settings/${key}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ value: editValues[key] }),
      });
      if (res.ok) {
        setSavedKeys(new Set([key]));
        setTimeout(() => setSavedKeys(new Set()), 2000);
        await load();
      } else {
        const data = await res.json();
        alert(data.message || "Ошибка сохранения");
      }
    } catch { alert("Ошибка сети"); }
    setSaving(false);
  };

  return {
    settings, loading, editValues, setEditValues,
    saving, savedKeys, hasChanges, changedKeys,
    saveAll, saveSingle, reload: load,
  };
}
