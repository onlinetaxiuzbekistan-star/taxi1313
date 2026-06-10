# PROMPT — Taxi 1313 Driver APK (yangi to'liq build oldidan tuzatishlar)

## Kontekst
Monorepo: `/opt/taxi1313` (pnpm). Tegishli paketlar:
- **Backend:** `artifacts/api-server` (Express 5 + Drizzle/Postgres + Redis + ws). Jonli: systemd `taxi1313-api` (port 4000). Build: `node artifacts/api-server/build.mjs`, deploy: restart `taxi1313-api`.
- **Dispetcher web:** `artifacts/taxi-app` (Vite/React). `dist/public` ni api-server beradi. Build: `PORT=4000 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/taxi-app build`.
- **Haydovchi ilovasi:** `artifacts/driver-native` (Expo/React Native, npm). EAS owner=akrom5050, projectId=5650af03-281c-4d8e-aa4b-3762beeb6611, runtimeVersion policy=appVersion (hozir 1.0.9), channellar: preview/production. **Bu o'zgarishlar yangi to'liq APK (eas build) talab qiladi** (v1.0.9 dan beri native: expo-splash-screen, ikonka/splash/nom, versionCode 8).

Maqsad: quyidagi muammolarni tuzatib, **version/versionCode bump qilib**, yangi APK build qilish. Backend o'zgarishlarini darhol serverga deploy qilish.

---

## TUZATILADIGAN MUAMMOLAR

### 1. Online tugmasi → "Too many requests" (429)
- **Alomat:** haydovchi Online bossa `Too many requests. Slow down and try again shortly.`
- **Sabab:** `PATCH /api/drivers/status` global `apiRateLimit` (api-server `src/lib/login-rate-limit.ts`, `src/app.ts:102`) IP limitiga tushadi; ilova poll hajmi limitni to'ldiradi.
- **Tuzatish:** status-toggle (`/drivers/status`) va boshqa muhim haydovchi-amallarini umumiy `apiRateLimit` dan ozod qilish yoki ularga ancha yuqori alohida limit berish. Qo'shimcha: ilovaning umumiy so'rov hajmini kamaytirish (poll intervallari).
- **Qabul mezoni:** Online/Offline tugmasi hech qachon 429 bermaydi.

### 2 & 3. Online o'z-o'zidan o'chyapti — faqat tugma bilan o'chsin
- **Alomat:** online qilingach o'zi offline bo'lyapti; foydalanuvchi: online FAQAT tugma bosilganda o'chishi kerak.
- **Sabab:** server `presence-reaper` (`src/lib/presence-reaper.ts`) GPS eskirsa online→offline qiladi; GPS lapse yoki 429 sababli flip.
- **Tuzatish (kelishtirish):** haydovchi ochiq/ulangan bo'lsa offline qilinmasin. Reaper'ni yumshatish: faqat haydovchi **haqiqatan yo'qolганda** (WS uzilgan VA GPS uzoq vaqt, masalan ≥10-15 daq yo'q) offline qilsin; ilova foreground GPS service ishlayotган bo'lsa (yangi GPS kelyapti) — tegmasin. Keep-awake allaqachon ilova ochiqligida ekranni yoqib turadi (JS+GPS ishlaydi) — bu bilan birga genuine-online hech qachon reap bo'lmasligi kerak. 429 (1-band) ham flip sababi bo'lishi mumkin — uni ham tuzatish.
- **Qabul mezoni:** ilova ochiq turganda (yoki foreground GPS ishlayotганда) haydovchi online qoladi, faqat tugma bilan offline bo'ladi.

### 4. Online bo'lsa ilovadan chiqib bo'lmasin
- **Alomat:** online yoniq turganда ham ilovadan chiqib ketsa bo'lyapti.
- **Tuzatish:** driver-native `app/(driver)/_layout.tsx` back-handler: agar haydovchi online (yoki busy) bo'lsa, app-exit (back/swipe) bloklansin — toast: "Avval offline qiling". Hozir faqat `isRideActive()` bloklaydi; online holatини ham qo'shish.
- **Qabul mezoni:** online turganda back/exit chiqarmaydi; offline qilgandan keyin chiqadi.

