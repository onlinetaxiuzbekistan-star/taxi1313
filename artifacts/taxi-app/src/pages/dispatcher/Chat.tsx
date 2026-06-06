import { useState, useEffect, useCallback, useRef } from "react";
import DispatcherLayout from "./DispatcherLayout";
import { Search, MessageSquare, Loader2, User, Users, Plus, X, ArrowLeft, Send, Mic, Pause, Play, Smile, Image as ImageIcon, Settings, Phone, Camera, Check, CheckCheck, Trash2, UserPlus } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import ChatModal from "@/components/ChatModal";
import VoiceCallModal from "@/components/VoiceCallModal";
import { useGroupChatList, useGroupChat, type GroupChatInfo, type GroupChatMessage } from "@/hooks/use-group-chat";
import { format, isToday, isYesterday } from "date-fns";
import { ru } from "date-fns/locale";

const API_BASE = import.meta.env.VITE_API_URL || "/api";
const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface Conversation {
  peerId: number;
  peerName: string;
  peerPhone: string;
  peerRole: string;
  lastMessage: string;
  lastMessageType: string;
  lastMessageAt: string | null;
  totalMessages: number;
  unreadCount: number;
}

interface UnifiedItem {
  kind: "dm" | "group";
  id: string;
  name: string;
  subtitle: string;
  lastMessage: string;
  lastMessageAt: string | null;
  unreadCount: number;
  dm?: Conversation;
  group?: GroupChatInfo;
}

const EMOJI_LIST = [
  "😀","😂","🤣","😊","😍","🥰","😘","😎","🤔","😢",
  "😭","😤","🤯","🥳","😴","🤮","👍","👎","👏","🙏",
  "❤️","🔥","⭐","✅","❌","🚗","🚕","🏠","📍","💰",
  "⏰","📞","💬","🎉","👋","🤝","💪","🙌","😅","🤗",
];

interface JoinRequest {
  id: number;
  chat_id: number;
  user_id: number;
  status: string;
  created_at: string;
  user_name: string;
  user_phone: string;
  user_city: string;
  chat_name: string;
}

type TabFilter = "all" | "dm" | "group" | "unread" | "requests";

