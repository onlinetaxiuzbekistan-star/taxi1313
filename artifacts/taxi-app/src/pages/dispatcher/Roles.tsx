import { useState, useEffect, useCallback } from "react";
import DispatcherLayout from "./DispatcherLayout";
import { Plus, Pencil, Trash2, X, Save, Loader2, AlertCircle, Shield, ChevronDown, ChevronUp } from "lucide-react";
import { ErrorState } from "@/components/PageStates";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface Permission {
  id: number;
  key: string;
  group: string;
  label: string;
}

interface Role {
  id: number;
  name: string;
  description: string | null;
  permissionIds: number[];
}

function RoleModal({ role, permissions, onClose, onSaved, token }: {
  role: Role | null;
  permissions: Permission[];
  onClose: () => void;
  onSaved: () => void;
  token: string | null;
}) {
  const isEdit = !!role;
  const [name, setName] = useState(role?.name || "");
  const [description, setDescription] = useState(role?.description || "");
  const [selectedPerms, setSelectedPerms] = useState<Set<number>>(new Set(role?.permissionIds || []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const groups = Array.from(new Set(permissions.map(p => p.group)));

  const togglePerm = (id: number) => {
    setSelectedPerms(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (group: string) => {
    const groupPerms = permissions.filter(p => p.group === group);
    const allSelected = groupPerms.every(p => selectedPerms.has(p.id));
    setSelectedPerms(prev => {
      const next = new Set(prev);
      groupPerms.forEach(p => {
        if (allSelected) next.delete(p.id);
        else next.add(p.id);
      });
      return next;
    });
  };

  const toggleExpand = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError("Укажите название роли"); return; }

    setSaving(true);
    try {
      const url = isEdit ? `${BASE_URL}/api/rbac/roles/${role!.id}` : `${BASE_URL}/api/rbac/roles`;
      const method = isEdit ? "PATCH" : "POST";
      const body = { name: name.trim(), description: description.trim() || null, permissionIds: Array.from(selectedPerms) };
      const res = await fetch(url, { method, headers, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Ошибка сохранения"); setSaving(false); return; }
      onSaved();
      onClose();
    } catch { setError("Ошибка сети"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <h3 className="font-bold text-foreground text-lg">{isEdit ? "Редактировать роль" : "Новая роль"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground active:scale-90 transition-all"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Название роли *</label>
              <input value={name} onChange={e => setName(e.target.value)} required placeholder="Например: Старший диспетчер"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Описание</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Краткое описание роли"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-foreground">Права доступа</label>
                <span className="text-xs text-muted-foreground">{selectedPerms.size} из {permissions.length}</span>
              </div>
              <div className="space-y-1">
                {groups.map(group => {
                  const groupPerms = permissions.filter(p => p.group === group);
                  const allSelected = groupPerms.every(p => selectedPerms.has(p.id));
                  const someSelected = groupPerms.some(p => selectedPerms.has(p.id));
                  const expanded = expandedGroups.has(group);
                  return (
                    <div key={group} className="border border-border rounded-lg overflow-hidden">
                      <div className="flex items-center gap-3 px-3 py-2.5 bg-muted/50 cursor-pointer select-none" onClick={() => toggleExpand(group)}>
                        <button type="button" onClick={e => { e.stopPropagation(); toggleGroup(group); }}
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                            allSelected ? "bg-emerald-500 border-emerald-500" :
                            someSelected ? "bg-emerald-500/30 border-emerald-500" : "border-border"
                          }`}>
                          {(allSelected || someSelected) && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              {allSelected ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /> :
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />}
                            </svg>
                          )}
                        </button>
                        <span className="text-sm font-medium text-foreground flex-1">{group}</span>
                        <span className="text-xs text-muted-foreground mr-1">{groupPerms.filter(p => selectedPerms.has(p.id)).length}/{groupPerms.length}</span>
                        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                      </div>
                      {expanded && (
                        <div className="px-3 py-2 space-y-1.5 border-t border-border">
                          {groupPerms.map(p => (
                            <label key={p.id} className="flex items-center gap-3 cursor-pointer hover:bg-muted/30 rounded px-1 py-1 transition-colors">
                              <button type="button" onClick={() => togglePerm(p.id)}
                                className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                                  selectedPerms.has(p.id) ? "bg-emerald-500 border-emerald-500" : "border-border"
                                }`}>
                                {selectedPerms.has(p.id) && (
                                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </button>
                              <div className="flex-1">
                                <span className="text-sm text-foreground">{p.label}</span>
                                <span className="text-xs text-muted-foreground ml-2">({p.key})</span>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-700 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />{error}
              </div>
            )}
          </div>
          <div className="p-5 border-t border-border shrink-0 flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-foreground hover:bg-muted active:bg-accent transition-colors">Отмена</button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium active:scale-[0.97] transition-all disabled:opacity-60 flex items-center justify-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isEdit ? "Сохранить" : "Создать"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Roles() {
  const token = localStorage.getItem("authToken");
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [modal, setModal] = useState<Role | null | "new">(null);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        fetch(`${BASE_URL}/api/rbac/roles`, { headers }),
        fetch(`${BASE_URL}/api/rbac/permissions`, { headers }),
      ]);
      if (rolesRes.ok && permsRes.ok) {
        const rolesData = await rolesRes.json();
        const permsData = await permsRes.json();
        setRoles(rolesData.roles || []);
        setPermissions(permsData.permissions || []);
      } else setFetchError(true);
    } catch { setFetchError(true); }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: number) => {
    if (!confirm("Удалить эту роль?")) return;
    try {
      const res = await fetch(`${BASE_URL}/api/rbac/roles/${id}`, { method: "DELETE", headers });
      if (res.ok) setRoles(r => r.filter(x => x.id !== id));
      else { const data = await res.json(); alert(data.message || "Ошибка удаления"); }
    } catch { alert("Ошибка сети"); }
  };

  return (
    <DispatcherLayout>
      {modal !== null && (
        <RoleModal role={modal === "new" ? null : modal} permissions={permissions} onClose={() => setModal(null)} onSaved={load} token={token} />
      )}
      <div className="p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-foreground">Роли и права</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Управление ролями сотрудников и правами доступа</p>
          </div>
          <button onClick={() => setModal("new")}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium active:scale-[0.97] transition-all">
            <Plus className="w-4 h-4" />Новая роль
          </button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-card rounded-xl border border-border p-5 h-24 animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
            ))}
          </div>
        ) : fetchError ? (
          <ErrorState message="Не удалось загрузить роли" onRetry={load} />
        ) : roles.length === 0 ? (
          <div className="bg-background rounded-xl border border-border text-center py-16">
            <Shield className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">Нет ролей</p>
            <p className="text-sm text-muted-foreground mt-1">Создайте первую роль для управления доступом</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {roles.map(role => {
              const permNames = role.permissionIds
                .map(pid => permissions.find(p => p.id === pid))
                .filter(Boolean) as Permission[];
              const groups = Array.from(new Set(permNames.map(p => p.group)));

              return (
                <div key={role.id} className="bg-card border border-border rounded-xl p-5 hover:shadow-sm transition-shadow">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-foreground text-base flex items-center gap-2">
                        <Shield className="w-4 h-4 text-emerald-600" />
                        {role.name}
                      </h3>
                      {role.description && <p className="text-sm text-muted-foreground mt-0.5">{role.description}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setModal(role)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(role.id)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-500/10 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {groups.map(g => (
                      <span key={g} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-700">
                        {g} ({permNames.filter(p => p.group === g).length})
                      </span>
                    ))}
                    {role.permissionIds.length === 0 && (
                      <span className="text-xs text-muted-foreground italic">Нет назначенных прав</span>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Всего прав: {role.permissionIds.length} из {permissions.length}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DispatcherLayout>
  );
}
