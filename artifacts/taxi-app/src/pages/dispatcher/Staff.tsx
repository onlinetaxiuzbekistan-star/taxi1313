import { useState, useEffect, useCallback } from "react";
import DispatcherLayout from "./DispatcherLayout";
import { Plus, Pencil, Trash2, X, Save, Loader2, AlertCircle, Shield, ShieldCheck, Search, Phone, PhoneOff, Headphones, Building2 } from "lucide-react";
import { ErrorState } from "@/components/PageStates";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface StaffMember {
  id: number;
  name: string;
  login: string | null;
  phone: string;
  role: string;
  roleId: number | null;
  branchId: number | null;
  acceptsCalls: boolean;
  hasSip: boolean;
  sipServer: string | null;
  sipDomain: string | null;
  sipLogin: string | null;
  createdAt: string;
}

interface RbacRole { id: number; name: string; }
interface Branch { id: number; name: string; isActive: boolean; }

interface StaffForm {
  name: string;
  login: string;
  phone: string;
  password: string;
  role: string;
  roleId: string;
  branchId: string;
  sipServer: string;
  sipDomain: string;
  sipLogin: string;
  sipPassword: string;
}

const emptyForm: StaffForm = { name: "", login: "", phone: "", password: "", role: "dispatcher", roleId: "", branchId: "", sipServer: "", sipDomain: "", sipLogin: "", sipPassword: "" };

