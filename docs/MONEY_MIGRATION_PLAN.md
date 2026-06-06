# План миграции денежных колонок: `real` → `numeric(19,2)`

Статус: **ПЛАН. Миграции НЕ запускались.** Артефакты: `docs/money-migration/up.sql`, `down.sql`.

## 0. TL;DR
- 26 денежных колонок в 9 таблицах используют `real` (float4) — неточный тип. Мигрируем на `numeric(19,2)`.
- Проект применяет схему через `drizzle-kit push` (версионных миграций нет) → для денег это **опасно**, поэтому используем **ручной SQL** (`up.sql`/`down.sql`) с явным `USING ...::numeric`, затем приводим TS-схему в соответствие.
- В TS-схеме меняем `real(x)` → `numeric(x, { precision: 19, scale: 2, mode: "number" })`.
  **`mode: "number"` критичен**: Drizzle тогда возвращает `number` и принимает `number` → **код менять почти не нужно**, арифметика на числах продолжает работать, а точность гарантируется БД.
- Без `mode: "number"` (канонический строковый numeric) ломается ~15 мест арифметики — список в §4.

---

## 1. Аудит: денежные колонки в `real` (→ мигрировать)

| # | Таблица | Колонка | Текущий тип | Null/Default | Цель |
|---|---------|---------|-------------|--------------|------|
| 1 | rides | price | real | notNull, def 0 | numeric(19,2) |
| 2 | rides | commission | real | nullable | numeric(19,2) |
| 3 | rides | driver_payout | real | nullable | numeric(19,2) |
| 4 | rides | options_total | real | notNull, def 0 | numeric(19,2) |
| 5 | rides | options_commission | real | notNull, def 0 | numeric(19,2) |
| 6 | rides | from_district_charge | real | def 0 | numeric(19,2) |
| 7 | rides | to_district_charge | real | def 0 | numeric(19,2) |
| 8 | rides | base_price | real | nullable | numeric(19,2) |
| 9 | ride_passengers | price | real | notNull, def 0 | numeric(19,2) |
| 10 | routes | price_economy | real | notNull, def 0 | numeric(19,2) |
| 11 | routes | price_comfort | real | notNull, def 0 | numeric(19,2) |
| 12 | routes | price_business | real | notNull, def 0 | numeric(19,2) |
| 13 | routes | price_mail | real | notNull, def 0 | numeric(19,2) |
| 14 | routes | price_front_economy | real | notNull, def 0 | numeric(19,2) |
| 15 | routes | price_front_comfort | real | notNull, def 0 | numeric(19,2) |
| 16 | routes | price_front_business | real | notNull, def 0 | numeric(19,2) |
| 17 | route_options | price | real | notNull, def 0 | numeric(19,2) |
| 18 | route_options | commission | real | notNull, def 0 | numeric(19,2) |
| 19 | marketplace_listings | price | real | notNull | numeric(19,2) |
| 20 | marketplace_listings | base_price | real | nullable | numeric(19,2) |
| 21 | addresses | extra_price | real | notNull, def 0 | numeric(19,2) |
| 22 | districts | extra_charge | real | notNull, def 0 | numeric(19,2) |
| 23 | tariffs | base_rate | real | notNull | numeric(19,2) |
| 24 | tariffs | per_km_rate | real | notNull | numeric(19,2) |
| 25 | tariffs | intercity_fee | real | notNull | numeric(19,2) |
| 26 | analytics_daily | avg_order_price | real | nullable | numeric(19,2) |

### Уже корректные (не трогаем)
`users.balance`, `users.bonus_balance`, `transactions.amount/balance_before/balance_after`,
`payments.amount`, `paynet_transactions.amount_sum`, `analytics_daily.commission` — `numeric`.
`tariffs.min_price`, `payme_transactions.amount` — `integer` (ок).

### Пограничные: ставки/проценты (не деньги, но точность важна) — опционально
| Таблица | Колонка | Тип | Рекомендация |
|---------|---------|-----|--------------|
| users | commission_rate | real (def 10) | numeric(5,2) |
| routes | round_trip_discount_percent | real (def 10) | numeric(5,2) |

### НЕ деньги — оставить `real`
Все `lat`/`lng` (addresses, rides, ride_passengers, cities, districts, users),
`rides.distance`, `rides.route_distance`, `routes.distance_km` (км),
`rides.driver_rating`, `users.rating` (рейтинг 1–5), `users.activity_score`.

---

## 2. Миграция БД (up/down)
См. `docs/money-migration/up.sql` и `down.sql`. Оба атомарны (`BEGIN/COMMIT`).
- **Безопасность данных**: значения уже целые сумы (в коде везде `Math.round`), `::numeric(19,2)` округляет float-шум без потерь.
- **Down** реверсит в `real` через `::real` (возвращает неточность — только для отката).
- `NOT NULL` и дефолты сохраняются при `ALTER COLUMN ... TYPE`.

