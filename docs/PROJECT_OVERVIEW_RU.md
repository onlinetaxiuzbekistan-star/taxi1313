# Техническое описание проекта Taxi1313 (nil.taxi1313.ru)

## 1. Общее
Платформа онлайн-такси (Узбекистан): диспетчеризация заказов, водители, пассажиры,
оплаты, чаты, фотоконтроль водителей, маркетплейс совместных поездок, мобильное
приложение водителя (Android/iOS), VoIP-звонки.

## 2. Технологии
- Язык: TypeScript (Node.js, ESM).
- Монорепо: pnpm workspaces (catalog для версий), TypeScript project references.
- Backend: Express 5, Drizzle ORM.
- БД: PostgreSQL (владелец taxi1313_app) + Redis (ioredis) — кэш/очереди/сессии.
- Авторизация: JWT (jsonwebtoken) + bcryptjs + сессии (driver_sessions) + RBAC.
- Реалтайм: WebSocket (библиотека ws).
- Уведомления: Web Push (web-push), push_notifications, SMS.
- Изображения/ИИ: sharp (обработка), tesseract.js (OCR), TensorFlow blazeface
  (детекция лица) — для фотоконтроля.
- Платежи: Payme, Paynet, Atmos (узбекские платёжные системы).
- Маршруты/расстояния: OSRM.
- VoIP/SIP: sip-ws-proxy + проксирование на voip.onlinetaxi.me.
- Мониторинг/логи: Sentry, OpenTelemetry, Pino.
- Сборка: esbuild (build.mjs). Процесс-менеджер: PM2. Прокси: Nginx (TLS).
- Мобильное приложение: Capacitor (React+Vite, обёрнутый в WebView APK), не React Native.

## 3. Структура монорепо (/opt/taxi1313)
- artifacts/api-server  (@workspace/api-server) — backend API (порт 4000).
- artifacts/client-app  (@workspace/client-app) — веб-клиент (отдаётся на /client).
- artifacts/taxi-app    (@workspace/taxi-app)   — веб-приложение.
- driver-apk            — мобильное приложение водителя (Capacitor, Android/iOS).
- artifacts/mockup-sandbox — песочница для UI-макетов.
- lib/db        (@workspace/db)     — схема БД (Drizzle).
- lib/api-zod   (@workspace/api-zod) — Zod-схемы валидации.
- lib/api-client-react — сгенерированный API-клиент (OpenAPI).
- build-server, driver-apk, .gradle — сборка APK на сервере (Android SDK, Gradle 8.5, Java 17).
- sip-ws-proxy  — отдельный сервис SIP WebSocket.
- deploy, scripts, backups, docs, exports.

## 4. Запуск и инфраструктура
- PM2: процесс `taxi1313-api` → dist/index.mjs, порт 4000, NODE_ENV=production,
  до 4 ГБ памяти, авто-рестарт. Логи в /var/log/taxi1313/.
- Nginx: TLS; /api и /uploads → 127.0.0.1:4000; /client → статика client-app;
  /wss-sip → внешний VoIP; /wss-sip-proxy → :5065; /wss-audio → :5067; /healthz.
- Секреты в /opt/taxi1313/.env (DATABASE_URL, JWT/SESSION_SECRET и т.д.).

## 5. База данных (47 таблиц)
Пользователи/доступ: users, roles, permissions, role_permissions, driver_sessions,
driver_login_codes, driver_audit_logs, login_audit_logs, activity_logs.
Заказы/поездки: rides, ride_passengers, order_offers, routes, route_options, tariffs.
Водители: driver_groups, driver_cards.
Гео/филиалы: cities, districts, branches, addresses, address_groups.
Оплаты: transactions, payments, payme_transactions, paynet_transactions.
Чаты: messages, chat_participants, group_chats, group_chat_members,
group_chat_messages, group_join_requests.
Фотоконтроль: photo_requests, photo_tasks, photo_history, photo_control_history.
Прочее: clients, marketplace_listings, news, news_reads, device_tokens,
push_notifications, call_logs, analytics_daily, settings, blocked_apps, idempotency_keys.

