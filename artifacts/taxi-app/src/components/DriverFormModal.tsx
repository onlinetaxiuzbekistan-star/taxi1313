import React, { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  X, Loader2, Upload, Camera, Car, User, Settings2, Banknote,
  ChevronLeft, ChevronRight, Check, Plus, Trash2, Image,
} from "lucide-react";
import { toast } from "sonner";

const BASE_URL = import.meta.env.BASE_URL || "";

const BODY_TYPES = [
  { value: "sedan", label: "Седан" },
  { value: "hatchback", label: "Хэтчбек" },
  { value: "suv", label: "Внедорожник" },
  { value: "minivan", label: "Минивэн" },
  { value: "wagon", label: "Универсал" },
];

const CAR_COLORS = [
  "Белый", "Чёрный", "Серый", "Серебристый", "Синий", "Тёмно-синий",
  "Красный", "Бордовый", "Зелёный", "Бежевый", "Коричневый", "Золотистый",
  "Жёлтый", "Оранжевый", "Фиолетовый", "Голубой",
];

const CAR_YEARS = Array.from({ length: 27 }, (_, i) => 2026 - i);

const CAR_BRANDS_MODELS: Record<string, { models: string[]; defaultBody: string; defaultClass: string }> = {
  "Chevrolet": { models: ["Cobalt", "Lacetti", "Gentra", "Malibu", "Onix", "Tracker", "Equinox", "Captiva", "Spark", "Nexia 3", "Damas"], defaultBody: "sedan", defaultClass: "economy" },
  "Daewoo": { models: ["Matiz", "Nexia", "Gentra", "Lacetti"], defaultBody: "sedan", defaultClass: "economy" },
  "Hyundai": { models: ["Sonata", "Accent", "Elantra", "Tucson", "Santa Fe", "Creta", "Palisade"], defaultBody: "sedan", defaultClass: "comfort" },
  "Kia": { models: ["K5", "Cerato", "Sportage", "Sorento", "Seltos", "Carnival", "Rio"], defaultBody: "sedan", defaultClass: "comfort" },
  "Toyota": { models: ["Camry", "Corolla", "RAV4", "Land Cruiser", "Prado", "Hilux", "Fortuner"], defaultBody: "sedan", defaultClass: "comfort" },
  "Nissan": { models: ["Qashqai", "X-Trail", "Pathfinder", "Juke", "Sentra"], defaultBody: "suv", defaultClass: "comfort" },
  "BMW": { models: ["3 серии", "5 серии", "7 серии", "X3", "X5", "X7"], defaultBody: "sedan", defaultClass: "business" },
  "Mercedes-Benz": { models: ["C-Class", "E-Class", "S-Class", "GLC", "GLE", "GLS"], defaultBody: "sedan", defaultClass: "business" },
  "Audi": { models: ["A4", "A6", "A8", "Q3", "Q5", "Q7"], defaultBody: "sedan", defaultClass: "business" },
  "Volkswagen": { models: ["Polo", "Jetta", "Passat", "Tiguan", "Touareg"], defaultBody: "sedan", defaultClass: "comfort" },
  "Lada": { models: ["Vesta", "Granta", "Niva", "Largus"], defaultBody: "sedan", defaultClass: "economy" },
  "BYD": { models: ["Song Plus", "Han", "Tang", "Seal", "Dolphin", "Atto 3"], defaultBody: "suv", defaultClass: "comfort" },
  "Geely": { models: ["Coolray", "Atlas Pro", "Monjaro", "Emgrand"], defaultBody: "suv", defaultClass: "comfort" },
  "Changan": { models: ["CS35 Plus", "CS55 Plus", "CS75 Plus", "UNI-T", "UNI-K"], defaultBody: "suv", defaultClass: "comfort" },
  "Haval": { models: ["Jolion", "F7", "H6", "Dargo"], defaultBody: "suv", defaultClass: "comfort" },
  "Chery": { models: ["Tiggo 4 Pro", "Tiggo 7 Pro", "Tiggo 8 Pro", "Arrizo 6"], defaultBody: "suv", defaultClass: "comfort" },
  "MG": { models: ["ZS", "HS", "5", "RX8"], defaultBody: "suv", defaultClass: "comfort" },
};

