# BUG REPORT: Завершённые рейсы со статусом `merged` висят на «эфире» диспетчера как «Новый»

**Дата:** 21 апреля 2026
**Прод:** `nil.taxi1313.ru` (VPS 62.113.58.155)
**Артефакт:** `taxi-app` (Vite + React, диспетчерская)
**Серьёзность:** P2 (UX-баг, данных не теряет, но забивает рабочий список диспетчера)
**Кому отдать:** Cursor / DC для проверки фикса перед деплоем

---

## 1. Симптом

В вкладке **«Заказы»** диспетчера висят 4 заказа от **20 апреля 2026** (вчерашние):

| Время поездки | Маршрут | Клиент | Цена | Водитель | Статус в UI |
|---|---|---|---|---|---|
| 23:48 | Фергана → Ташкент 300 км | Мужчина +998905365555 | 220 000 | Давлат Низомов (Lacetti) | **«Новый»** (жёлтый бейдж) |
| 23:45 | Фергана → Ташкент 300 км | Женщина +998905365555 | 630 000 | Давлат Низомов (Lacetti) | **«Новый»** |
| 22:46 | Фергана → Ташкент 300 км | Женщина +998937311111 | 140 000 | Давлат Низомов (Lacetti) | **«Новый»** |
| 22:46 | Фергана → Ташкент 300 км | Мужчина +998941375454 | 500 000 | Давлат Низомов (Lacetti) | **«Новый»** |

Фильтр над списком: «4 Все», «0 Новые», «0 В пути», «0 Ожидают», «0 Срочные» → но в самом списке **4 заказа со статусом «Новый»**. Сегодня 21 апреля, эти заказы должны быть в архиве.

---

## 2. Реальное состояние в БД (`rides` table)

```sql
SELECT id, status, scheduled_at, driver_id, driver_name, rider_phone, price
FROM rides
WHERE scheduled_at >= '2026-04-20 00:00:00'
  AND scheduled_at <  '2026-04-21 00:00:00'
  AND from_city ILIKE '%ергана%';
```

| id | status   | sched (Asia/Tashkent) | driver | clinet           | price  |
|----|----------|-----------------------|--------|------------------|--------|
| 53 | **merged** | 20 23:48              | 4 Давлат | +998905365555    | 220 000 |
| 51 | **merged** | 20 23:45              | 4 Давлат | +998905365555    | 630 000 |
| 48 | **merged** | 20 22:46              | 4 Давлат | +998937311111    | 140 000 |
| 47 | **merged** | 20 22:46              | 4 Давлат | +998941375454    | 500 000 |
| 39 | merged   | 20 22:00              | 9 Axadxon | +998905365555  | 600 000 |
| 38 | merged   | 20 22:00              | 9 Axadxon | +998937311111  | 140 000 |
| 41 | cancelled | 20 22:00             | 9 Axadxon | +998905365555  | 605 000 |
| 36, 35 | cancelled | … | … | … | … |
| 21..33 | completed (8 шт) | … | 4 Давлат | … | … |

**Итог за 20 апреля:** 24 `completed`, 6 `merged`, 3 `cancelled`. Зависших `pending` = **0**. То есть данные в БД корректны — баг чисто на фронте.

**Enum `ride_status`:**
```
pending | offered | accepted | in_progress | completed | cancelled | merged
```

---

## 3. Корень бага

Файл: **`artifacts/taxi-app/src/pages/dispatcher/Orders.tsx`** (1307 строк, диспетчерская страница «Заказы»).

### 3.1 STATUS_MAP не знает `merged` (строки 16–23)

```tsx
const STATUS_MAP: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
  pending:     { label: "Новый",     ... },
  offered:     { label: "Предложен", ... },
  accepted:    { label: "Принят",    ... },
  in_progress: { label: "В пути",    ... },
  completed:   { label: "Завершён",  ... },
  cancelled:   { label: "Отменён",   ... },
  // ❌ НЕТ записи для 'merged'
};
```

И в местах рендера (строки 283 и 510):
```tsx
const st = STATUS_MAP[ride.status] || STATUS_MAP.pending;
//                                    ^^^^^^^^^^^^^^^^^^^
//   Когда ride.status === 'merged' → fallback на pending → бейдж «Новый» жёлтый
```