Enum-ы: user_role = rider | driver | dispatcher | admin; driver_status = offline |
online | busy; car_class = economy | comfort | business. Дополнительно гибкий RBAC
через role_id + role_permissions.

## 6. Авторизация
- JWT Bearer-токен; проверка в middlewares/auth.ts (секрет JWT_SECRET).
- Токен водителя обязан содержать sid (id сессии), сессия проверяется в driver_sessions.
- Branch scope (userBranchId): изоляция данных по филиалам (NULL = глобальный доступ).
- RBAC: права через permissions/role_permissions; кэш сессии (10с), филиала (60с), прав.
- Вход водителя по SMS-коду (driver_login_codes), ограничение попыток (login-rate-limit).

## 7. API (монтируется на /api, ~300+ эндпоинтов)
Крупнейшие группы: drivers (47), metrics (24), rides (21), auth (18),
photo-control (17), group-chats (17), chat (10), marketplace (9), payments (8),
news (8), system (7), addresses (7), reports (6), rbac (6), staff (5),
routesManagement (5), dashboard (5), apk (5 — сборка/выдача APK), tariffs,
routeOptions, driver-groups, districts, dispatcher, cities, calls, branches,
blocked-apps, audio-files, settings, push-notifications, analytics, messages,
health, debug, payme, paynet, activityLogs.

## 8. Ключевая бизнес-логика (api-server/src/lib)
- Диспетчеризация: autodispatch.ts, batch-dispatch.ts, driver-queue.ts,
  driver-cache.ts, ride-buffer.ts. Авто-назначение заказов с фильтром по опциям
  водителя (багаж/посылки/крыша). Доставка предложения водителю: WebSocket
  (new_order) + Push (notifyNewOrder) + опрос /api/drivers/pending-offers каждые 7с,
  повтор через 2с + подтверждение (ack).
- Реалтайм: websocket.ts (broadcastToUser).
- Уведомления: notifications.ts, sms.ts, sms-notifications.ts, push.
- Фотоконтроль ИИ: photo-ai-validator.ts, photo-scheduler.ts (лицо + OCR).
- Маршруты: osrm.ts, route-match.ts.
- Оплаты: atmos.ts, paynet.ts (+ роуты payme/paynet).
- Деньги/логика: bonuses.ts, completion.ts, revenue-ai-prod.ts.
- Фоновые задачи: order-auto-cancel.ts, listings-cleanup.ts.
- Служебное: idempotency.ts, memory-guardian.ts, settings(Cache).ts, seed.ts,
  e2e-simulation.ts, stress-simulation.ts.

## 9. Что не доделано / работает с ошибками
- Известный баг: docs/BUG_MERGED_RIDES_STUCK_IN_DISPATCHER_ETHER.md — объединённые
  поездки «зависают» у диспетчера.
- Временные обходы (помечены «временно»): photo-control.ts (строки ~333, 420, 586),
  marketplace.ts (~492), drivers.ts (~1307); метка XXX в drivers.ts (~960).
- В папке routes/ много .bak-файлов (drivers.ts.bak.*, photo-control.ts.bak.*) —
  следы активной отладки логики назначения/подбора заказов; требуется чистка.
- Логика диспетчеризации/подбора водителя часто менялась — наиболее хрупкое место,
  тестировать в первую очередь при доработках.

## 10. Как продолжить разработку
- Изменения схемы БД: lib/db/src/schema/*, генерация/миграции Drizzle, затем
  пересборка api-server (pnpm build) и рестарт PM2 (pm2 restart taxi1313-api).
- Бизнес-эндпоинты: artifacts/api-server/src/routes/*; общая логика — src/lib/*.
- Перед правками удалить/проигнорировать .bak-файлы, работать только с актуальными .ts.