---

## 3. Изменения TS-схемы (`lib/db/src/schema/*`)
Для каждой колонки из §1: `real("col")` → `numeric("col", { precision: 19, scale: 2, mode: "number" })`,
дефолты остаются числовыми (`.default(0)`), `.notNull()` без изменений. Пример (`rides.ts`):

```ts
// было
price: real("price").notNull().default(0),
commission: real("commission"),
// стало
price: numeric("price", { precision: 19, scale: 2, mode: "number" }).notNull().default(0),
commission: numeric("commission", { precision: 19, scale: 2, mode: "number" }),
```
Не забыть импорт `numeric` (и убрать неиспользуемый `real`, если он больше нигде в файле не нужен —
в rides/ride_passengers/users `real` останется для lat/lng).

Файлы к правке: `rides.ts`, `ride_passengers.ts`, `routes.ts`, `marketplace.ts`,
`addresses.ts`, `districts.ts`, `tariffs.ts`, `analytics_daily.ts`.

> После ручного SQL + правки схемы `drizzle-kit push` должен показать **0 изменений** (схема = БД). Это и есть проверка соответствия.

---

## 4. Аудит арифметики над денежными полями

### С `mode: "number"` (рекомендуемый путь) — кода менять НЕ нужно
Drizzle возвращает `number`, принимает `number`. Все операции ниже продолжают работать как есть.
Места, где уже стоит `Number()/parseFloat()` — остаются корректными (`Number(number)` = number).

### Если выбрать строковый numeric (без mode) — ВОТ ЧТО СЛОМАЕТСЯ
Тип станет `string`, и `+` даст конкатенацию. Потребуется `Number(...)`:

| Файл:строка | Операция | Риск |
|---|---|---|
| `lib/completion.ts:75,220,227` | `!child.price` / `!existing.price` | 🔴 `"0.00"` истинно → нулевая цена не ловится |
| `lib/completion.ts` (computeCommission) | `price - optionsTotal`, `price*rate` | param типизирован `number` → нужен `Number(existing.price)` |
| `routes/rides.ts:767,1247` | `optionsTotal += opt.price` | 🔴 конкатенация строк |
| `routes/rides.ts:1707,1916` | `reduce(s + (p.price||0))` | 🔴 конкатенация |
| `routes/reports.ts:291` | `acc.commission += s.commission` | 🔴 конкатенация |
| `routes/analytics.ts:47,53,58,143` | `reduce(s + (r.price||0))` | 🔴 конкатенация |
| `routes/dispatcher.ts:29` | `reduce(s + (r.price||0))` | 🔴 конкатенация |
| `routes/drivers.ts:2423,2912` | `reduce(sum + (p.price||0))` | 🔴 конкатенация |
| `routes/marketplace.ts:131` | `(route.priceEconomy||0)+charge+charge` | 🔴 конкатенация |
| WRITE-сайды (`updateData.price = Number(x)` и т.п.) | insert/update numeric | нужен `String(x)` |

Уже безопасные (есть `Number()/parseFloat()`): `tariffs.ts:25,54,59,64`,
`routesManagement.ts:101–196`, `routeOptions.ts:47–71`, `marketplace.ts:134,344,351`,
`drivers.ts:932,1070,1616,1623,1689`, `rides.ts:1358,1584,1699,1737`.

**Вывод:** `mode: "number"` устраняет весь этот риск-лист. Рекомендуется он.

### Нужен ли Decimal.js?
Нет, не сейчас. Деньги в сумах округляются до целого (`Math.round`); float64 (JS number) точно
представляет целые до 2^53 и 2 знака для реальных величин. Хранение/агрегация — точный `numeric` в БД.
Decimal.js имеет смысл только если в будущем появятся дробные тийины и сложные начисления.

---

## 5. Порядок выката (безопасный)
1. **Бэкап БД** (`pg_dump`).
2. Прогон `up.sql` на **копии** БД → проверить типы (`information_schema.columns`), сверить суммы
   `SELECT sum(price) FROM rides` до/после (должны совпасть до копейки).
3. Поправить TS-схему (§3), `pnpm build` (api-server).
4. Прогнать `drizzle-kit push` против копии → должно быть **0 изменений** (схема = БД).
5. Прогнать smoke-тесты денежных путей (завершение поездки, расчёт цены, отчёты).
6. На проде: бэкап → `up.sql` в транзакции → деплой нового кода (рестарт сервиса).
7. Откат при проблеме: вернуть код из git + `down.sql`.

## 6. Оценка
- БД-миграция: секунды (ALTER TYPE на таблицах среднего размера; на больших — короткая блокировка таблицы).
- Код: при `mode:"number"` — только правка 8 файлов схемы. Без mode — +правки ~12 мест арифметики.