const CAR_BRANDS = Object.keys(CAR_BRANDS_MODELS);

const CITIES = [
  "Ташкент", "Самарканд", "Бухара", "Фергана", "Андижан", "Наманган",
  "Нукус", "Карши", "Навои", "Термез", "Гулистан", "Джиззак", "Ургенч",
];

const CITY_PREFIX: Record<string, string> = {
  "Ташкент": "TAS", "Самарканд": "SAM", "Бухара": "BUX", "Фергана": "FER",
  "Андижан": "AND", "Наманган": "NAM", "Нукус": "NUK", "Карши": "KAR",
  "Навои": "NAV", "Термез": "TER", "Гулистан": "GUL", "Джиззак": "JIZ", "Ургенч": "URG",
};

const TABS = [
  { key: "personal", label: "Личные", icon: User },
  { key: "car", label: "Авто", icon: Car },
  { key: "photos", label: "Фото", icon: Camera },
  { key: "options", label: "Опции", icon: Settings2 },
  { key: "finance", label: "Финансы", icon: Banknote },
] as const;

type TabKey = typeof TABS[number]["key"];

export type DriverFormData = {
  firstName: string;
  lastName: string;
  phone: string;
  city: string;
  password: string;
  carBrand: string;
  carModel: string;
  carYear: string;
  carColor: string;
  carBodyType: string;
  carNumber: string;
  carClass: string;
  groupId: string;
  seats: string;
  driverPhoto: string;
  carPhoto: string;
  hasAC: boolean;
  hasLuggage: boolean;
  isComfort: boolean;
  customOptions: string[];
  balance: string;
  commissionRate: string;
  branchId: string;
};

const EMPTY_FORM: DriverFormData = {
  firstName: "", lastName: "", phone: "+998 ", city: "", password: "",
  carBrand: "", carModel: "", carYear: "", carColor: "", carBodyType: "sedan",
  carNumber: "", carClass: "economy", groupId: "", seats: "4",
  driverPhoto: "", carPhoto: "",
  hasAC: false, hasLuggage: false, isComfort: false, customOptions: [],
  balance: "0", commissionRate: "10", branchId: "",
};

function formatPhone998(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("998")) digits = digits;
  else if (digits.startsWith("8") && digits.length <= 10) digits = "998" + digits.slice(1);
  else if (!digits.startsWith("998")) digits = "998" + digits;
  digits = digits.slice(0, 12);

  let formatted = "+998";
  const rest = digits.slice(3);
  if (rest.length > 0) formatted += " " + rest.slice(0, 2);
  if (rest.length > 2) formatted += " " + rest.slice(2, 5);
  if (rest.length > 5) formatted += " " + rest.slice(5, 7);
  if (rest.length > 7) formatted += " " + rest.slice(7, 9);
  return formatted;
}

function phoneToSubmit(formatted: string): string {
  const digits = formatted.replace(/\D/g, "");
  return "+" + digits;
}

type Props = {
  onClose: () => void;
  onSaved: () => void;
  token: string | null;
  editDriver?: any;
  panelMode?: boolean;
};