function StaffModal({ staff, onClose, onSaved, token, rbacRoles, branches }: {
  staff: StaffMember | null;
  onClose: () => void;
  onSaved: () => void;
  token: string | null;
  rbacRoles: RbacRole[];
  branches: Branch[];
}) {
  const isEdit = !!staff;
  const [form, setForm] = useState<StaffForm>(
    staff ? {
      name: staff.name, login: staff.login || "", phone: staff.phone, password: "", role: staff.role,
      roleId: staff.roleId?.toString() || "",
      branchId: staff.branchId?.toString() || "",
      sipServer: staff.sipServer || "", sipDomain: staff.sipDomain || "",
      sipLogin: staff.sipLogin || "", sipPassword: "",
    } : { ...emptyForm }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSip, setShowSip] = useState(isEdit && !!staff?.hasSip);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) { setError("Заполните имя"); return; }
    if (!isEdit && !form.password) { setError("Укажите пароль"); return; }

    setSaving(true);
    try {
      const url = isEdit ? `${BASE_URL}/api/staff/${staff!.id}` : `${BASE_URL}/api/staff`;
      const method = isEdit ? "PATCH" : "POST";
      const body: any = { name: form.name.trim(), phone: form.phone.trim(), role: form.role, login: form.login.trim() || null };
      if (form.password) body.password = form.password;
      if (form.roleId) body.roleId = parseInt(form.roleId);
      else body.roleId = null;
      body.branchId = form.branchId ? parseInt(form.branchId) : null;
      body.sipServer = form.sipServer.trim() || null;
      body.sipDomain = form.sipDomain.trim() || null;
      body.sipLogin = form.sipLogin.trim() || null;
      if (form.sipPassword) body.sipPassword = form.sipPassword;

      const res = await fetch(url, { method, headers, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Ошибка сохранения"); setSaving(false); return; }
      onSaved();
      onClose();
    } catch { setError("Ошибка сети"); }
    setSaving(false);
  };

  const inputCls = "w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500";

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-card z-10">
          <h3 className="font-bold text-foreground text-lg">{isEdit ? "Редактировать сотрудника" : "Новый сотрудник"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground active:scale-90 transition-all"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Имя *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Логин</label>
            <input value={form.login} onChange={e => setForm(f => ({ ...f, login: e.target.value }))} placeholder="admin" className={inputCls} />
            <p className="text-xs text-muted-foreground mt-1">Для входа по логину (вместо телефона)</p>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Телефон</label>
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} required placeholder="+998..." className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">{isEdit ? "Новый пароль (оставьте пустым)" : "Пароль *"}</label>
            <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              required={!isEdit} placeholder={isEdit ? "Без изменений" : "Пароль"} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Системная роль *</label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className={inputCls}>
              <option value="dispatcher">Диспетчер</option>
              <option value="admin">Администратор</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">
              <Building2 className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
              Филиал
            </label>
            <select value={form.branchId} onChange={e => setForm(f => ({ ...f, branchId: e.target.value }))} className={inputCls}>
              <option value="">Без привязки (видит все филиалы)</option>
              {branches.filter(b => b.isActive).map(b => (
                <option key={b.id} value={String(b.id)}>{b.name}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">Сотрудник увидит только водителей и заказы выбранного филиала</p>
          </div>
          {rbacRoles.length > 0 && (
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Роль доступа (RBAC)</label>
              <select value={form.roleId} onChange={e => setForm(f => ({ ...f, roleId: e.target.value }))} className={inputCls}>
                <option value="">Без роли</option>
                {rbacRoles.map(r => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
              </select>
            </div>
          )}

          <div className="border-t border-border pt-3">
            <button type="button" onClick={() => setShowSip(s => !s)}
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700 flex items-center gap-1">
              <Headphones className="w-3.5 h-3.5" />
              {showSip ? "Скрыть SIP-настройки" : "Показать SIP-настройки"}
            </button>
            {showSip && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <input value={form.sipServer} onChange={e => setForm(f => ({ ...f, sipServer: e.target.value }))} placeholder="SIP сервер" className={inputCls} />
                  <input value={form.sipDomain} onChange={e => setForm(f => ({ ...f, sipDomain: e.target.value }))} placeholder="Домен" className={inputCls} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={form.sipLogin} onChange={e => setForm(f => ({ ...f, sipLogin: e.target.value }))} placeholder="SIP логин" className={inputCls} />
                  <input type="password" value={form.sipPassword} onChange={e => setForm(f => ({ ...f, sipPassword: e.target.value }))} placeholder={isEdit ? "Без изменений" : "SIP пароль"} className={inputCls} />
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-500/10 px-3 py-2 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border border-border hover:bg-muted transition-colors">Отмена</button>
            <button type="submit" disabled={saving}
              className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-60 transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isEdit ? "Сохранить" : "Создать"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Staff() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [rbacRoles, setRbacRoles] = useState<RbacRole[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [modal, setModal] = useState<StaffMember | "new" | null>(null);
  const [search, setSearch] = useState("");

  const token = typeof window !== "undefined" ? localStorage.getItem("authToken") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const [staffRes, rolesRes, branchesRes] = await Promise.all([
        fetch(`${BASE_URL}/api/staff`, { headers }),
        fetch(`${BASE_URL}/api/rbac/roles`, { headers }),
        fetch(`${BASE_URL}/api/branches`, { headers }),
      ]);
      if (staffRes.ok) { const data = await staffRes.json(); setStaff(data.staff || []); }
      else setFetchError(true);
      if (rolesRes.ok) { const data = await rolesRes.json(); setRbacRoles(data.roles || []); }
      if (branchesRes.ok) { const data = await branchesRes.json(); setBranches(data.branches || []); }
    } catch { setFetchError(true); }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: number) => {
    if (!confirm("Удалить этого сотрудника?")) return;
    try {
      const res = await fetch(`${BASE_URL}/api/staff/${id}`, { method: "DELETE", headers });
      if (res.ok) setStaff(s => s.filter(x => x.id !== id));
      else { const data = await res.json(); alert(data.message || "Ошибка удаления"); }
    } catch { alert("Ошибка сети"); }
  };

  const handleToggleCalls = async (id: number, currentValue: boolean) => {
    const newValue = !currentValue;
    setStaff(s => s.map(x => x.id === id ? { ...x, acceptsCalls: newValue } : x));
    try {
      const res = await fetch(`${BASE_URL}/api/staff/${id}/calls-setting`, {
        method: "PATCH", headers,
        body: JSON.stringify({ acceptsCalls: newValue }),
      });
      if (!res.ok) {
        setStaff(s => s.map(x => x.id === id ? { ...x, acceptsCalls: currentValue } : x));
      }
    } catch {
      setStaff(s => s.map(x => x.id === id ? { ...x, acceptsCalls: currentValue } : x));
    }
  };

  const filtered = staff.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.phone.includes(search) ||
    (s.login && s.login.toLowerCase().includes(search.toLowerCase()))
  );

  const roleLabel = (r: string) => r === "admin" ? "Администратор" : "Диспетчер";
  const rbacRoleName = (roleId: number | null) => roleId ? (rbacRoles.find(r => r.id === roleId)?.name || null) : null;
  const branchName = (id: number | null) => id ? (branches.find(b => b.id === id)?.name || `#${id}`) : null;

  return (
    <DispatcherLayout>
      {modal !== null && (
        <StaffModal staff={modal === "new" ? null : modal} onClose={() => setModal(null)} onSaved={load} token={token} rbacRoles={rbacRoles} branches={branches} />
      )}
      <div className="p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-foreground">Сотрудники</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Управление диспетчерами и администраторами</p>
          </div>
          <button onClick={() => setModal("new")}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium active:scale-[0.97] transition-all">
            <Plus className="w-4 h-4" />Добавить сотрудника
          </button>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по имени, логину или телефону..."
            className="w-full pl-10 pr-4 py-2.5 border border-border rounded-lg text-sm outline-none focus:border-emerald-500" />
        </div>

        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-card rounded-xl border border-border p-5 h-20 animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
            ))}
          </div>
        ) : fetchError ? (
          <ErrorState message="Не удалось загрузить сотрудников" onRetry={load} />
        ) : filtered.length === 0 ? (
          <div className="bg-background rounded-xl border border-border text-center py-16">
            <Shield className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">{search ? "Никого не найдено" : "Нет сотрудников"}</p>
            {!search && <p className="text-sm text-muted-foreground mt-1">Добавьте первого сотрудника</p>}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full min-w-[1200px] text-sm text-left">
              <thead className="bg-muted border-b border-border text-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Имя</th>
                  <th className="px-5 py-3 font-medium">Логин</th>
                  <th className="px-5 py-3 font-medium">Телефон</th>
                  <th className="px-5 py-3 font-medium">Системная роль</th>
                  <th className="px-5 py-3 font-medium">Филиал</th>
                  <th className="px-5 py-3 font-medium">Роль доступа</th>
                  <th className="px-5 py-3 font-medium">SIP</th>
                  <th className="px-5 py-3 font-medium">Звонки</th>
                  <th className="px-5 py-3 font-medium">Дата</th>
                  <th className="px-5 py-3 font-medium text-right sticky right-0 bg-muted shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.1)]">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(s => {
                  const rbacName = rbacRoleName(s.roleId);
                  const branch = branchName(s.branchId);
                  return (
                    <tr key={s.id} className="cursor-pointer hover:bg-primary/5 transition-colors">
                      <td className="px-5 py-3 font-medium text-foreground">{s.name}</td>
                      <td className="px-5 py-3 text-foreground text-xs">{s.login || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-5 py-3 text-foreground">{s.phone}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                          s.role === "admin" ? "bg-purple-500/10 text-purple-700" : "bg-emerald-500/10 text-emerald-700"
                        }`}>
                          {s.role === "admin" ? <ShieldCheck className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                          {roleLabel(s.role)}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {branch ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-violet-500/10 text-violet-700">
                            <Building2 className="w-3 h-3" />
                            {branch}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">все филиалы</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {rbacName ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-700">
                            {rbacName}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {s.hasSip ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-700">
                            <Headphones className="w-3 h-3" />
                            {s.sipLogin}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <button onClick={(e) => { e.stopPropagation(); handleToggleCalls(s.id, s.acceptsCalls); }}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                            s.acceptsCalls ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20" : "bg-red-500/10 text-red-600 hover:bg-red-500/20"
                          }`}>
                          {s.acceptsCalls ? <Phone className="w-3 h-3" /> : <PhoneOff className="w-3 h-3" />}
                          {s.acceptsCalls ? "Вкл" : "Выкл"}
                        </button>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground text-xs">
                        {new Date(s.createdAt).toLocaleDateString("ru-RU")}
                      </td>
                      <td className="px-5 py-3 text-right sticky right-0 bg-card shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.1)]">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setModal(s)} className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDelete(s.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-500/10 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DispatcherLayout>
  );
}