### 5. GPS indikatori ko'p o'ynayapti (sariq/qizil/yashil)
- **Joy:** driver-native `src/components/DriverHeader.tsx` + `src/hooks/use-gps-active.ts`.
- **Tuzatish:** indikator faqat 2 holat: GPS ishlayotган (yangi fix kelyapti) = **yashil**, ishlamayotган = **qizil**. Sariq holat va tez-tez almashishni olib tashlash; qisqa debounce bilan barqaror qilish.
- **Qabul mezoni:** GPS ishlaganда doimo yashil, ishlamaganда qizil; miltillamaydi.

### 6 & 7. YANGI BO'LIM — barcha bo'sh buyurtmalar + marketplace
- **Alomat:** (6) hech kim qabul qilmagan buyurtmalarни haydovchi ko'radigan/oladigan joy yo'q. (7) haydovchi SOTGAN (marketplace) buyurtma boshqa haydovchilarga ko'rinmaydi — faqat operatorda.
- **Tuzatish:**
  - **Backend:** haydovchi uchun "bo'sh buyurtmalar" endpoint — `pending` (egasiz) buyurtmalar + **marketplace listinglar** (`marketplace.ts` / `marketplaceListingsTable`) birga. Ehtimol haydovchi shahri/yo'nalishi bo'yicha filtr. Self-accept yo'li (mavjud accept/marketplace buy oqimidan foydalanish).
  - **Driver-native:** yangi tab/bo'lim — shu ro'yxatni ko'rsatadi, haydovchi tanlab **o'zi oladi** (pending → accept; marketplace → buy). Real-time yangilanish (WS: `new_ride`, `marketplace_new_listing`, `ride_updated`).
- **MUHIM (aniqlashtirildi):** bo'limда **pending (hech kim olmagan)** buyurtmalar + **marketplace** listinglar ko'rinadi. **`offered` (hozir bir haydovchiga taklif qilinayotган) buyurtma KO'RINMAYDI** (ikki haydovchi bir vaqtда olmasin); taklif muddati tugab `pending`ga qaytsa — yana ko'rinadi.
- **Qabul mezoni:** haydovchi bo'sh (pending, offered emas) va sotuvdagi (marketplace) buyurtmalarni bitta bo'limда ko'radi va o'zi oladi; olингач yoki boshqa birovga taklif qilinганда ro'yxatdan yo'qoladi.

---

## SHU SESSIYADA ALLAQACHON TUZATILGAN (yangi build/serverга kiradi — qayta qilinmasin)
- Merged buyurtmani unassign/cancel'da haydovchidan tozalash (fantom o'rin) + denorm driver_* tozalash + targetli WS clear.
- presence-reaper (GPS yangiligiga qarab) — **2/3-band bo'yicha yumshatiladi**.
- Dispetcher qayta taklif → unassign cooldown ochiladi.
- SIP "Ожидает в очереди" muzlashi (use-sip-phone onclose) + proxy multi-socket.
- "Назначить" ro'yxati: aktiv (online/yangi GPS) + 40 km radius.
- Haydovchisiz buyurtmani "В пути" qilishni taqiqlash.
- Qabul qilingan buyurtma "Принят"/"Ожидают" (В пути emas).
- Keep-awake: ilova ochiq bo'lsa ekran doim yoniq.

## BUILD & RELEASE
1. Backend o'zgarishlari: `node artifacts/api-server/build.mjs` → `systemctl restart taxi1313-api` → `/api/readiness` tekshir.
2. Dispetcher web (agar tegilgan bo'lsa): `pnpm --filter @workspace/taxi-app build`.
3. Driver APK: `artifacts/driver-native` da `app.json` **version** (masalan 1.1.0) va android **versionCode** (≥9) bump → `eas build -p android --profile production` (yoki preview) → APK haydovchilarga tarqatiladi.
4. Build'dan keyin: kelajakdagi JS-only tuzatishlar shu yangi versiyaga `eas update` (OTA) bilan yetadi.

## CHEKLOVLAR
- Backend API shartnomalarini buzmaslik; har bir o'zgarishdan keyin `tsc --noEmit` + build.
- Reaper yumshatish genuine-online drayverlarni yiqitmasligini ta'minlash (asosiy talab: online faqat qo'lda o'chsin).
- driver-native — native o'zgarish bo'lsa OTA emas, build kerakligini yodda tutish.