export default function DriverFormModal({ onClose, onSaved, token, editDriver, panelMode }: Props) {
  const isEdit = !!editDriver;

  const [form, setForm] = useState<DriverFormData>(() => {
    if (!editDriver) return { ...EMPTY_FORM };
    const rawPhone = editDriver.phone || "";
    return {
      firstName: editDriver.firstName || editDriver.name?.split(" ")[0] || "",
      lastName: editDriver.lastName || editDriver.name?.split(" ").slice(1).join(" ") || "",
      phone: rawPhone ? formatPhone998(rawPhone) : "+998 ",
      city: editDriver.city || "",
      password: "",
      carBrand: editDriver.carBrand || "",
      carModel: editDriver.carModel || "",
      carYear: editDriver.carYear ? String(editDriver.carYear) : "",
      carColor: editDriver.carColor || "",
      carBodyType: editDriver.carBodyType || "sedan",
      carNumber: editDriver.carNumber || "",
      carClass: editDriver.carClass || "economy",
      groupId: editDriver.groupId ? String(editDriver.groupId) : "",
      seats: editDriver.seats ? String(editDriver.seats) : "4",
      driverPhoto: editDriver.driverPhoto || "",
      carPhoto: editDriver.carPhoto || "",
      hasAC: editDriver.hasAC || false,
      hasLuggage: editDriver.hasLuggage || false,
      isComfort: editDriver.isComfort || false,
      customOptions: (editDriver.customOptions as string[]) || [],
      balance: editDriver.balance ? String(parseFloat(editDriver.balance)) : "0",
      commissionRate: editDriver.commissionRate ? String(editDriver.commissionRate) : "10",
      branchId: editDriver.branchId ? String(editDriver.branchId) : "",
    };
  });

  const [tab, setTab] = useState<TabKey>("personal");
  const [saving, setSaving] = useState(false);
  const [uploadingDriver, setUploadingDriver] = useState(false);
  const [uploadingCar, setUploadingCar] = useState(false);
  const [newOption, setNewOption] = useState("");
  const [driverGroups, setDriverGroups] = useState<{ id: number; name: string; label: string; level: number }[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string; isActive: boolean }[]>([]);

  useEffect(() => {
    fetch(`${BASE_URL}api/branches`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.json())
      .then(d => { if (d.branches) setBranches(d.branches); })
      .catch(() => {});
    fetch(`${BASE_URL}api/driver-groups`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.json())
      .then(d => { if (d.groups) setDriverGroups(d.groups); })
      .catch(() => {});
  }, [token]);

  const set = useCallback((key: keyof DriverFormData, value: any) => {
    setForm(f => ({ ...f, [key]: value }));
  }, []);

  const handleBrandChange = useCallback((brand: string) => {
    setForm(f => {
      const info = CAR_BRANDS_MODELS[brand];
      if (!info) return { ...f, carBrand: brand };
      return {
        ...f,
        carBrand: brand,
        carModel: "",
        carBodyType: info.defaultBody,
        carClass: info.defaultClass,
        isComfort: info.defaultClass === "comfort" || info.defaultClass === "business",
      };
    });
  }, []);

  const uploadPhoto = async (file: File, type: "driver" | "car") => {
    const setUploading = type === "driver" ? setUploadingDriver : setUploadingCar;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const resp = await fetch(`${BASE_URL}api/drivers/admin/upload-photo`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!resp.ok) throw new Error("upload failed");
      const { url } = await resp.json();
      set(type === "driver" ? "driverPhoto" : "carPhoto", url);
      toast.success("Фото загружено");
    } catch {
      toast.error("Ошибка загрузки фото");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error("Заполните имя и фамилию");
      setTab("personal");
      return;
    }
    const phoneDigits = form.phone.replace(/\D/g, "");
    if (phoneDigits.length < 12) {
      toast.error("Введите полный номер (+998 XX XXX XX XX)");
      setTab("personal");
      return;
    }
    setSaving(true);
    try {
      const url = isEdit
        ? `${BASE_URL}api/drivers/admin/${editDriver.id}`
        : `${BASE_URL}api/drivers/admin/create`;
      const method = isEdit ? "PATCH" : "POST";

      const body: any = { ...form, phone: phoneToSubmit(form.phone) };
      body.branchId = form.branchId ? parseInt(form.branchId) : null;
      body.customOptions = form.customOptions.length > 0 ? form.customOptions : null;
      if (isEdit && !form.password) delete body.password;

      const resp = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => null);
        throw new Error(err?.message || "Ошибка сохранения");
      }

      toast.success(isEdit ? "Водитель обновлён" : "Водитель создан");
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const tabIdx = TABS.findIndex(t => t.key === tab);
  const canPrev = tabIdx > 0;
  const canNext = tabIdx < TABS.length - 1;

  const cityPfx = form.city ? (CITY_PREFIX[form.city] || "BT") : "BT";
  const callsign = isEdit ? `${cityPfx}-${String(editDriver.id).padStart(3, "0")}` : `${cityPfx}-***`;

  const formContent = (
    <>
      <div className={`flex overflow-x-auto scrollbar-none border-b border-zinc-200 px-3`}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3.5 py-3 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
              tab === t.key
                ? "border-emerald-500 text-zinc-900"
                : "border-transparent text-zinc-400 hover:text-zinc-700"
            }`}>
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === "personal" && (
          <PersonalTab form={form} set={set} callsign={callsign} isEdit={isEdit} branches={branches} />
        )}
        {tab === "car" && (
          <CarTab form={form} set={set} onBrandChange={handleBrandChange} driverGroups={driverGroups} />
        )}
        {tab === "photos" && (
          <PhotosTab
            form={form}
            uploadPhoto={uploadPhoto}
            uploadingDriver={uploadingDriver}
            uploadingCar={uploadingCar}
            set={set}
          />
        )}
        {tab === "options" && (
          <OptionsTab form={form} set={set} newOption={newOption} setNewOption={setNewOption} />
        )}
        {tab === "finance" && (
          <FinanceTab form={form} set={set} token={token} driverId={editDriver?.id} onBalanceUpdated={onSaved} />
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-zinc-200 bg-zinc-50 shrink-0">
        <div className="flex gap-2">
          {canPrev && (
            <button onClick={() => setTab(TABS[tabIdx - 1].key)}
              className="flex items-center gap-1 text-sm font-semibold px-3 py-2 rounded-xl text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200 transition-colors">
              <ChevronLeft className="w-4 h-4" />{TABS[tabIdx - 1].label}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {canNext && (
            <button onClick={() => setTab(TABS[tabIdx + 1].key)}
              className="flex items-center gap-1 text-sm font-semibold px-3 py-2 rounded-xl text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200 transition-colors">
              {TABS[tabIdx + 1].label}<ChevronRight className="w-4 h-4" />
            </button>
          )}
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2.5 rounded-xl text-base font-bold disabled:opacity-60 transition-colors shadow-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {isEdit ? "Сохранить" : "Создать"}
          </button>
        </div>
      </div>
    </>
  );

  if (panelMode) {
    return (
      <ThemeCtx.Provider value={true}>
        <div className="flex flex-col flex-1 overflow-hidden bg-white text-zinc-900">{formContent}</div>
      </ThemeCtx.Provider>
    );
  }

  return (
    <ThemeCtx.Provider value={true}>
    <div className="fixed inset-0 bg-black/40 z-[85] flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl max-h-[92vh] overflow-hidden flex flex-col border border-zinc-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <div>
            <h3 className="font-extrabold text-zinc-900 text-lg">
              {isEdit ? "Редактирование водителя" : "Новый водитель"}
            </h3>
            <p className="text-sm text-zinc-500 mt-0.5">
              {isEdit ? `${callsign} • ${editDriver.name}` : "Заполните данные по вкладкам"}
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900 p-2 rounded-xl hover:bg-zinc-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        {formContent}
      </div>
    </div>
    </ThemeCtx.Provider>
  );
}

const ThemeCtx = React.createContext(false);

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="text-sm font-bold mb-1.5 block text-zinc-700">
      {children}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

function Input({ value, onChange, placeholder, type, ...rest }: any) {
  return (
    <input value={value} onChange={onChange} placeholder={placeholder} type={type || "text"}
      className="w-full border border-zinc-300 bg-zinc-50 rounded-xl px-4 py-3 text-base font-semibold text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-colors"
      {...rest} />
  );
}

function Select({ value, onChange, children }: any) {
  return (
    <select value={value} onChange={onChange}
      className="w-full border border-zinc-300 bg-zinc-50 rounded-xl px-4 py-3 text-base font-semibold text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-colors">
      {children}
    </select>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between py-3 cursor-pointer group">
      <span className="text-base font-medium text-zinc-700">{label}</span>
      <button type="button" onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors ${checked ? "bg-emerald-500" : "bg-zinc-300"}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
          checked ? "left-[22px]" : "left-0.5"
        }`} />
      </button>
    </label>
  );
}