export default function Chat() {
  const { token, user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const { chats: groupChats, loading: groupsLoading, refresh: refreshGroups } = useGroupChatList(token);
  const [loadingConvos, setLoadingConvos] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<TabFilter>("all");
  const [chatPeer, setChatPeer] = useState<{ id: number; name: string; role: string } | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupChatInfo | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [allDrivers, setAllDrivers] = useState<Array<{ id: number; name: string; phone: string; status: string; carModel: string | null }>>([]);
  const [showNewDM, setShowNewDM] = useState(false);

  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [processingRequest, setProcessingRequest] = useState<number | null>(null);

  const loadConversations = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/chat/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch {} finally {
      setLoadingConvos(false);
    }
  }, [token]);

  const loadDrivers = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${BASE_URL}/api/drivers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAllDrivers((data.drivers || data || []).filter((d: any) => d?.role === "driver"));
      }
    } catch {}
  }, [token]);

  const loadJoinRequests = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/group-chats/join-requests`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setJoinRequests(data.requests || []);
      }
    } catch {}
  }, [token]);

  const handleApproveRequest = async (requestId: number) => {
    if (!token) return;
    setProcessingRequest(requestId);
    try {
      const res = await fetch(`${API_BASE}/group-chats/join-requests/${requestId}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setJoinRequests(prev => prev.filter(r => r.id !== requestId));
        refreshGroups();
      }
    } catch {} finally {
      setProcessingRequest(null);
    }
  };

  const handleRejectRequest = async (requestId: number) => {
    if (!token) return;
    setProcessingRequest(requestId);
    try {
      const res = await fetch(`${API_BASE}/group-chats/join-requests/${requestId}/reject`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setJoinRequests(prev => prev.filter(r => r.id !== requestId));
      }
    } catch {} finally {
      setProcessingRequest(null);
    }
  };

  useEffect(() => { loadConversations(); loadDrivers(); loadJoinRequests(); }, [loadConversations, loadDrivers, loadJoinRequests]);

  const unified: UnifiedItem[] = [];

  for (const c of conversations) {
    unified.push({
      kind: "dm",
      id: `dm-${c.peerId}`,
      name: c.peerName,
      subtitle: c.peerPhone,
      lastMessage: c.lastMessage,
      lastMessageAt: c.lastMessageAt,
      unreadCount: c.unreadCount,
      dm: c,
    });
  }

  for (const g of groupChats) {
    unified.push({
      kind: "group",
      id: `group-${g.id}`,
      name: g.name,
      subtitle: `${g.memberCount} участник${g.memberCount < 5 ? "а" : "ов"}`,
      lastMessage: g.lastMessage ? `${g.lastSenderName?.split(" ")[0]}: ${g.lastMessage}` : "",
      lastMessageAt: g.lastMessageAt,
      unreadCount: 0,
      group: g,
    });
  }

  unified.sort((a, b) => {
    const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return tb - ta;
  });

  const filtered = unified.filter(item => {
    if (tab === "dm" && item.kind !== "dm") return false;
    if (tab === "group" && item.kind !== "group") return false;
    if (tab === "unread" && item.unreadCount === 0) return false;
    if (search) {
      const q = search.toLowerCase();
      return item.name.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q);
    }
    return true;
  });

  const handleSelectItem = (item: UnifiedItem) => {
    if (item.kind === "dm" && item.dm) {
      setChatPeer({ id: item.dm.peerId, name: item.dm.peerName, role: item.dm.peerRole });
      setSelectedGroup(null);
    } else if (item.kind === "group" && item.group) {
      setSelectedGroup(item.group);
      setChatPeer(null);
    }
  };

  const handleBack = () => {
    setSelectedGroup(null);
    setChatPeer(null);
    loadConversations();
    refreshGroups();
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr);
      if (isToday(d)) return format(d, "HH:mm");
      if (isYesterday(d)) return "Вчера";
      return format(d, "dd.MM");
    } catch { return ""; }
  };

  const loading = loadingConvos || groupsLoading;
  const totalUnread = unified.reduce((s, i) => s + i.unreadCount, 0);

  const tabs: { key: TabFilter; label: string; badge?: number }[] = [
    { key: "all", label: "Все" },
    { key: "dm", label: "Личные" },
    { key: "group", label: "Группы" },
    { key: "unread", label: "Непрочитанные", badge: totalUnread },
    { key: "requests", label: "Заявки", badge: joinRequests.length },
  ];

  if (selectedGroup) {
    return (
      <DispatcherLayout>
        <GroupChatView
          chat={selectedGroup}
          token={token}
          myUserId={user?.id}
          myRole={user?.role || ""}
          onBack={handleBack}
        />
      </DispatcherLayout>
    );
  }

  return (
    <DispatcherLayout>
      <div className="flex h-[calc(100vh-3.5rem)]">
        <div className="w-96 border-r border-border bg-card flex flex-col">
          <div className="px-3 pt-3 pb-2 border-b border-border space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">Сообщения</h2>
              <div className="flex gap-1">
                <button onClick={() => setShowNewDM(true)} className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center" title="Новый чат">
                  <MessageSquare className="w-4 h-4" />
                </button>
                <button onClick={() => setShowCreate(true)} className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center" title="Новая группа">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск..."
                className="w-full pl-10 pr-4 py-2 border border-border rounded-lg text-sm outline-none focus:border-emerald-500 bg-background" />
            </div>
            <div className="flex gap-1">
              {tabs.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${tab === t.key ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                >
                  {t.label}
                  {t.badge ? <span className="ml-1 bg-white/20 rounded-full px-1.5 text-[10px]">{t.badge}</span> : null}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {tab === "requests" ? (
              <div className="p-3 space-y-2">
                {joinRequests.length === 0 ? (
                  <div className="text-center py-10">
                    <UserPlus className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">Нет заявок на вступление</p>
                  </div>
                ) : (
                  joinRequests.map(req => (
                    <div key={req.id} className="p-3 rounded-xl bg-card border border-border/50 space-y-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                          <UserPlus className="w-5 h-5 text-amber-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{req.user_name}</p>
                          <p className="text-xs text-muted-foreground">{req.user_phone} · {req.user_city}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">→ <span className="font-medium text-foreground">{req.chat_name}</span></p>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleRejectRequest(req.id)}
                            disabled={processingRequest === req.id}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-600 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                          >
                            Отклонить
                          </button>
                          <button
                            onClick={() => handleApproveRequest(req.id)}
                            disabled={processingRequest === req.id}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
                          >
                            {processingRequest === req.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Принять"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground">
                {tab === "unread" ? "Нет непрочитанных" : "Нет чатов"}
              </div>
            ) : (
              filtered.map(item => {
                const isActive = (item.kind === "dm" && chatPeer?.id === item.dm?.peerId) || (item.kind === "group" && selectedGroup?.id === item.group?.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelectItem(item)}
                    className={`w-full text-left px-4 py-3 border-b border-border/50 hover:bg-muted/50 active:bg-muted transition-colors ${isActive ? "bg-emerald-500/10 border-l-2 border-l-emerald-500" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${item.kind === "group" ? "bg-emerald-500/10" : "bg-muted"}`}>
                        {item.kind === "group" ? <Users className="w-5 h-5 text-emerald-600" /> : <User className="w-5 h-5 text-muted-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold truncate">{item.name}</p>
                          <span className="text-[10px] text-muted-foreground shrink-0 ml-2">{formatTime(item.lastMessageAt)}</span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-xs text-muted-foreground truncate">{item.lastMessage || item.subtitle}</p>
                          {item.unreadCount > 0 && (
                            <span className="ml-2 bg-emerald-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shrink-0">
                              {item.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center bg-muted/30">
          {!chatPeer ? (
            <div className="text-center">
              <MessageSquare className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-lg font-semibold text-muted-foreground">Выберите чат</p>
              <p className="text-sm text-muted-foreground mt-1">для начала переписки</p>
            </div>
          ) : (
            <div className="text-center">
              <MessageSquare className="w-12 h-12 text-emerald-300 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Чат с {chatPeer.name} открыт</p>
            </div>
          )}
        </div>
      </div>

      {chatPeer && (
        <ChatModal
          open={!!chatPeer}
          onClose={() => { setChatPeer(null); loadConversations(); }}
          token={token}
          myUserId={user?.id}
          myRole={user?.role || "dispatcher"}
          peerId={chatPeer.id}
          peerName={chatPeer.name}
          peerRole={chatPeer.role}
        />
      )}

      {showCreate && (
        <CreateGroupChatDialog
          token={token}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refreshGroups(); }}
        />
      )}

      {showNewDM && (
        <NewDMDialog
          drivers={allDrivers}
          onSelect={(d) => { setChatPeer({ id: d.id, name: d.name, role: "driver" }); setShowNewDM(false); }}
          onClose={() => setShowNewDM(false)}
        />
      )}
    </DispatcherLayout>
  );
}

function NewDMDialog({ drivers, onSelect, onClose }: {
  drivers: Array<{ id: number; name: string; phone: string; status: string; carModel: string | null }>;
  onSelect: (d: { id: number; name: string }) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = drivers.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase()) || d.phone.includes(search)
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-md shadow-xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h2 className="font-bold text-base">Новый чат</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-2 border-b border-border shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск водителя..."
              className="w-full pl-10 pr-4 py-2 border border-border rounded-lg text-sm outline-none focus:border-emerald-500 bg-background" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map(d => (
            <button key={d.id} onClick={() => onSelect(d)} className="w-full text-left px-4 py-3 border-b border-border/50 hover:bg-muted transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{d.name}</p>
                  <p className="text-xs text-muted-foreground">{d.phone} {d.carModel ? `• ${d.carModel}` : ""}</p>
                </div>
                <span className={`w-2.5 h-2.5 rounded-full ${d.status === "online" ? "bg-emerald-500" : d.status === "busy" ? "bg-amber-500" : "bg-gray-300"}`} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CreateGroupChatDialog({ token, onClose, onCreated }: { token: string | null; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [chatType, setChatType] = useState("custom");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [cities, setCities] = useState<any[]>([]);
  const [driverGroups, setDriverGroups] = useState<any[]>([]);
  const [cityId, setCityId] = useState<number | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/cities`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setCities(d.cities || d || [])).catch(() => {});
    fetch(`${API_BASE}/driver-groups`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setDriverGroups(d.groups || d || [])).catch(() => {});
  }, [token]);

  const handleCreate = async () => {
    if (!token || !name.trim()) return;
    setCreating(true);
    try {
      const body: any = { name: name.trim(), chatType, description };
      if (chatType === "city" && cityId) body.cityId = cityId;
      if (chatType === "driver_group" && selectedGroupIds.length > 0) body.driverGroupIds = selectedGroupIds;

      const res = await fetch(`${API_BASE}/group-chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) onCreated();
    } catch {} finally {
      setCreating(false);
    }
  };

  const toggleGroup = (id: number) => {
    setSelectedGroupIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-bold text-base">Новая группа</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Название</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Например: Водители Ташкент"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Тип группы</label>
            <select
              value={chatType}
              onChange={e => { setChatType(e.target.value); setSelectedGroupIds([]); setCityId(null); }}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none"
            >
              <option value="custom">Пользовательская</option>
              <option value="city">По городу</option>
              <option value="driver_group">По группам водителей</option>
            </select>
          </div>
          {chatType === "city" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Город</label>
              <select
                value={cityId || ""}
                onChange={e => setCityId(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none"
              >
                <option value="">Выберите город</option>
                {cities.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name || c.nameRu}</option>
                ))}
              </select>
            </div>
          )}
          {chatType === "driver_group" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Группы водителей (можно несколько)</label>
              <div className="space-y-1 max-h-[200px] overflow-y-auto border border-border rounded-lg p-2">
                {driverGroups.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2 text-center">Нет групп водителей</p>
                ) : (
                  driverGroups.map((g: any) => (
                    <label key={g.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedGroupIds.includes(g.id)}
                        onChange={() => toggleGroup(g.id)}
                        className="w-4 h-4 rounded border-border accent-emerald-500"
                      />
                      <span className="text-sm">{g.name}</span>
                    </label>
                  ))
                )}
              </div>
              {selectedGroupIds.length > 0 && (
                <p className="text-xs text-emerald-600 mt-1">Выбрано: {selectedGroupIds.length}</p>
              )}
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Описание (необязательно)</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Описание группы"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>
        </div>
        <div className="px-4 py-3 border-t border-border flex gap-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">
            Отмена
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            className="flex-1 px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDateSeparator(dateStr: string) {
  try {
    const d = new Date(dateStr);
    if (isToday(d)) return "Сегодня";
    if (isYesterday(d)) return "Вчера";
    return format(d, "d MMMM yyyy", { locale: ru });
  } catch { return ""; }
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function GroupChatView({ chat, token, myUserId, onBack, myRole }: {
  chat: GroupChatInfo;
  token: string | null;
  myUserId: number | undefined;
  myRole: string;
  onBack: () => void;
}) {
  const { messages, loading, sending, sendMessage, sendPhoto, sendVoice, updateSettings } = useGroupChat(token, myUserId, chat.id);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<{ file: File; url: string } | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({ photosEnabled: chat.photosEnabled ?? true, voiceEnabled: chat.voiceEnabled ?? true, callsEnabled: chat.callsEnabled ?? true });
  const isDispatcher = myRole === "dispatcher" || myRole === "admin";

  const [callState, setCallState] = useState<{ open: boolean; incoming: boolean; peerId: number; peerName: string; offer?: RTCSessionDescriptionInit | null }>({ open: false, incoming: false, peerId: 0, peerName: "" });
  const callWsRef = useRef<WebSocket | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingTimeRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    setTimeout(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: smooth ? "smooth" : "instant" });
    }, 50);
  }, []);

  useEffect(() => { scrollToBottom(false); }, [loading]);
  useEffect(() => { scrollToBottom(true); }, [messages.length]);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 200); }, []);

  const handleSend = async () => {
    const msg = text.trim();
    if (!msg) return;
    setText("");
    setShowEmoji(false);
    await sendMessage(msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoPreview({ file, url: URL.createObjectURL(file) });
    e.target.value = "";
  };

  const handleSendPhoto = async () => {
    if (!photoPreview) return;
    const caption = text.trim();
    setText("");
    await sendPhoto(photoPreview.file, caption || undefined);
    URL.revokeObjectURL(photoPreview.url);
    setPhotoPreview(null);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const dur = recordingTimeRef.current;
        if (blob.size > 0 && dur > 0) await sendVoice(blob, dur);
        chunksRef.current = [];
      };
      recorder.start(100);
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimeRef.current = 0;
      recordingTimerRef.current = setInterval(() => { recordingTimeRef.current += 1; setRecordingTime(recordingTimeRef.current); }, 1000);
    } catch {}
  };

  const stopRecording = (cancel = false) => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      if (cancel) { mediaRecorderRef.current.ondataavailable = null; mediaRecorderRef.current.onstop = null; }
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
  };

  const handleToggleSetting = async (key: "photosEnabled" | "voiceEnabled" | "callsEnabled") => {
    const newVal = !settings[key];
    setSettings(prev => ({ ...prev, [key]: newVal }));
    await updateSettings({ [key]: newVal });
  };

  useEffect(() => {
    if (!token) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const base = (import.meta as any).env?.BASE_URL?.replace(/\/$/, "") || "";
    const wsUrl = `${protocol}//${window.location.host}${base}/api/ws`;
    const ws = new WebSocket(wsUrl);
    callWsRef.current = ws;
    ws.onopen = () => { ws.send(JSON.stringify({ type: "auth", token })); };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === "call_offer" && !callState.open) {
          setCallState({ open: true, incoming: true, peerId: data.fromUserId, peerName: data.fromUserName || "Звонок", offer: data.sdp });
        }
        window.dispatchEvent(new CustomEvent("buxtaxi:ws", { detail: data }));
      } catch {}
    };
    return () => { ws.close(); callWsRef.current = null; };
  }, [token]);

  const ROLE_COLORS: Record<string, string> = { driver: "#059669", dispatcher: "#6366f1", admin: "#dc2626" };

  const items: Array<{ type: "date"; label: string } | { type: "msg"; msg: GroupChatMessage }> = [];
  let lastDate = "";
  for (const msg of messages) {
    const msgDate = msg.createdAt ? new Date(msg.createdAt).toDateString() : "";
    if (msgDate && msgDate !== lastDate) { items.push({ type: "date", label: formatDateSeparator(msg.createdAt) }); lastDate = msgDate; }
    items.push({ type: "msg", msg });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <div className="shrink-0 bg-gradient-to-r from-emerald-600 to-emerald-700 px-4 py-3 shadow-lg">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center shrink-0">
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm text-white truncate">{chat.name}</p>
            <p className="text-[11px] text-emerald-100">{chat.memberCount} участник{chat.memberCount < 5 ? "а" : "ов"}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {settings.callsEnabled && chat.memberCount > 1 && (
              <button onClick={() => {
                const callPeer = chat.createdBy !== myUserId ? chat.createdBy : 0;
                if (callPeer > 0) setCallState({ open: true, incoming: false, peerId: callPeer, peerName: chat.name });
              }} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center" aria-label="Позвонить">
                <Phone className="w-4 h-4 text-white" />
              </button>
            )}
            {isDispatcher && (
              <button onClick={() => setShowSettings(!showSettings)} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center" aria-label="Настройки чата">
                <Settings className="w-4 h-4 text-white" />
              </button>
            )}
          </div>
        </div>
      </div>

      {showSettings && isDispatcher && (
        <div className="shrink-0 bg-card border-b border-border px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Настройки чата</p>
          {([
            { key: "photosEnabled" as const, label: "Фото", icon: Camera },
            { key: "voiceEnabled" as const, label: "Голосовые", icon: Mic },
            { key: "callsEnabled" as const, label: "Звонки", icon: Phone },
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => handleToggleSetting(key)}
              className="w-full flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Icon className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">{label}</span>
              </div>
              <div className={`w-10 h-6 rounded-full transition-colors relative ${settings[key] ? "bg-emerald-500" : "bg-muted-foreground/30"}`}>
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${settings[key] ? "left-[18px]" : "left-0.5"}`} />
              </div>
            </button>
          ))}
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23e2e8f0' fill-opacity='0.15'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }}>
        {loading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}

        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8 text-emerald-500" />
            </div>
            <p className="text-sm font-semibold">Нет сообщений</p>
            <p className="text-xs text-muted-foreground mt-1">Напишите первое сообщение в группу</p>
          </div>
        )}

        {items.map((item, i) => {
          if (item.type === "date") {
            return (
              <div key={`date-${i}`} className="flex justify-center my-3">
                <span className="bg-foreground/80 backdrop-blur-sm text-[11px] text-muted-foreground font-medium px-3 py-1 rounded-full shadow-sm border border-border/50">
                  {item.label}
                </span>
              </div>
            );
          }
          const msg = item.msg;
          const isMine = msg.senderId === myUserId;
          const prevItem = items[i - 1];
          const prevMsg = prevItem?.type === "msg" ? prevItem.msg : null;
          const isConsecutive = prevMsg && prevMsg.senderId === msg.senderId;
          const senderColor = ROLE_COLORS[msg.senderRole] || "#6b7280";
          const time = (() => { try { return format(new Date(msg.createdAt), "HH:mm"); } catch { return ""; } })();

          const isVoice = msg.type === "voice";
          let voiceData: { audioUrl: string; duration: number } | null = null;
          if (isVoice) { try { voiceData = JSON.parse(msg.message); } catch {} }

          const isPhoto = msg.type === "photo";
          let photoData: { photoUrl: string; caption: string } | null = null;
          if (isPhoto) { try { photoData = JSON.parse(msg.message); } catch {} }

          return (
            <div key={msg.id} className={`flex ${isMine ? "justify-end" : "justify-start"} ${!isMine && !isConsecutive ? "mt-2.5" : "mt-0.5"}`}>
              <div className="max-w-[82%]">
                {!isMine && !isConsecutive && (
                  <p className="text-[11px] font-semibold mb-0.5 ml-2" style={{ color: senderColor }}>{msg.senderName}</p>
                )}
                <div className={`rounded-2xl px-3 py-1.5 shadow-sm ${isMine ? "bg-emerald-500 text-white rounded-br-md" : "bg-card text-foreground rounded-bl-md border border-border/30"} ${isPhoto ? "px-1.5 py-1.5" : ""}`}>
                  {isPhoto && photoData ? (
                    <div className="space-y-1">
                      <div className="rounded-lg overflow-hidden cursor-pointer max-w-[240px]" onClick={() => setFullscreenImage(photoData!.photoUrl.startsWith("/") ? `${BASE_URL}${photoData!.photoUrl}` : photoData!.photoUrl)}>
                        <img src={photoData.photoUrl.startsWith("/") ? `${BASE_URL}${photoData.photoUrl}` : photoData.photoUrl} alt="" className="w-full max-h-[300px] object-cover" loading="lazy" />
                      </div>
                      {photoData.caption && <p className="text-[13.5px] leading-[1.35] whitespace-pre-wrap break-words">{photoData.caption}</p>}
                    </div>
                  ) : isVoice && voiceData ? (
                    <GCVoicePlayer audioUrl={voiceData.audioUrl} duration={voiceData.duration} isMine={isMine} />
                  ) : (
                    <p className="text-[13.5px] leading-[1.35] whitespace-pre-wrap break-words">{msg.message}</p>
                  )}
                  <div className="flex items-center justify-end gap-1 -mb-0.5 mt-0.5">
                    <span className={`text-[10px] ${isMine ? "text-white/60" : "text-muted-foreground/70"}`}>{time}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {photoPreview && (
        <div className="shrink-0 border-t border-border bg-card px-3 py-2">
          <div className="flex items-center gap-3">
            <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
              <img src={photoPreview.url} alt="Preview" className="w-full h-full object-cover" />
              <button onClick={() => { URL.revokeObjectURL(photoPreview.url); setPhotoPreview(null); }} className="absolute top-0 right-0 w-5 h-5 bg-black/60 rounded-bl-lg flex items-center justify-center">
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
            <input value={text} onChange={e => setText(e.target.value)} placeholder="Подпись к фото..." className="flex-1 bg-muted rounded-full px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/30" />
            <button onClick={handleSendPhoto} disabled={sending} className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 disabled:opacity-40">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
            </button>
          </div>
        </div>
      )}

      {showEmoji && !photoPreview && (
        <div className="shrink-0 border-t border-border bg-card px-2 py-2">
          <div className="grid grid-cols-8 gap-1 max-h-[140px] overflow-y-auto">
            {EMOJI_LIST.map(emoji => (
              <button key={emoji} onClick={() => { setText(prev => prev + emoji); inputRef.current?.focus(); }} className="w-9 h-9 flex items-center justify-center text-xl rounded-lg hover:bg-muted active:scale-90">
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {!photoPreview && (
        <div className="shrink-0 border-t border-border bg-card px-3 py-2.5">
          <input type="file" ref={fileInputRef} onChange={handlePhotoSelect} accept="image/*" className="hidden" />
          {isRecording ? (
            <div className="flex items-center gap-3">
              <div className="flex-1 flex items-center gap-3 bg-red-500/10 rounded-full px-4 py-2.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm font-mono text-red-600 tabular-nums">{formatDuration(recordingTime)}</span>
              </div>
              <button onClick={() => stopRecording(true)} className="w-10 h-10 rounded-full bg-muted/80 flex items-center justify-center"><X className="w-4 h-4" /></button>
              <button onClick={() => stopRecording(false)} disabled={sending} className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center disabled:opacity-40">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {settings.photosEnabled && (
                <button onClick={() => fileInputRef.current?.click()} disabled={sending} className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 disabled:opacity-40">
                  <ImageIcon className="w-5 h-5" />
                </button>
              )}
              <button onClick={() => setShowEmoji(!showEmoji)} className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${showEmoji ? "text-emerald-500 bg-emerald-500/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
                <Smile className="w-5 h-5" />
              </button>
              <input ref={inputRef} value={text} onChange={e => setText(e.target.value)} onKeyDown={handleKeyDown} placeholder="Сообщение..." className="flex-1 bg-muted rounded-full px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/30" disabled={sending} onFocus={() => setShowEmoji(false)} />
              {text.trim() ? (
                <button onClick={handleSend} disabled={sending} className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 disabled:opacity-40 shadow-md shadow-emerald-500/20">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
                </button>
              ) : settings.voiceEnabled ? (
                <button onClick={startRecording} disabled={sending} className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 disabled:opacity-40 shadow-md shadow-emerald-500/20">
                  <Mic className="w-4 h-4" />
                </button>
              ) : (
                <button onClick={handleSend} disabled={sending || !text.trim()} className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 disabled:opacity-40 shadow-md shadow-emerald-500/20">
                  <Send className="w-4 h-4 ml-0.5" />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {fullscreenImage && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center" onClick={() => setFullscreenImage(null)}>
          <button onClick={() => setFullscreenImage(null)} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
            <X className="w-5 h-5 text-white" />
          </button>
          <img src={fullscreenImage} alt="Full size" className="max-w-[95vw] max-h-[90vh] object-contain rounded-lg" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {callState.open && myUserId && (
        <VoiceCallModal
          open={callState.open}
          incoming={callState.incoming}
          peerName={callState.peerName}
          peerId={callState.peerId}
          myUserId={myUserId}
          myName="Вы"
          chatId={chat.id}
          chatType="group"
          wsRef={callWsRef}
          offer={callState.offer || null}
          onClose={() => setCallState({ open: false, incoming: false, peerId: 0, peerName: "" })}
        />
      )}
    </div>
  );
}

function GCVoicePlayer({ audioUrl, duration, isMine }: { audioUrl: string; duration: number; isMine: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const animRef = useRef<number>(0);

  const resolvedUrl = audioUrl.startsWith("/") ? `${BASE_URL}${audioUrl}` : audioUrl;

  const updateProgress = useCallback(() => {
    if (audioRef.current) {
      const dur = audioRef.current.duration || duration;
      setCurrentTime(audioRef.current.currentTime);
      setProgress(dur > 0 ? (audioRef.current.currentTime / dur) * 100 : 0);
    }
    if (playing) animRef.current = requestAnimationFrame(updateProgress);
  }, [playing, duration]);

  useEffect(() => {
    if (playing) animRef.current = requestAnimationFrame(updateProgress);
    return () => cancelAnimationFrame(animRef.current);
  }, [playing, updateProgress]);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play().catch(() => {}); setPlaying(true); }
  };

  const bars = 24;
  const barHeights = useRef(Array.from({ length: bars }, () => 0.2 + Math.random() * 0.8));

  return (
    <div className="flex items-center gap-2 min-w-[180px]">
      <audio ref={audioRef} src={resolvedUrl} preload="metadata" onEnded={() => { setPlaying(false); setProgress(0); setCurrentTime(0); }} />
      <button onClick={toggle} className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isMine ? "bg-foreground/20 text-white" : "bg-emerald-500 text-white"}`}>
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
      </button>
      <div className="flex-1 flex items-end gap-[2px] h-[28px]">
        {barHeights.current.map((h, i) => {
          const bp = (i / bars) * 100;
          const isActive = bp <= progress;
          return <div key={i} className={`w-[3px] rounded-full transition-colors duration-150 ${isMine ? isActive ? "bg-card" : "bg-foreground/30" : isActive ? "bg-emerald-500" : "bg-muted/90"}`} style={{ height: `${h * 28}px` }} />;
        })}
      </div>
      <span className={`text-[10px] tabular-nums min-w-[28px] ${isMine ? "text-white/60" : "text-muted-foreground/70"}`}>
        {playing ? formatDuration(currentTime) : formatDuration(duration)}
      </span>
    </div>
  );
}
