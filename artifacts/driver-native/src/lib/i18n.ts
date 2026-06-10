// i18n strings ported from the web driver app (inline `lang === "uz" ? … : …`
// ternaries in DriverLayout.tsx and friends), collected into a typed dictionary.
// Russian (ru) and Uzbek (uz), matching the existing copy verbatim.
import { useSettingsStore, type Language } from "@/stores/settings";

export const translations = {
  // bottom nav
  nav_orders: { ru: "Заказы", uz: "Buyurtmalar" },
  nav_urgent: { ru: "Срочные", uz: "Shoshilinch" },
  nav_board: { ru: "Свободные", uz: "Bo'sh" },
  nav_chat: { ru: "Чат", uz: "Chat" },
  nav_profile: { ru: "Профиль", uz: "Profil" },
  board_empty_title: { ru: "Свободных заказов нет", uz: "Bo'sh buyurtmalar yo'q" },
  board_empty_sub: { ru: "Новые заказы появятся здесь", uz: "Yangi buyurtmalar shu yerda chiqadi" },
  accept_failed: { ru: "Не удалось принять заказ", uz: "Buyurtmani olishda xatolik" },
  accepted_title: { ru: "Заказ принят", uz: "Buyurtma olindi" },
  accepted_sub: { ru: "Заказ добавлен в ваши поездки", uz: "Buyurtma reyslaringizga qo'shildi" },

  // online/offline toggle
  status_online: { ru: "Online", uz: "Online" },
  status_offline: { ru: "Offline", uz: "Offline" },
  status_busy: { ru: "В рейсе", uz: "Reysda" },

  // header
  balance_unit: { ru: "сум", uz: "сум" },
  balance_title: { ru: "Баланс", uz: "Balans" },
  exit_app: { ru: "Закрыть приложение", uz: "Chiqish" },

  // exit confirm
  exit_q: { ru: "Закрыть приложение?", uz: "Dasturdan chiqasizmi?" },
  exit_sub: { ru: "Приложение будет закрыто", uz: "Dastur yopiladi" },
  cancel: { ru: "Отмена", uz: "Bekor qilish" },
  close: { ru: "Закрыть", uz: "Chiqish" },
  ok: { ru: "OK", uz: "OK" },
  time_now: { ru: "Сейчас", uz: "Hozir" },

  // online confirm
  go_offline_q: { ru: "Выйти с линии?", uz: "Liniyadan chiqasizmi?" },
  go_online_q: { ru: "Выйти на линию?", uz: "Liniyaga chiqasizmi?" },
  go_offline_sub: {
    ru: "Вы перестанете получать новые заказы",
    uz: "Yangi buyurtmalarni qabul qilishni to‘xtatasiz",
  },
  go_online_sub: {
    ru: "Вы начнёте получать новые заказы",
    uz: "Yangi buyurtmalarni qabul qila boshlaysiz",
  },
  go_offline_btn: { ru: "Выйти", uz: "Chiqish" },
  go_online_btn: { ru: "На линию", uz: "Chiqish" },

  // placeholder screens (Phase 0)
  orders_title: { ru: "Заказы", uz: "Buyurtmalar" },
  orders_empty: { ru: "Нет доступных заказов", uz: "Mavjud buyurtmalar yo‘q" },
  urgent_title: { ru: "Срочные заказы", uz: "Shoshilinch buyurtmalar" },
  chat_title: { ru: "Чат", uz: "Chat" },
  profile_title: { ru: "Профиль", uz: "Profil" },
  language: { ru: "Язык", uz: "Til" },
  phase0_note: {
    ru: "Экран будет перенесён в следующих фазах",
    uz: "Bu ekran keyingi bosqichlarda ko‘chiriladi",
  },

  // ── common ──
  err: { ru: "Ошибка", uz: "Xatolik" },
  err_network: { ru: "Ошибка сети", uz: "Tarmoq xatosi" },
  err_network_sub: { ru: "Проверьте подключение", uz: "Aloqani tekshiring" },
  done: { ru: "Готово", uz: "Tayyor" },
  back: { ru: "Назад", uz: "Orqaga" },
  loading: { ru: "Загрузка…", uz: "Yuklanmoqda…" },
  unit_sum: { ru: "сум", uz: "so‘m" },
  unit_km: { ru: "км", uz: "km" },
  unit_min: { ru: "мин", uz: "daqiqa" },
  unit_minutes: { ru: "минут", uz: "daqiqa" },
  unit_pax: { ru: "пассажиров", uz: "yo‘lovchi" },

  // ── ride status labels ──
  st_waiting: { ru: "Ожидает", uz: "Kutmoqda" },
  st_in_car: { ru: "В машине", uz: "Mashinada" },
  st_dropped: { ru: "Высажен", uz: "Tushirildi" },
  st_free: { ru: "Свободно", uz: "Bo‘sh" },
  st_accepted: { ru: "Принят", uz: "Qabul qilindi" },
  st_in_progress: { ru: "В пути", uz: "Yo‘lda" },
  st_completed: { ru: "Завершён", uz: "Yakunlandi" },
  st_cancelled: { ru: "Отменён", uz: "Bekor qilindi" },

  // ── home card ──
  home_add_photo: { ru: "Тап чтобы добавить фото", uz: "Foto qo‘shish uchun bosing" },
  home_change_photo: { ru: "Изменить фото", uz: "Fotoni o‘zgartirish" },
  go_online: { ru: "Выйти на линию", uz: "Liniyaga chiqish" },
  create_ride: { ru: "Создать рейс", uz: "Reys yaratish" },
  start_work: { ru: "Начать работу", uz: "Иш бошлаш" },

  // ── route select ──
  rs_from: { ru: "Откуда", uz: "Qayerdan" },
  rs_to: { ru: "Куда", uz: "Qayerga" },
  rs_choose: { ru: "Танланг", uz: "Tanlang" },
  rs_no_dest: { ru: "Нет доступных направлений", uz: "Mavjud yo‘nalishlar yo‘q" },
  rs_by_time: { ru: "По времени", uz: "Vaqt bo‘yicha" },
  rs_urgent_only: { ru: "Только срочные", uz: "Faqat shoshilinch" },
  rs_dep_time: { ru: "Время отправления", uz: "Jo‘nash vaqti" },
  rs_choose_time: { ru: "Выберите время", uz: "Vaqtni tanlang" },
  rs_urgent_note: {
    ru: "Получаете только срочные заказы (без интервала времени) на выбранный маршрут. Время отправления — сейчас.",
    uz: "Tanlangan yo‘nalish bo‘yicha faqat shoshilinch buyurtmalar olasiz (vaqt oralig‘isiz). Jo‘nash vaqti — hozir.",
  },
  rs_creating: { ru: "Создаём рейс...", uz: "Reys yaratilmoqda..." },
  rs_accept_urgent: { ru: "Принимать срочные", uz: "Shoshilinchni qabul qilish" },
  rs_start: { ru: "Начать рейс", uz: "Reysni boshlash" },
  rs_create_failed: { ru: "Не удалось создать рейс", uz: "Reys yaratib bo‘lmadi" },

  // ── idle ──
  idle_offline: { ru: "Вы офлайн", uz: "Siz oflaynsiz" },
  idle_offline_sub: {
    ru: "Выйдите на линию, чтобы создать рейс и принимать пассажиров",
    uz: "Reys yaratish va yo‘lovchi olish uchun liniyaga chiqing",
  },
  idle_online: { ru: "Вы на линии!", uz: "Siz liniyadasiz!" },
  idle_online_sub: {
    ru: "Создайте рейс, чтобы начать принимать пассажиров",
    uz: "Yo‘lovchi olishni boshlash uchun reys yarating",
  },

  // ── seat view / active ride ──
  car_full: { ru: "Машина заполнена", uz: "Mashina to‘ldi" },
  your_ride: { ru: "Ваш рейс", uz: "Sizning reysingiz" },
  seats: { ru: "Мест", uz: "Joy" },
  earnings_label: { ru: "Заработок", uz: "Daromad" },
  waiting_pax: { ru: "Ожидание пассажиров…", uz: "Yo‘lovchilar kutilmoqda…" },
  navigator: { ru: "Навигатор", uz: "Navigator" },
  cancel_ride: { ru: "Отменить", uz: "Bekor qilish" },
  sell_to_operator: { ru: "Продать заказ оператору", uz: "Buyurtmani operatorga sotish" },
  sold_listed: { ru: "Заказ выставлен на продажу", uz: "Buyurtma sotuvga qo‘yildi" },
  starting: { ru: "Начинаю…", uz: "Boshlanmoqda…" },
  start_ride: { ru: "Начать поездку", uz: "Safarni boshlash" },
  seat: { ru: "Место", uz: "Joy" },
  passenger: { ru: "Пассажир", uz: "Yo‘lovchi" },
  front_row: { ru: "Передний ряд", uz: "Oldingi qator" },
  back_row: { ru: "Задний ряд", uz: "Orqa qator" },
  pickup_pax: { ru: "Заберите пассажиров", uz: "Yo‘lovchilarni oling" },
  dropoff_pax: { ru: "Высадите пассажиров", uz: "Yo‘lovchilarni tushiring" },
  all_delivered: { ru: "Все клиенты доставлены", uz: "Barcha mijozlar yetkazildi" },
  press_finish: { ru: "Нажмите «Завершить рейс»", uz: "«Reysni yakunlash»ni bosing" },
  finishing: { ru: "Завершаю…", uz: "Yakunlanmoqda…" },
  finish_ride: { ru: "Завершить рейс", uz: "Reysni yakunlash" },
  pickup_btn: { ru: "Забрал", uz: "Oldim" },
  dropoff_btn: { ru: "Высадить", uz: "Tushirish" },
  cancel_ride_q: { ru: "Отменить рейс?", uz: "Reys bekor qilinsinmi?" },
  cancel_ride_sub: { ru: "Это действие нельзя отменить.", uz: "Bu amalni qaytarib bo‘lmaydi." },

  // ── manual client ──
  mc_add_seat: { ru: "Добавить — место", uz: "Qo‘shish — joy" },
  mc_phone_req: { ru: "Телефон клиента (обязательно)", uz: "Mijoz telefoni (majburiy)" },
  mc_phone_opt: { ru: "Телефон клиента (необязательно)", uz: "Mijoz telefoni (ixtiyoriy)" },
  press_back_again: { ru: "Нажмите ещё раз для выхода", uz: "Chiqish uchun yana bir marta bosing" },
  finish_ride_to_exit: { ru: "Завершите поездку, чтобы выйти", uz: "Chiqish uchun safarni yakunlang" },
  go_offline_to_exit: { ru: "Сначала выйдите с линии (Offline), чтобы закрыть приложение", uz: "Dasturdan chiqish uchun avval Offline qiling" },
  tap_seat_hint: { ru: "Нажмите на место для деталей пассажира", uz: "Yo‘lovchi tafsilotlari uchun joyni bosing" },
  confirm_pickup_q: { ru: "Посадить пассажира?", uz: "Yo‘lovchini olasizmi?" },
  confirm_pickup_yes: { ru: "Да, посадил", uz: "Ha, oldim" },
  confirm_dropoff_q: { ru: "Высадить пассажира?", uz: "Yo‘lovchini tushirasizmi?" },
  confirm_dropoff_yes: { ru: "Да, высадил", uz: "Ha, tushirdim" },
  choose_photo: { ru: "Фото профиля", uz: "Profil rasmi" },
  from_camera: { ru: "Камера", uz: "Kamera" },
  from_gallery: { ru: "Галерея", uz: "Galereya" },
  mc_phone_err: { ru: "Введите номер телефона клиента", uz: "Mijoz telefon raqamini kiriting" },
  mc_gender: { ru: "Пол пассажира", uz: "Yo‘lovchi jinsi" },
  mc_male: { ru: "Муж", uz: "Erkak" },
  mc_female: { ru: "Жен", uz: "Ayol" },
  remove_client: { ru: "Снять клиента", uz: "Mijozni olib tashlash" },

  // ── sell modal ──
  sell_hint: {
    ru: "Выберите тариф — цена берётся из текущего тарифа маршрута. Оплату получите после того, как покупатель завершит заказ.",
    uz: "Tarifni tanlang — narx yo‘nalishning joriy tarifidan olinadi. To‘lovni xaridor buyurtmani yakunlagach olasiz.",
  },
  tariff_standard: { ru: "Стандарт", uz: "Standart" },
  tariff_business: { ru: "Бизнес", uz: "Biznes" },
  tariff_missing: { ru: "Тариф не настроен", uz: "Tarif sozlanmagan" },
  sell_comment: { ru: "Комментарий (необязательно)", uz: "Izoh (ixtiyoriy)" },
  sell_list_for: { ru: "Выставить за", uz: "Sotuvga qo‘yish:" },
  sell_list: { ru: "Выставить на продажу", uz: "Sotuvga qo‘yish" },
  sell_failed: { ru: "Не удалось продать заказ", uz: "Buyurtmani sotib bo‘lmadi" },

  // ── completion ──
  ride_done: { ru: "Рейс завершён!", uz: "Reys yakunlandi!" },
  ride_cost: { ru: "Стоимость рейса", uz: "Reys narxi" },
  commission: { ru: "Комиссия", uz: "Komissiya" },
  your_income: { ru: "Ваш доход", uz: "Sizning daromadingiz" },
  ride_details: { ru: "Детали рейса", uz: "Reys tafsilotlari" },
  passengers_label: { ru: "Пассажиры", uz: "Yo‘lovchilar" },

  // ── queue ──
  q_first: { ru: "Вы первый в очереди!", uz: "Siz navbatda birinchisiz!" },
  q_progress: { ru: "Прогресс очереди", uz: "Navbat jarayoni" },
  q_first_sub: {
    ru: "Следующий заказ — ваш. Диспетчер видит вас первым.",
    uz: "Keyingi buyurtma — sizniki. Dispetcher sizni birinchi ko‘radi.",
  },
  q_position: { ru: "Очередь", uz: "Navbat" },
  q_of: { ru: "из", uz: "/" },

  // ── nav / map ──
  nav_open: { ru: "Открыть в навигаторе", uz: "Navigatorda ochish" },
  nav_yandex: { ru: "Яндекс Навигатор", uz: "Yandex Navigator" },
  map_unavailable: { ru: "Маршрут на карте недоступен", uz: "Xaritadagi yo‘nalish mavjud emas" },
  elapsed: { ru: "В пути:", uz: "Yo‘lda:" },

  // ── expired modal ──
  exp_title: { ru: "Рейс просрочен", uz: "Reys muddati o‘tdi" },
  exp_sub: { ru: "Время рейса истекло, а места не заполнены", uz: "Reys vaqti tugadi, joylar to‘lmagan" },
  exp_extend: { ru: "Продлить на 30 мин", uz: "30 daqiqaga uzaytirish" },
  exp_start: { ru: "Начать поездку", uz: "Safarni boshlash" },

  // ── offer modal ──
  offer_new: { ru: "Новый заказ", uz: "Yangi buyurtma" },
  offer_later: { ru: "Позже", uz: "Keyinroq" },
  offer_accept: { ru: "Принять", uz: "Qabul qilish" },

  // ── urgent / market ──
  urgent_empty_title: { ru: "Срочные заказы", uz: "Shoshilinch buyurtmalar" },
  urgent_empty_sub: { ru: "Пока нет доступных заказов", uz: "Hozircha buyurtmalar yo‘q" },
  urgent_section: { ru: "Срочные заказы", uz: "Shoshilinch buyurtmalar" },
  accept_order: { ru: "Принять заказ", uz: "Buyurtmani qabul qilish" },
  market: { ru: "Маркет", uz: "Market" },
  buy: { ru: "Купить", uz: "Sotib olish" },
  bought: { ru: "Куплено", uz: "Sotib olindi" },
  bought_sub: { ru: "Заказ добавлен в ваши рейсы", uz: "Buyurtma reyslaringizga qo‘shildi" },
  buy_failed: { ru: "Не удалось купить", uz: "Sotib olib bo‘lmadi" },

  // ── profile ──
  wallet_menu: { ru: "Кошелёк", uz: "Hamyon" },
  earnings_menu: { ru: "Заработок", uz: "Daromad" },
  earnings_sub: { ru: "Статистика и поездки", uz: "Statistika va safarlar" },
  options_menu: { ru: "Опции", uz: "Opsiyalar" },
  options_sub: { ru: "Доп. услуги вашей машины", uz: "Mashinangiz qo‘shimcha xizmatlari" },
  options_title: { ru: "Доп. опции", uz: "Qo‘shimcha opsiyalar" },
  options_hint: { ru: "Выключенную опцию можно видеть, но нельзя принять такой заказ", uz: "O‘chirilgan opsiyani ko‘rasiz, lekin bunday buyurtmani ololmaysiz" },
  options_empty: { ru: "Опции пока не настроены", uz: "Opsiyalar hali sozlanmagan" },
  saved: { ru: "Сохранено", uz: "Saqlandi" },
  news_menu: { ru: "Новости", uz: "Yangiliklar" },
  news_sub: { ru: "Объявления диспетчерской", uz: "Dispetcherlik e’lonlari" },
  ratings_count: { ru: "оценок", uz: "baho" },
  rating_label: { ru: "рейтинг", uz: "reyting" },
  rides_label: { ru: "поездок", uz: "safar" },
  balance_label_low: { ru: "баланс", uz: "balans" },
  logout: { ru: "Выйти из аккаунта", uz: "Hisobdan chiqish" },
  lang_ru: { ru: "Русский", uz: "Ruscha" },

  // ── wallet ──
  tx_income: { ru: "Доход", uz: "Daromad" },
  tx_commission: { ru: "Комиссия", uz: "Komissiya" },
  tx_bonus: { ru: "Бонус", uz: "Bonus" },
  tx_penalty: { ru: "Штраф", uz: "Jarima" },
  tx_penalties: { ru: "Штрафы", uz: "Jarimalar" },
  tx_bonuses: { ru: "Бонусы", uz: "Bonuslar" },
  tx_withdraw: { ru: "Вывод", uz: "Yechib olish" },
  tx_refund: { ru: "Возврат", uz: "Qaytarish" },
  filter_all: { ru: "Все", uz: "Hammasi" },
  filter_today: { ru: "Сегодня", uz: "Bugun" },
  filter_week: { ru: "Неделя", uz: "Hafta" },
  filter_month: { ru: "Месяц", uz: "Oy" },
  wallet_title: { ru: "Кошелёк", uz: "Hamyon" },
  topup: { ru: "Пополнить", uz: "To‘ldirish" },
  no_tx: { ru: "Нет операций", uz: "Amallar yo‘q" },
  topup_title: { ru: "Пополнение баланса", uz: "Balansni to‘ldirish" },
  topup_min: { ru: "Минимум 1000 сум и выберите карту", uz: "Eng kami 1000 so‘m va karta tanlang" },
  topup_failed: { ru: "Не удалось начать пополнение", uz: "To‘ldirishni boshlab bo‘lmadi" },
  topup_done: { ru: "Баланс пополнен", uz: "Balans to‘ldirildi" },
  wrong_code: { ru: "Неверный код", uz: "Noto‘g‘ri kod" },
  no_cards: { ru: "Нет привязанных карт. Привяжите карту в приложении.", uz: "Bog‘langan karta yo‘q. Ilovada karta bog‘lang." },
  get_code: { ru: "Получить код", uz: "Kod olish" },
  enter_sms: { ru: "Введите код из SMS", uz: "SMS kodini kiriting" },
  confirm: { ru: "Подтвердить", uz: "Tasdiqlash" },
  amount_sum: { ru: "Сумма (сум)", uz: "Summa (so‘m)" },

  // ── earnings ──
  earn_today: { ru: "Сегодня", uz: "Bugun" },
  earn_week: { ru: "Неделя", uz: "Hafta" },
  earn_month: { ru: "Месяц", uz: "Oy" },
  earn_rides: { ru: "Поездок", uz: "Safarlar" },
  earn_7days: { ru: "За 7 дней", uz: "7 kun ichida" },
  no_rides: { ru: "Нет поездок", uz: "Safarlar yo‘q" },
  earn_pick_date: { ru: "Выбрать дату", uz: "Sanani tanlash" },
  earn_all_dates: { ru: "Все даты", uz: "Barcha sanalar" },
  trip_detail: { ru: "Детали поездки", uz: "Safar tafsilotlari" },
  f_date: { ru: "Дата", uz: "Sana" },
  f_time: { ru: "Время", uz: "Vaqt" },
  f_tariff: { ru: "Тариф", uz: "Tarif" },
  f_route: { ru: "Маршрут", uz: "Yo‘nalish" },
  f_passengers: { ru: "Пассажиры", uz: "Yo‘lovchilar" },
  f_price: { ru: "Стоимость", uz: "Narx" },
  f_commission: { ru: "Комиссия", uz: "Komissiya" },
  f_income: { ru: "Ваш доход", uz: "Sizning daromadingiz" },
  f_status: { ru: "Статус", uz: "Holat" },

  // ── news ──
  news_one: { ru: "Новость", uz: "Yangilik" },
  news_read: { ru: "Прочитано", uz: "O‘qildi" },
  news_title: { ru: "Новости", uz: "Yangiliklar" },
  news_empty: { ru: "Нет новостей", uz: "Yangiliklar yo‘q" },

  // ── chat ──
  dispatcher: { ru: "Диспетчер", uz: "Dispetcher" },
  dispatch_center: { ru: "Диспетчерская", uz: "Dispetcherlik" },
  groups: { ru: "Группы", uz: "Guruhlar" },
  no_groups: { ru: "Нет групповых чатов", uz: "Guruh chatlari yo‘q" },
  members: { ru: "участников", uz: "a’zo" },
  typing: { ru: "печатает…", uz: "yozmoqda…" },
  online_low: { ru: "в сети", uz: "tarmoqda" },
  offline_low: { ru: "не в сети", uz: "tarmoqda emas" },
  no_messages: { ru: "Нет сообщений", uz: "Xabarlar yo‘q" },
  message_ph: { ru: "Сообщение…", uz: "Xabar…" },

  // ── notifications ──
  ntf_urgent: { ru: "Срочный заказ", uz: "Shoshilinch buyurtma" },
  ntf_assigned: { ru: "Заказ назначен", uz: "Buyurtma tayinlandi" },
  ntf_taken: { ru: "Заказ занят", uz: "Buyurtma band" },
  ntf_expired: { ru: "Заказ истёк", uz: "Buyurtma muddati tugadi" },
  ntf_sold: { ru: "Заказ продан", uz: "Buyurtma sotildi" },
  ntf_payment: { ru: "Платёж получен", uz: "To‘lov qabul qilindi" },
  ntf_banned: { ru: "Вы заблокированы", uz: "Siz bloklandingiz" },
  ntf_unbanned: { ru: "Доступ восстановлен", uz: "Kirish tiklandi" },

  // ── voice ──
  call_incoming: { ru: "Входящий звонок", uz: "Kiruvchi qo‘ng‘iroq" },
  call_dialing: { ru: "Звоним…", uz: "Qo‘ng‘iroq qilinmoqda…" },
  call_connecting: { ru: "Соединение…", uz: "Ulanmoqda…" },
  call_ended: { ru: "Звонок завершён", uz: "Qo‘ng‘iroq tugadi" },
  driver_role: { ru: "Водитель", uz: "Haydovchi" },

  // ── login ──
  login_title: { ru: "Вход для водителя", uz: "Haydovchi uchun kirish" },
  login_code: { ru: "Код водителя", uz: "Haydovchi kodi" },
  login_btn: { ru: "Войти", uz: "Kirish" },
  login_wrong: { ru: "Неверный код", uz: "Noto‘g‘ri kod" },

  // ── exit / status alerts ──
  status_failed: { ru: "Не удалось изменить статус", uz: "Holatni o‘zgartirib bo‘lmadi" },
  banned_title: { ru: "Вы заблокированы", uz: "Siz bloklandingiz" },
  photo_control: { ru: "Фотоконтроль", uz: "Foto nazorat" },

  // ── dispatcher WS notices + extra status ──
  order_removed: { ru: "Заказ снят", uz: "Buyurtma olib qo‘yildi" },
  order_removed_sub: { ru: "Диспетчер снял с вас заказ", uz: "Dispetcher buyurtmani sizdan oldi" },
  order_cancelled: { ru: "Заказ отменён", uz: "Buyurtma bekor qilindi" },
  order_cancelled_sub: { ru: "Заказ отменён диспетчером", uz: "Buyurtma dispetcher tomonidan bekor qilindi" },
  st_collecting: { ru: "Собирает клиентов", uz: "Mijozlar yig‘ilmoqda" },

  // ── common yes/no ──
  yes: { ru: "Да", uz: "Ha" },
  no: { ru: "Нет", uz: "Yo‘q" },
  on: { ru: "Вкл", uz: "Yoniq" },
  off: { ru: "Выкл", uz: "O‘chiq" },

  // ── settings ──
  settings_title: { ru: "Настройки", uz: "Sozlamalar" },
  font_size: { ru: "Размер шрифта", uz: "Shrift o‘lchami" },
  font_small: { ru: "Мелкий", uz: "Kichik" },
  font_medium: { ru: "Средний", uz: "O‘rta" },
  font_large: { ru: "Крупный", uz: "Katta" },
  theme_label: { ru: "Тема оформления", uz: "Mavzu" },
  theme_dark: { ru: "Тёмная", uz: "Tungi" },
  theme_light: { ru: "Светлая", uz: "Kunduzgi" },
  sounds_label: { ru: "Звуки уведомлений", uz: "Bildirishnoma ovozlari" },
  font_preview: { ru: "Пример текста", uz: "Matn namunasi" },

  // ── chat ──
  call_dispatcher: { ru: "Позвонить диспетчеру", uz: "Dispetcherga qo‘ng‘iroq" },

  // ── delete account / logout ──
  delete_account: { ru: "Удалить аккаунт", uz: "Hisobni o‘chirish" },
  delete_account_q: { ru: "Вы действительно хотите удалить аккаунт?", uz: "Rostdan ham hisobni o‘chirmoqchimisiz?" },
  logout_short: { ru: "Выйти", uz: "Chiqish" },

  // ── sell-order seat rows + confirm ──
  sell_front_row: { ru: "Передний ряд", uz: "Oldingi qator" },
  sell_back_row: { ru: "Задний ряд", uz: "Orqa qator" },
  sell_confirm_q: { ru: "Вы действительно хотите продать заказ?", uz: "Buyurtmani sotishni xohlaysizmi?" },
  sell_phone_optional: { ru: "Телефон клиента (необязательно)", uz: "Mijoz telefoni (ixtiyoriy)" },

  // ── sell-order screen (mirror web Marketplace sell form) ──
  sell_route: { ru: "Маршрут", uz: "Yo‘nalish" },
  sell_tariff: { ru: "Тариф", uz: "Tarif" },
  sell_seats: { ru: "Количество мест", uz: "Joylar soni" },
  sell_whole_car: { ru: "Вся машина", uz: "Butun mashina" },
  sell_price: { ru: "Цена", uz: "Narx" },
  sell_min: { ru: "Минимум", uz: "Eng kami" },
  sell_phone: { ru: "Телефон клиента", uz: "Mijoz telefoni" },
  sell_success: { ru: "Заказ выставлен на продажу!", uz: "Buyurtma sotuvga qo‘yildi!" },
  sell_no_routes: { ru: "Нет доступных маршрутов", uz: "Mavjud yo‘nalishlar yo‘q" },
} as const;

export type TKey = keyof typeof translations;

export function t(key: TKey, lang: Language): string {
  const entry = translations[key];
  return (entry?.[lang] ?? entry?.ru ?? key) as string;
}

// Hook form: re-renders when the language changes.
export function useT() {
  const lang = useSettingsStore((s) => s.language);
  return {
    lang,
    t: (key: TKey) => t(key, lang),
  };
}