function PersonalTab({ form, set, callsign, isEdit, branches }: { form: DriverFormData; set: (k: keyof DriverFormData, v: any) => void; callsign: string; isEdit: boolean; branches: { id: number; name: string; isActive: boolean }[] }) {
  const handlePhoneInput = (raw: string) => {
    if (raw.length < 4) { set("phone", "+998 "); return; }
    set("phone", formatPhone998(raw));
  };

  const phoneDigits = form.phone.replace(/\D/g, "");
  const phoneValid = phoneDigits.length === 12;
  const phoneStarted = phoneDigits.length > 3;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl px-4 py-3 bg-zinc-100">
        <span className="text-sm font-semibold text-zinc-500">Позывной:</span>
        <span className="text-base font-mono font-bold text-zinc-900">{callsign}</span>
        <span className="text-xs ml-auto text-zinc-400">Зависит от города</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label required>Имя</Label>
          <Input value={form.firstName} onChange={(e: any) => set("firstName", e.target.value)} placeholder="Бобур" />
        </div>
        <div>
          <Label required>Фамилия</Label>
          <Input value={form.lastName} onChange={(e: any) => set("lastName", e.target.value)} placeholder="Каримов" />
        </div>
      </div>

      <div>
        <Label required>Телефон</Label>
        <div className="relative">
          <input value={form.phone} onChange={(e: any) => handlePhoneInput(e.target.value)}
            placeholder="+998 90 123 45 67"
            className={`w-full border rounded-xl px-4 py-3.5 text-xl font-extrabold font-mono text-zinc-900 bg-zinc-50 placeholder:text-zinc-400 placeholder:font-normal outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-colors tracking-wide ${phoneStarted && !phoneValid ? "border-amber-500" : "border-zinc-300"}`} />
          {phoneStarted && (
            <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold ${phoneValid ? "text-emerald-500" : "text-amber-500"}`}>
              {phoneValid ? "✓" : `${phoneDigits.length}/12`}
            </span>
          )}
        </div>
      </div>

      <div>
        <Label>Город</Label>
        <Select value={form.city} onChange={(e: any) => set("city", e.target.value)}>
          <option value="">Выберите город</option>
          {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>

      <div>
        <Label>Филиал</Label>
        <Select value={form.branchId} onChange={(e: any) => set("branchId", e.target.value)}>
          <option value="">Без привязки</option>
          {branches.filter(b => b.isActive).map(b => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
        </Select>
        <p className="text-[10px] text-zinc-400 mt-1">К какому филиалу относится водитель</p>
      </div>
    </div>
  );
}

function CarTab({ form, set, onBrandChange, driverGroups }: { form: DriverFormData; set: (k: keyof DriverFormData, v: any) => void; onBrandChange: (brand: string) => void; driverGroups: { id: number; name: string; label: string; level: number }[] }) {
  const brandInfo = CAR_BRANDS_MODELS[form.carBrand];
  const modelOptions = brandInfo?.models || [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Марка</Label>
          <Select value={form.carBrand} onChange={(e: any) => onBrandChange(e.target.value)}>
            <option value="">Выберите марку</option>
            {CAR_BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
          </Select>
        </div>
        <div>
          <Label>Модель</Label>
          {modelOptions.length > 0 ? (
            <Select value={form.carModel} onChange={(e: any) => set("carModel", e.target.value)}>
              <option value="">Выберите модель</option>
              {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </Select>
          ) : (
            <Input value={form.carModel} onChange={(e: any) => set("carModel", e.target.value)} placeholder="Модель авто" />
          )}
        </div>
      </div>

      {brandInfo && (
        <p className="text-[10px] text-emerald-600 bg-emerald-500/5 px-3 py-1.5 rounded-lg">
          Авто-заполнено: {BODY_TYPES.find(b => b.value === form.carBodyType)?.label}, {form.carClass === "economy" ? "Эконом" : form.carClass === "comfort" ? "Комфорт" : "Бизнес"}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Год выпуска</Label>
          <Select value={form.carYear} onChange={(e: any) => set("carYear", e.target.value)}>
            <option value="">Выберите год</option>
            {CAR_YEARS.map(y => <option key={y} value={String(y)}>{y}</option>)}
          </Select>
        </div>
        <div>
          <Label>Цвет</Label>
          <Select value={form.carColor} onChange={(e: any) => set("carColor", e.target.value)}>
            <option value="">Выберите цвет</option>
            {CAR_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Кузов</Label>
          <Select value={form.carBodyType} onChange={(e: any) => set("carBodyType", e.target.value)}>
            {BODY_TYPES.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
          </Select>
        </div>
        <div>
          <Label>Класс</Label>
          <Select value={form.carClass} onChange={(e: any) => set("carClass", e.target.value)}>
            <option value="economy">Эконом</option>
            <option value="comfort">Комфорт</option>
            <option value="business">Бизнес</option>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Группа водителя</Label>
          <Select value={form.groupId} onChange={(e: any) => set("groupId", e.target.value)}>
            <option value="">Не назначена</option>
            {driverGroups.map(g => <option key={g.id} value={String(g.id)}>{g.label} (ур. {g.level})</option>)}
          </Select>
        </div>
        <div>
          <Label>Гос. номер</Label>
          <input value={form.carNumber} onChange={(e: any) => set("carNumber", e.target.value.toUpperCase())}
            placeholder="01 A 123 BB"
            className="w-full border border-zinc-300 bg-zinc-50 rounded-xl px-4 py-3.5 text-xl font-extrabold font-mono text-zinc-900 placeholder:text-zinc-400 placeholder:font-normal outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-colors tracking-widest uppercase" />
        </div>
        <div>
          <Label>Кол-во мест</Label>
          <Select value={form.seats} onChange={(e: any) => set("seats", e.target.value)}>
            {[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n} value={String(n)}>{n}</option>)}
          </Select>
        </div>
      </div>
    </div>
  );
}

function PhotoUploadBox({
  label, photoUrl, uploading, onUpload, onClear,
}: {
  label: string; photoUrl: string; uploading: boolean;
  onUpload: (file: File) => void; onClear: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2">
      <p className="text-sm font-bold text-zinc-700">{label}</p>
      {photoUrl ? (
        <div className="relative rounded-xl overflow-hidden border aspect-video border-zinc-200 bg-zinc-100">
          <img src={photoUrl.startsWith("http") ? photoUrl : `${BASE_URL}${photoUrl.startsWith("/") ? photoUrl.slice(1) : photoUrl}`} alt={label}
            className="w-full h-full object-cover" />
          <div className="absolute top-2 right-2 flex gap-1">
            <button onClick={() => ref.current?.click()}
              className="bg-black/60 text-white p-1.5 rounded-lg hover:bg-black/80 transition-colors">
              <Upload className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClear}
              className="bg-black/60 text-white p-1.5 rounded-lg hover:bg-red-500/80 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => ref.current?.click()}
          className="w-full aspect-video rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-colors cursor-pointer border-zinc-300 hover:border-emerald-500/50 bg-zinc-50">
          {uploading ? (
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
          ) : (
            <>
              <Upload className="w-6 h-6 text-zinc-400" />
              <span className="text-sm text-zinc-500">Нажмите для загрузки</span>
              <span className="text-xs text-zinc-400">JPG, PNG до 5 МБ</span>
            </>
          )}
        </button>
      )}
      <input ref={ref} type="file" accept="image/*" className="hidden"
        onChange={e => { if (e.target.files?.[0]) onUpload(e.target.files[0]); e.target.value = ""; }} />
    </div>
  );
}

function PhotosTab({
  form, uploadPhoto, uploadingDriver, uploadingCar, set,
}: {
  form: DriverFormData;
  uploadPhoto: (file: File, type: "driver" | "car") => void;
  uploadingDriver: boolean; uploadingCar: boolean;
  set: (k: keyof DriverFormData, v: any) => void;
}) {
  return (
    <div className="space-y-5">
      <PhotoUploadBox
        label="Фото водителя"
        photoUrl={form.driverPhoto}
        uploading={uploadingDriver}
        onUpload={f => uploadPhoto(f, "driver")}
        onClear={() => set("driverPhoto", "")}
      />
      <PhotoUploadBox
        label="Фото автомобиля"
        photoUrl={form.carPhoto}
        uploading={uploadingCar}
        onUpload={f => uploadPhoto(f, "car")}
        onClear={() => set("carPhoto", "")}
      />
    </div>
  );
}

function OptionsTab({
  form, set, newOption, setNewOption,
}: {
  form: DriverFormData;
  set: (k: keyof DriverFormData, v: any) => void;
  newOption: string;
  setNewOption: (v: string) => void;
}) {
  const addOption = () => {
    const trimmed = newOption.trim();
    if (!trimmed) return;
    if (form.customOptions.includes(trimmed)) return;
    set("customOptions", [...form.customOptions, trimmed]);
    setNewOption("");
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1 divide-y divide-zinc-200 dark:divide-zinc-800/50">
        <Toggle label="Кондиционер" checked={form.hasAC} onChange={v => set("hasAC", v)} />
        <Toggle label="Багажное место" checked={form.hasLuggage} onChange={v => set("hasLuggage", v)} />
        <Toggle label="Комфорт-класс" checked={form.isComfort} onChange={v => set("isComfort", v)} />
      </div>

      <div>
        <Label>Дополнительные опции</Label>
        <div className="flex gap-2 mb-2">
          <Input value={newOption} onChange={(e: any) => setNewOption(e.target.value)}
            placeholder="Детское кресло, Wi-Fi..."
            onKeyDown={(e: any) => { if (e.key === "Enter") { e.preventDefault(); addOption(); } }} />
          <button onClick={addOption} disabled={!newOption.trim()}
            className="px-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg disabled:opacity-40 transition-colors shrink-0">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {form.customOptions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {form.customOptions.map((opt, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800/50 dark:text-zinc-300 dark:border-zinc-700/50">
                {opt}
                <button onClick={() => set("customOptions", form.customOptions.filter((_, j) => j !== i))}
                  className="text-zinc-500 hover:text-red-500 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const TX_TYPE_LABELS: Record<string, { label: string; color: string; sign: string }> = {
  income: { label: "Доход", color: "text-emerald-600", sign: "+" },
  bonus: { label: "Бонус", color: "text-emerald-600", sign: "+" },
  commission: { label: "Комиссия", color: "text-red-600", sign: "−" },
  penalty: { label: "Штраф", color: "text-red-600", sign: "−" },
  withdraw: { label: "Вывод", color: "text-zinc-600", sign: "−" },
  refund: { label: "Возврат", color: "text-zinc-600", sign: "+" },
  adjust: { label: "Корректировка", color: "text-zinc-600", sign: "" },
};

function groupByDate(txs: any[]): { date: string; items: any[] }[] {
  const groups: Record<string, any[]> = {};
  txs.forEach(tx => {
    const d = new Date(tx.createdAt);
    const key = d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
    if (!groups[key]) groups[key] = [];
    groups[key].push(tx);
  });
  return Object.entries(groups).map(([date, items]) => ({ date, items }));
}

function FinanceTab({ form, set, token, driverId, onBalanceUpdated }: {
  form: DriverFormData; set: (k: keyof DriverFormData, v: any) => void;
  token?: string | null; driverId?: number; onBalanceUpdated?: () => void;
}) {
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustComment, setAdjustComment] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const isEdit = !!driverId;
  const bal = parseFloat(form.balance || "0");
  const fmt = (n: number) => n.toLocaleString("ru-RU");

  useEffect(() => {
    if (!isEdit || !token || !driverId) return;
    setTxLoading(true);
    fetch(`${BASE_URL}api/drivers/${driverId}/finance`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => {
        if (d.transactions) setTransactions(d.transactions);
        if (d.balance !== undefined) set("balance", String(d.balance));
      })
      .catch(() => {})
      .finally(() => setTxLoading(false));
  }, [isEdit, token, driverId]);

  const handleAdjust = async (isTopup: boolean) => {
    if (!token || !driverId) return;
    const num = parseFloat(adjustAmount);
    if (!num || num <= 0) { toast.error("Укажите сумму больше 0"); return; }
    if (!adjustComment.trim() || adjustComment.trim().length < 2) { toast.error("Укажите комментарий"); return; }
    if (!isTopup && !window.confirm(`Списать ${fmt(num)} сум с баланса?\nКомментарий: ${adjustComment.trim()}`)) return;
    setAdjusting(true);
    try {
      const resp = await fetch(`${BASE_URL}api/drivers/${driverId}/finance/adjust`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: isTopup ? num : -num, reason: adjustComment.trim() }),
      });
      const text = await resp.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch {}
      if (!resp.ok) throw new Error(data.message || `Ошибка (${resp.status})`);
      toast.success(isTopup ? `Пополнено на ${fmt(num)} сум` : `Списано ${fmt(num)} сум`);
      set("balance", String(data.newBalance ?? (bal + (isTopup ? num : -num))));
      setAdjustAmount(""); setAdjustComment("");
      onBalanceUpdated?.();
      fetch(`${BASE_URL}api/drivers/${driverId}/finance`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json()).then(d => { if (d.transactions) setTransactions(d.transactions); }).catch(() => {});
    } catch (e: any) { toast.error(e.message || "Ошибка"); } finally { setAdjusting(false); }
  };

  const grouped = useMemo(() => groupByDate(transactions), [transactions]);

  return (
    <div className="space-y-5">
      {isEdit && (
        <div className={`rounded-xl p-5 ${bal >= 0 ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 border border-red-200"}`}>
          <span className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Текущий баланс</span>
          <p className={`text-3xl font-extrabold tracking-tight mt-1 ${bal >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {fmt(bal)} <span className="text-sm font-medium text-zinc-400">сум</span>
          </p>
        </div>
      )}

      {isEdit && (
        <div className="rounded-xl border border-zinc-200 p-5 space-y-3">
          <p className="text-sm font-extrabold text-zinc-700">Пополнение / Списание</p>
          <div>
            <Label>Сумма</Label>
            <Input value={adjustAmount} onChange={(e: any) => setAdjustAmount(e.target.value)}
              placeholder="Введите сумму" type="number" min="1" />
          </div>
          <div>
            <Label>Комментарий</Label>
            <textarea value={adjustComment} onChange={(e: any) => setAdjustComment(e.target.value)}
              placeholder="Причина изменения баланса" rows={2}
              className="w-full border border-zinc-300 bg-zinc-50 rounded-xl px-4 py-3 text-base font-semibold text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-colors resize-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => handleAdjust(true)} disabled={adjusting}
              className="flex-1 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm">
              {adjusting ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "+ Пополнить"}
            </button>
            <button onClick={() => handleAdjust(false)} disabled={adjusting}
              className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm">
              {adjusting ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "− Списать"}
            </button>
          </div>
        </div>
      )}

      {isEdit && (
        <div className="rounded-xl border border-zinc-200 overflow-hidden">
          <div className="px-5 py-3 bg-zinc-50 border-b border-zinc-200">
            <p className="text-sm font-extrabold text-zinc-700">История операций</p>
          </div>
          {txLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>
          ) : transactions.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-400">Нет операций</div>
          ) : (
            <div className="max-h-[300px] overflow-y-auto">
              {grouped.map(group => (
                <div key={group.date}>
                  <div className="px-5 py-2 bg-zinc-50/80 border-b border-zinc-100 sticky top-0">
                    <span className="text-xs font-bold text-zinc-400 uppercase">{group.date}</span>
                  </div>
                  {group.items.map((tx: any) => {
                    const info = TX_TYPE_LABELS[tx.type] || { label: tx.type, color: "text-zinc-600", sign: "" };
                    const amount = parseFloat(tx.amount || "0");
                    const isPositive = ["income", "bonus", "refund"].includes(tx.type);
                    const time = new Date(tx.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
                    return (
                      <div key={tx.id} className="px-5 py-3 border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50/50">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-bold ${info.color}`}>{info.label}</span>
                              <span className="text-xs text-zinc-400">{time}</span>
                            </div>
                            {tx.description && (
                              <p className="text-xs text-zinc-500 mt-0.5 truncate">{tx.description}</p>
                            )}
                          </div>
                          <span className={`text-base font-extrabold tabular-nums ${isPositive ? "text-emerald-600" : "text-red-600"}`}>
                            {isPositive ? "+" : "−"}{fmt(amount)} сум
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 p-5 space-y-4">
        <p className="text-sm font-extrabold text-zinc-700">{isEdit ? "Настройки" : "Стартовые настройки"}</p>
        {!isEdit && (
          <div>
            <Label>Стартовый баланс (сум)</Label>
            <Input value={form.balance} onChange={(e: any) => set("balance", e.target.value)}
              placeholder="0" type="number" />
            <p className="text-xs mt-1 text-zinc-400">Начальный баланс счёта водителя</p>
          </div>
        )}
        <div>
          <Label>Комиссия (%)</Label>
          <Input value={form.commissionRate} onChange={(e: any) => set("commissionRate", e.target.value)}
            placeholder="10" type="number" min="0" max="100" />
          <p className="text-xs mt-1 text-zinc-400">Процент комиссии с каждой поездки</p>
        </div>
      </div>
    </div>
  );
}