### 3.2 Фильтр «активных» рейсов не исключает `merged` (строка 759)

```tsx
const activeRides = useMemo(
  () => allRides.filter((r: any) => r.status !== "completed" && r.status !== "cancelled"),
  [allRides]
);
// ❌ merged считается активным → попадает в эфир
```

### 3.3 Признак активности карточки (строка 285)

```tsx
const isActive = !["completed", "cancelled"].includes(ride.status);
// ❌ merged считается активным
```

### 3.4 Аналогично в строках 721, 726 (вторичные фильтры)

```tsx
// 721 — общий список (тут оставить можно — нужно в архиве/счётчиках):
return (ridesData?.rides || []).filter((r: any) => r.status !== "cancelled");

// 726 — рейсы текущего звонящего водителя:
const driverRides = (allRides || []).filter(
  (r: any) => r.driverId === callingDriverId && r.status !== "completed" && r.status !== "cancelled"
);
```

---

## 4. Предлагаемый фикс (минимальный, безопасный)

### Шаг 1 — добавить запись в `STATUS_MAP` (строка 22, после `cancelled`)

```tsx
  cancelled:   { label: "Отменён",   color: "text-rose-700",    bg: "bg-rose-100",    border: "border-rose-300", dot: "bg-rose-500" },
+ merged:      { label: "Объединён", color: "text-violet-700",  bg: "bg-violet-100",  border: "border-violet-300", dot: "bg-violet-500" },
};
```

### Шаг 2 — добавить общую константу терминальных статусов (вверху файла, после STATUS_MAP)

```tsx
const TERMINAL_STATUSES = ["completed", "cancelled", "merged"] as const;
```

### Шаг 3 — заменить три проверки на использование константы

**Строка 285** (внутри карточки `<RideDetailsCard>`):
```diff
- const isActive = !["completed", "cancelled"].includes(ride.status);
+ const isActive = !TERMINAL_STATUSES.includes(ride.status as any);
```

**Строка 759** (главный фильтр эфира):
```diff
- const activeRides = useMemo(() => allRides.filter((r: any) => r.status !== "completed" && r.status !== "cancelled"), [allRides]);
+ const activeRides = useMemo(() => allRides.filter((r: any) => !TERMINAL_STATUSES.includes(r.status)), [allRides]);
```

**Строка 726** (рейсы звонящего водителя):
```diff
- const driverRides = (allRides || []).filter((r: any) => r.driverId === callingDriverId && r.status !== "completed" && r.status !== "cancelled");
+ const driverRides = (allRides || []).filter((r: any) => r.driverId === callingDriverId && !TERMINAL_STATUSES.includes(r.status));
```

### Что НЕ трогать

- Строку 721 (`r.status !== "cancelled"`) — это общий массив `allRides`, оттуда берутся данные для разных подсчётов и архивных представлений; пусть `merged` остаётся в массиве, фильтр эфира его уже отрежет.
- Файл `Archive.tsx` — Архив тянет рейсы отдельным запросом (`status IN (completed, cancelled, merged)` — нужно проверить, что merged там виден; если нет — отдельный мини-фикс в Archive).
- Schema БД, миграции — **не нужны вообще**. Enum `merged` уже существует.

---

## 5. Открытые вопросы (нужны ответы перед деплоем)

1. **Семантика `merged`:** статус терминальный (как `completed`)? Может ли поездка вернуться обратно в `pending`/`offered`? Нужно подтверждение от того, кто реализовывал объединение поездок.
   - Если терминальный → фикс выше правильный.
   - Если не терминальный → нужно вместо «убрать из эфира» сделать «показывать как `Объединён, ожидает старта`» с другим бейджем.

2. **Архив:** виден ли там `merged` сейчас? Проверить `Archive.tsx` и API-эндпоинт архива (`GET /api/rides?status=...`).

