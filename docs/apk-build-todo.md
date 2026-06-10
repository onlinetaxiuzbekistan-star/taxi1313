# Taxi 1313 — Driver APK (new build) — muammolar ro'yxati

> Operator/dispatcher va haydovchi ilovasi bo'yicha tuzatiladigan muammolar.
> Yangi `eas build` (to'liq APK) dan oldin hammasi yig'iladi, keyin bitta promptga jamlanadi.

## Yangi muammolar (foydalanuvchi yuboradi — birma-bir)

<!-- Har bir muammo shu yerga raqamlanib qo'shiladi -->

### 1. Online tugmasini bosganda "Too many requests" (429) chiqyapti
- Haydovchi (FER-8105) Online tugmasini bosganda `Ошибка: Too many requests. Slow down and try again shortly.`
- Joy: server — `PATCH /api/drivers/status` global `apiRateLimit` (login-rate-limit.ts) ga tushyapti. Ilovaning poll hajmi IP limitini to'ldiryapti.
- Kerak: status-toggle hech qachon 429 bermasligi (limitdan ozod yoki alohida yuqori limit), va/yoki umumiy so'rov hajmini kamaytirish.

### 2. Online tugmasi o'z-o'zidan o'chib qolyapti
- Haydovchi online qiladi, lekin o'zi o'chadi.
- Joy: server presence-reaper (GPS lapse → offline) yoki status flip. Haydovchi ilovani ochiq qoldirsa ham offline bo'lyapti.
- Kerak: online faqat haydovchi o'zi bosganda o'chsin (3-band bilan bog'liq). Reaper'ni shunga moslash (ilova ochiq/keep-awake bo'lsa offline qilmaslik).

### 3. Online faqat tugma orqali o'chirilsin
- Bir marta yoqilgach, qayta o'chirish UCHUN ALBATTA tugmani bosish kerak — avtomatik o'chmasin.

### 4. Online bo'lsa ilovadan chiqib bo'lmasin
- Online tugmani bosmasdan ilovaga kirib/chiqib bo'lmasligi kerak; hozir online yoniq turganda ham ilovadan chiqib ketsa bo'lyapti.
- Kerak: online holatda app-exit (back/swipe) bloklansin — avval offline qilish shart. (driver-native `_layout.tsx` back-handler.)

### 5. GPS indikatori ko'p "o'ynayapti" (sariq/qizil/yashil)
- Joy: driver-native `DriverHeader` / `use-gps-active`.
- Kerak: GPS yoqiq va ishlayotgan bo'lsa DOIMO **yashil**, ishlamayotgan bo'lsa **qizil**. Sariq va tez-tez almashishni olib tashlash.

### 6. YANGI BO'LIM: barcha bo'sh (svabodniy) buyurtmalar
- Hozir bunday joy yo'q. Yangi bo'lim/tab kerak: hech kim qabul qilmagan (pending) buyurtmalar ro'yxati, haydovchi shu yerdan o'zi tanlab olishi mumkin.
- Joy: server (pending buyurtmalar ro'yxati endpoint, ehtimol shahar/yo'nalish bo'yicha) + driver-native yangi tab + self-accept.

### 7. Marketplace buyurtmalari haydovchilarga ko'rinmayapti
- Haydovchi SOTGAN buyurtma (marketplace listing) hech qaerda yo'q — faqat operatorda ko'rinadi, boshqa haydovchilarga ko'rinmaydi.
- Kerak: sotilgan (marketplace) buyurtmalar boshqa haydovchilarga ko'rinsin va **6-banddagi yangi "bo'sh buyurtmalar" bo'limiga ham tushsin** — haydovchi shu yerdan sotib oladi/oladi.
- Joy: server marketplace listings (marketplace.ts) + driver-native yangi bo'lim (6-band bilan birlashtiriladi).

---

## ROUND 2 — yangi muammolar (foydalanuvchi yuboradi, birma-bir)

### R2-1. "Начать работу"/online bosganda yana 429
- O'lchov: haydovchi 8105 ~17 so'rov/sek (84/5s) yuboryapti — eski **v1.0.9 ilova so'rov-storm bug'i**.
- 429 backoff + poll kamaytirish `bd88741` (v1.0.9'дan KEYIN) da qilingan → **yangi 1.1.0 APK'да tuzatilgan**, v1.0.9'да yo'q.
- Server per-user limit to'g'ri ishlaydi. **YANGILANDI:** 1.1.0'да ham takrorlandi → /metrics tahlili: top poll'lar my-active-ride, pending-offers, chat/dispatcher-info. Bu **429-retry kaskadi** (backoff'siz poll loop'lar limitга urilgach darhol qayta uradi → 17/sek storm). **Yechim (deploy):** per-user limit 1200→**3000/min** (kaskad boshlanmaydi). Jonli.
- **Follow-up (build):** app poll loop'lariga 429-backoff qo'shish + poll chastotasini kamaytirish (use-orders'da bor, lekin IncomingOfferModal/chat/board loop'larida yo'q).

### R2-3. GPS qizil, lekin kartada online (mos emas)
- Ilova GPS indikatori qizil, operator kartasi esa driverни online (GPS bor) ko'rsatadi.
- Sabab: indikator faqat JS-tomon `addLocationListener` (lokal) ga tayanardi; native xizmat GPS'ni serverga to'g'ridan-to'g'ri yuboradi, lekin background'дan keyin JS hodisa chiqarmasligi mumkin → lokal qizil, server yangi.
- **TUZATILDI (rebuild kerak):** `useGpsActive(online, serverLastFix)` — lokal YOKI server `lastLocationUpdate` (/me'дan) yangi bo'lsa yashil → karta bilan mos. `DriverHeader` `user.lastLocationUpdate` ni uzatadi.

### R2-4. Buyurtma avval Свободные'ga tushyapti, keyin taklif qilinyapti
- Operator buyurtma yaratganda pending bo'lib board'да ko'rinadi, keyin auto-dispatch offer qiladi. Kerak: avval taklif, board faqat fallthrough uchun.
- **TUZATILDI (server, jonli):** `/free-orders` grace — pending faqat (created > 30s oldin) VA (so'nggi 30s'da offer yo'q) bo'lsa ko'rsatiladi. Aktiv dispatch ketayotган buyurtma board'да chiqmaydi; hech kimga taklif bo'lmasa 30s'дan keyin chiqadi. Sozlama: `free_board_grace_seconds` (default 30). Rebuild shart emas.

### R2-5. Reys ekranida tanlangan vaqt oynasi ko'rinmaydi
- Haydovchi 8:00–10:00 belgilab reys yaratgan, lekin reys ekranida qaysi vaqtga qo'yganini ko'rsatmaydi.
- **TUZATILDI (rebuild kerak):** SeatViewScreen header kartasiga route ostida **vaqt oynasi** qatori (Clock + "08:00 – 10:00"; urgent bo'lsa "Hozir"). `ride.timeSlot` dan. i18n `time_now` qo'shildi.

### R2-6. Taklif countdown (necha soniya qolgani) + server sozlamasiga bog'liq
- Kerak: haydovchiga taklif kelganда soniya sanagichi ko'rinsin, va dispetcher offer_timeout_seconds ni o'zgartirsa haydovchida ham o'zgarsin.
- Sabab: IncomingOfferModal'da countdown bor edi (offer.expiresAt'дan), lekin `/pending-offers` `expiresAt` ni qaytarmasdi (faqat expiresIn) → sanagich ko'rinmas edi.
- **TUZATILDI (server, jonli):** `/pending-offers` javobiga `expiresAt` qo'shildi. offer.expiresAt = now + offer_timeout_seconds → sozlama o'zgarsa sanagich ham o'zgaradi. Rebuild shart emas (1.1.0'да ishlaydi).
- (Ixtiyoriy: sanagichni kattaroq/ko'zga tashlanadiган qilish — keyingi build.)

### R2-7. Bo'sh buyurtmalar qayta-qayta taklif qilinyapti — efirда tursin
- Sabab: dispatch sweep (60s) fallthrough buyurtmani har safar qayta dispatch qilardi (24h ichida) → cheksiz takror taklif.
- **TUZATILDI (server, jonli):** sweep endi allaqachon offer qilingan (order_offers bor) buyurtmalarni resume qilmaydi → ular board'да tinch turadi. Faqat hech qachon taklif qilinmaganlar resume bo'ladi (restart recovery). Sozlama: `redispatch_offered_rides` (default false).

### R2-8. Unassign → efirga olinganда 10s'дan keyin Свободные'да (darhol kerak)
- Sabab: unassign qayta auto-dispatch qilardi (yangi offer) → R2-4 grace board'дan yashirardi.
- **TUZATILDI (server, jonli):** (1) unassign endi qayta dispatch qilmaydi → efirга tushadi + `new_ride` broadcast (board darhol reload). (2) `/free-orders` filtri "so'nggi 30s offer" → "hozir PENDING offer bormi" ga o'zgartirildi → unassign'дan keyin darhol ko'rinadi. Sozlama: `redispatch_on_unassign` (default false).

### R2-9. Profilga "Опции" bo'limi (API'dan opsiyalar ro'yxati) — KUTILMOQDA
- Profil ekraniga "Опции" menu qo'shish, API'dan kelgan opsiyalar ro'yxatini ko'rsatish.
- Yangi funksiya: driver-accessible options endpoint + yangi Profil ekrani + rebuild.
- Mavjud: route_options (marshrut+tarif, narxli, dispetcher-only GET); haydovchi imkoniyatlari users.hasAC/hasLuggage/isComfort/customOptions; dispatch allowedByOptions (preferences.roofBaggage/acceptParcels — lekin users.preferences ustuni YO'Q, latent bug).
- **ANIQLANDI:** Opsiyalar = route_options (Почта 70/50/100%, Верхний багаж, Пустой багажник — narxlari bilan, toggle). Haydovchi Profilда yoqib/o'chiradi (saqlanadi). MATCHING: haydovchi opsiyani O'CHIRSA → o'shani talab qiladigan buyurtmani **KO'RADI, lekin QABUL QILA OLMAYDI** (accept rad etiladi, ko'rinish o'zgarmaydi). Default: hammasi yoqilgan.
- Implementatsiya: (server) driver-accessible options-list endpoint + haydovchi tanlovini saqlash (users.customOptions jsonb) + `/drivers/accept`да gate (ride.selectedOptions ∩ driver-disabled bo'lsa 403). (driver-native) Profil → "Опции" ekrani (toggle+save). Rebuild kerak.

### R2-10. Board/Срочные'да opsiyali buyurtmaga fokus + qo'shilgan pul
- Hozir opsiya ("Почта 50%") kichik kulrang matnда — ko'zga tashlanmaydi.
- Kerak: opsiyali buyurtma **ajralib tursin** (rangli badge/icon), opsiya nomi + **qancha pul qo'shilayotgani** (+sum) ko'rinsin. Joylar: board.tsx (Свободные), urgent.tsx (Срочные), IncomingOfferModal.
- Data: /free-orders + /pending-offers buyurtma opsiyalarini (label + qo'shilgan narx) qaytarishi kerak (route_options'дan optionKey→label+price). Rebuild kerak (UI).

### R2-11. App'дan chiqib qaytганда GPS yashilga avtomat tiklanmaydi
- Background'да RN JS muzlaydi → /me (user.lastLocationUpdate) yangilanmaydi + lokal listener to'xtaydi → GPS qizil. Qaytganда darhol tiklanmaydi (interval/listener kechikadi).
- Native xizmat serverga GPS yuborib turibdi (server'да yangi) — faqat app bilmaydi.
- **Yechim (rebuild):** AppState "active" (foreground) listener → darhol `refreshUser()` (/me qayta yuklash) → R2-3 logikasi server'ning yangi GPS'ini ko'radi → darhol yashil. (Ixtiyoriy: foreground'да bitta GPS ping ham majburlash.) Joy: app/(driver)/_layout.tsx yoki use-auth.

### R2-12. "Вы первый в очереди" va "Ожидание пассажиров" o'rnini almashtirish
- **BAJARILDI (rebuild kerak):** SeatViewScreen'да QueueWidget endi yuqorida, "Ожидание пассажиров" hint pastда (swap). Maket ko'rsatildi.
- Eslatma: haqiqiy screenshot faqat APK build'дan keyin (RN ilovani serverда screenshot qilib bo'lmaydi — faqat maket).

### R2-13. Seat-detail popup'да ham dop-opsiya ko'rinsin (+narx)
- Yo'lovchi/joy popup'iда (Место N → yo'lovchi nomi, status, narx) opsiya ham ko'rinsin: "+20000 багажник" yoki boshqa (nomi + qo'shilgan pul).
- R2-10/R2-9 bilan bir xil data plumbing (opsiya label + qo'shilgan narx) — birga qilinadi. Joy: SeatViewScreen seat-detail modal. Rebuild kerak.

### R2-14. Reys yakunlanganda noto'g'ri "Заказ снят" + to'liq chek kerak
- BUG: reys completed bo'lganда "Заказ снят / Диспетчер снял с вас заказ" alert chiqadi (noto'g'ri). Sabab: use-orders.ts poll safety-net — `/my-active-ride` completed'дan keyin null qaytaradi → app "unassigned/removed" deb talqin qilib order_removed alert ko'rsatadi. Fix: completed holatini ajratish (completed → chek/jim; unassigned → "removed").
- FEATURE: yakunlanganда **to'liq chek** — yo'lovchilar soni, har biri qancha, jami summa, (komissiya/sof daromad, opsiyalar). Hozir oddiy completion ekran bor (ActiveRideScreen) — uни to'liq chekka aylantirish. Rebuild kerak.

### R2-15. Заработок "Сегодня" filtri kechagi buyurtmalarni ham ko'rsatadi
- **TUZATILDI (rebuild kerak):** earnings.tsx filtri "today" = `now - 24h` (aylanma) edi → kechagi kechki reyslar kirardi. Endi "today" = kalendar kun (yarim tundan). Hafta/oy aylanma qoldi.

### R2-16. Sotilган (sell-order) buyurtma board'да 15s'дan keyin ko'rinadi
- Server zanjiri TO'G'RI: /sell-order → active listing + broadcast marketplace_new_listing+new_ride; board.tsx ikkalasini tinglaydi; WS hook hammasini uzatadi; /free-orders aktiv listingni grace'siz ko'rsatadi → darhol bo'lishi kerak (R2-8 mexanizmi).
- 15s = poll → WS board'ни yangilamayapti. Tekshirish: (a) foydalanuvchi **Срочные**ni ko'ryaptimi? — urgent.tsx /marketplace/listings marshrut-filtrli (cheklangan); **Свободные** (board.tsx) hammaga ko'rsatadi. (b) WS yetkazib berish/board mount. 1.1.2 build'да 2 ta haydovchi bilan tekshirib, kerak bo'lsa urgent.tsx ni ham /free-orders'ga o'tkazaman.

### R2-17. Marketplace buyurtmaga board'да "M" (market) belgisi
- Marketplace'дan kelgan buyurtma board'да oddiy/Срочные kabi ko'rinadi — "M"/market belgisi yo'q. Kerak: aniq market badge.
- DEDUP: /sell-order ride (kind=order) + listing (kind=marketplace) yaratadi → board'да IKKI marta ko'rinishi mumkin. Sotilган ride'ni faqat **bir marta** (marketplace sifatida, M belgili) ko'rsatish. Joy: /free-orders (dedup: active listing'li ride'ni order sifatida chiqarmaslik) + board.tsx (M badge). R2-10 bilan birga. Rebuild.

### R2-2. Splash (ochilish) rasmi noto'g'ri ko'rinadi
- 1.1.0'да ochilishda markazda kichik "to'liq dizayn flayer" (1313 + mashina + analitika) ko'rinadi.
- Sabab: `assets/splash.png` — to'liq ekran dizayni; lekin **Android 12+ splash API faqat markazdagi kichik ikonkani** ko'rsatadi → dizayn kichrayib noto'g'ri chiqadi. (config: app.json `splash` + `expo-splash-screen` plugin, resizeMode contain, bg #DC2626.)
- Yechim: splash sifatida **sodda, shaffof fonli markaziy LOGO** (faqat "1313 TAXI" belgisi) qo'yish; fon qizil (#DC2626) qoladi. `scripts/gen_brand.py` brand-generator bor — undan toza splash-logo yasash mumkin. **APK rebuild kerak.**
- **TUZATILDI (rebuild kutmoqda):** `scripts/gen_splash_logo.py` yaratildi → toza markaziy **3D "1313 TAXI"** logo (`assets/splash-logo.png`, kvadrat shaffof: oq yuza + kumush ekstruziya + soya + taxi-checker). app.json `splash.image` + `expo-splash-screen` plugin endi shunga ishora qiladi. Keyingi APK build'да qo'llanadi.

---

## HOLAT (7 muammo) — 2026-06-09
- [x] **1.** 429 — `apiRateLimit` endi userId bo'yicha (CGNAT fix). **Serverга deploy qilindi.**
- [x] **2/3.** Online o'z-o'zidan o'chmasin — presence-reaper 180s→**900s** (faqat haqiqatan yo'qolganda). **Deploy qilindi.** + keep-awake (app ochiq → GPS oqadi → reap bo'lmaydi).
- [x] **4.** Online bo'lsa ilovadan chiqib bo'lmasin — `_layout.tsx` back-handler + handleExit bloklaydi. **APK kerak.**
- [x] **5.** GPS indikatori 2 holat (yashil/qizil), sariq/flicker yo'q — `use-gps-active.ts` + `DriverHeader.tsx`. **APK kerak.**
- [x] **6/7.** Bo'sh buyurtmalar bo'limi — backend `GET /api/drivers/free-orders` (pending + marketplace, cheklovsiz). **Deploy qilindi.** + yangi "Свободные" tab `app/(driver)/board.tsx`. **APK kerak.**

Driver-native: butun ilova `tsc --noEmit` = 0 xato. Server o'zgarishlari jonli, healthy.

## Shu sessiyada ALLAQACHON tuzatilgan (yangi APK/serverga kiradi)

- ✅ Merged buyurtmani unassign/cancel qilganda haydovchidan tozalash (fantom o'rin)
- ✅ Unassign denormalizatsiya driver_* maydonlarini tozalash + targetli WS clear
- ✅ Presence-reaper: GPS yangiligiga qarab stale online/dangling-busy ni offline
- ✅ Dispetcher qayta taklif qilsa unassign cooldown'ni ochish
- ✅ SIP "Ожидает в очереди" muzlashi (use-sip-phone onclose) + proxy multi-socket
- ✅ "Назначить" ro'yxati: faqat aktiv (online/yangi GPS) + 40 km radius haydovchilar
- ✅ Haydovchisiz buyurtmani "В пути" qilishni taqiqlash (status guard)
- ✅ Qabul qilingan buyurtma "Принят"/"Ожидают" (В пути emas)
- ✅ Keep-awake: ilova ochiq bo'lsa ekran doim yoniq (statusga bog'liq emas) — **APK build kerak**

## Build eslatmalari
- driver-native: v1.0.9 dan beri NATIVE o'zgarishlar bor (expo-splash-screen, yangi nom/ikonka/splash, versionCode 8) → OTA emas, **to'liq APK build** kerak.
- EAS: owner=akrom5050, projectId=5650af03-281c-4d8e-aa4b-3762beeb6611, channellar: preview/production.
- Build'dan keyin: kelajakdagi JS-only tuzatishlar OTA bilan yetadi.