3. **Источник статуса `merged`:** какой код выставляет этот статус? Найти `UPDATE rides SET status = 'merged'` в `api-server` (вероятно в `routes/rides.ts` или `routes/trips.ts` — место, где диспетчер объединяет 4 пассажиров в один междугородний рейс через `trip_id`).
   - Это важно, чтобы убедиться, что нет случая «merged по ошибке», когда поездка ещё в работе.

4. **Лейбл «Объединён» подходит лингвистически?** Альтернативы: «В рейсе» / «Сцеплён» / «Объединён в рейс №X» (показывать `trip_id` рядом).

5. **Driver-app side:** в приложении водителя (страницы `pages/driver/`) тот же fallback есть? Грепнуть `STATUS_MAP\|status === "completed"` по `pages/driver/`. Если есть — там же поправить.

---

## 6. Команды деплоя (после применения фикса)

На VPS `62.113.58.155`:

```bash
cd /opt/taxi1313

# 1. Backup перед изменением
cp artifacts/taxi-app/src/pages/dispatcher/Orders.tsx \
   artifacts/taxi-app/src/pages/dispatcher/Orders.tsx.bak.merged_fix.$(date +%s)

# 2. Применить правки (через patch / вручную в редакторе)
# ... (см. раздел 4)

# 3. Линт + типы
pnpm --filter @workspace/taxi-app exec tsc --noEmit 2>&1 | tail -20

# 4. Сборка
pnpm --filter @workspace/taxi-app run build
# → новый dist/ создаётся атомарно, старый продолжает работать

# 5. Релоад nginx (обычно не нужен — отдаёт статику из dist/, обновится автоматически
#    с cache-busting по hash в filename)
# Проверь: ls -la artifacts/taxi-app/dist/assets/ | head -3
sudo nginx -t && sudo systemctl reload nginx

# 6. Smoke-тест
curl -sI https://nil.taxi1313.ru/dispatcher/orders | head -3
# Открыть в браузере, перезайти диспетчером, обновить страницу (Ctrl+Shift+R) →
# 4 «зависших» рейса должны исчезнуть из эфира; в Архиве появиться с лейблом «Объединён»
```

**Откат при проблемах:**
```bash
mv artifacts/taxi-app/src/pages/dispatcher/Orders.tsx.bak.merged_fix.* \
   artifacts/taxi-app/src/pages/dispatcher/Orders.tsx
pnpm --filter @workspace/taxi-app run build
```

---

## 7. Риски

| Риск | Оценка | Митигация |
|---|---|---|
| Сломать активные `pending`/`accepted`/`in_progress` рейсы | низкий — правка только добавляет статус в исключения | smoke-тест в браузере после деплоя |
| `merged` пропадает и из Архива тоже | возможен — зависит от логики `Archive.tsx` | проверить Архив отдельно после фикса; если нужно — мини-правка там |
| TypeScript ругнётся на `as any` в `TERMINAL_STATUSES.includes(...)` | мелкий | можно типизировать через `(TERMINAL_STATUSES as readonly string[]).includes(r.status)` |
| Пересборка taxi-app сломается | низкий — изменения изолированные | tsc --noEmit перед build |
| Nginx закеширует старый bundle | низкий — Vite ставит hash в имя файла | при необходимости `Ctrl+Shift+R` или сбросить CDN/cloudflare cache |

**БД не трогается.** Изменения только во фронте.

---

## 8. Что нужно от Cursor/DC

1. ✅ Подтвердить семантику `merged` (терминальный или нет) — раздел 5, вопрос 1.
2. ✅ Проверить `Archive.tsx` — будут ли там видны merged-рейсы после фикса.
3. ✅ Найти место `UPDATE rides SET status = 'merged'` в api-server и убедиться что merged выставляется только для финального состояния.
4. ✅ Проверить driver-app (pages/driver/) на тот же фолбэк.
5. После подтверждения — дать добро на применение фикса по разделу 4 + деплой по разделу 6.

---

**Контакт для вопросов:** Давлат (диспетчер + владелец)
**Файлы для изучения:**
- `artifacts/taxi-app/src/pages/dispatcher/Orders.tsx` (главный)
- `artifacts/taxi-app/src/pages/dispatcher/Archive.tsx`
- `artifacts/api-server/src/routes/rides.ts` или `trips.ts` (для grep `'merged'`)
