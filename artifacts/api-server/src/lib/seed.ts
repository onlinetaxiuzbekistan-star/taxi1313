import { db, usersTable, citiesTable, districtsTable, routesTable, settingsTable, rolesTable, permissionsTable, rolePermissionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

async function hashPw(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

const DEFAULT_SETTINGS: { key: string; value: string; category: string }[] = [
  { key: "auto_dispatch_enabled", value: "true", category: "dispatch" },
  { key: "offer_timeout_seconds", value: "30", category: "dispatch" },
  { key: "max_offers_per_round", value: "3", category: "dispatch" },
  { key: "driver_search_radius_km", value: "40", category: "dispatch" },
  { key: "time_window_minutes", value: "60", category: "dispatch" },
  { key: "queue_max_distance_km", value: "500", category: "dispatch" },
  { key: "queue_batch_size", value: "10", category: "dispatch" },
  { key: "batch_dispatch_enabled", value: "false", category: "dispatch" },
  { key: "batch_window_seconds", value: "90", category: "dispatch" },
  { key: "max_detour_km", value: "50", category: "routing" },
  { key: "max_detour_minutes", value: "40", category: "routing" },
  { key: "commission_percent", value: "10", category: "finance" },
  { key: "commission_fixed", value: "0", category: "finance" },
  { key: "min_balance_to_go_online", value: "0", category: "finance" },
  { key: "cancel_penalty_amount", value: "5000", category: "finance" },
  { key: "ignore_penalty_amount", value: "2000", category: "finance" },
  { key: "ban_duration_minutes", value: "30", category: "drivers" },
  { key: "ban_threshold_ignores", value: "3", category: "drivers" },
  { key: "milestone_bonus_amount", value: "50000", category: "finance" },
  { key: "milestone_interval", value: "100", category: "finance" },
  { key: "referral_bonus_inviter", value: "25000", category: "finance" },
  { key: "referral_bonus_invitee", value: "10000", category: "finance" },
  { key: "surge_enabled", value: "true", category: "pricing" },
  { key: "surge_demand_threshold", value: "5", category: "pricing" },
  { key: "surge_max_multiplier", value: "2.0", category: "pricing" },
  { key: "marketplace_enabled", value: "true", category: "market" },
  { key: "marketplace_max_listings", value: "20", category: "market" },
];

const CITIES_DATA: { nameRu: string; nameUz?: string; slug: string; lat: number; lng: number }[] = [
  { nameRu: "Ташкент", nameUz: "Toshkent", slug: "tashkent", lat: 41.2995, lng: 69.2401 },
  { nameRu: "Фергана", nameUz: "Farg'ona", slug: "fergana", lat: 40.3842, lng: 71.7871 },
  { nameRu: "Самарканд", nameUz: "Samarqand", slug: "samarkand", lat: 39.6542, lng: 66.9597 },
  { nameRu: "Бухара", nameUz: "Buxoro", slug: "bukhara", lat: 39.7681, lng: 64.4556 },
  { nameRu: "Андижан", nameUz: "Andijon", slug: "andijan", lat: 40.7829, lng: 72.3441 },
  { nameRu: "Наманган", nameUz: "Namangan", slug: "namangan", lat: 40.9983, lng: 71.6726 },
  { nameRu: "Нукус", nameUz: "Nukus", slug: "nukus", lat: 42.4628, lng: 59.6022 },
  { nameRu: "Коканд", nameUz: "Qo'qon", slug: "kokand", lat: 40.5286, lng: 70.9425 },
  { nameRu: "Навои", nameUz: "Navoiy", slug: "navoiy", lat: 40.0984, lng: 65.3691 },
  { nameRu: "Термез", nameUz: "Termiz", slug: "termez", lat: 37.2241, lng: 67.2783 },
  { nameRu: "Гулистан", nameUz: "Guliston", slug: "gulistan", lat: 40.4875, lng: 68.7842 },
  { nameRu: "Джизак", nameUz: "Jizzax", slug: "jizzakh", lat: 40.1158, lng: 67.8422 },
  { nameRu: "Ургенч", nameUz: "Urganch", slug: "urgench", lat: 41.5500, lng: 60.6333 },
  { nameRu: "Карши", nameUz: "Qarshi", slug: "qarshi", lat: 38.8600, lng: 65.7983 },
  { nameRu: "Маргилан", nameUz: "Marg'ilon", slug: "margilan", lat: 40.4677, lng: 71.7148 },
];

const DISTRICTS_DATA: { name: string; citySlug: string; extraCharge: number; lat?: number; lng?: number }[] = [
  { name: "Центр", citySlug: "tashkent", extraCharge: 0, lat: 41.2995, lng: 69.2401 },
  { name: "Чиланзар", citySlug: "tashkent", extraCharge: 5000, lat: 41.2828, lng: 69.2084 },
  { name: "Юнусабад", citySlug: "tashkent", extraCharge: 5000, lat: 41.3644, lng: 69.2843 },
  { name: "Мирзо-Улугбек", citySlug: "tashkent", extraCharge: 8000, lat: 41.3086, lng: 69.3344 },
  { name: "Яккасарай", citySlug: "tashkent", extraCharge: 3000, lat: 41.2833, lng: 69.2500 },
  { name: "Сергели", citySlug: "tashkent", extraCharge: 10000, lat: 41.2247, lng: 69.2242 },
  { name: "Учтепа", citySlug: "tashkent", extraCharge: 7000, lat: 41.2789, lng: 69.1864 },
  { name: "Алмазар", citySlug: "tashkent", extraCharge: 8000, lat: 41.3219, lng: 69.2203 },
  { name: "Бектемир", citySlug: "tashkent", extraCharge: 12000, lat: 41.2600, lng: 69.3300 },

  { name: "Центр", citySlug: "fergana", extraCharge: 0, lat: 40.3842, lng: 71.7871 },
  { name: "Маргилан", citySlug: "fergana", extraCharge: 10000, lat: 40.47, lng: 71.72 },
  { name: "Кува", citySlug: "fergana", extraCharge: 15000, lat: 40.52, lng: 71.94 },
  { name: "Риштан", citySlug: "fergana", extraCharge: 12000, lat: 40.36, lng: 71.28 },

  { name: "Центр", citySlug: "samarkand", extraCharge: 0, lat: 39.6542, lng: 66.9597 },
  { name: "Каттакурган", citySlug: "samarkand", extraCharge: 15000, lat: 39.90, lng: 66.26 },
  { name: "Ургут", citySlug: "samarkand", extraCharge: 12000, lat: 39.40, lng: 67.23 },
  { name: "Булунгур", citySlug: "samarkand", extraCharge: 10000, lat: 39.77, lng: 67.27 },

  { name: "Центр", citySlug: "bukhara", extraCharge: 0, lat: 39.7747, lng: 64.4286 },
  { name: "Когон", citySlug: "bukhara", extraCharge: 12000, lat: 39.722, lng: 64.5518 },
  { name: "Гиждуван", citySlug: "bukhara", extraCharge: 15000, lat: 40.1036, lng: 64.6839 },

  { name: "Центр", citySlug: "andijan", extraCharge: 0, lat: 40.7821, lng: 72.3442 },
  { name: "Асака", citySlug: "andijan", extraCharge: 10000, lat: 40.64, lng: 72.23 },
  { name: "Шахрихан", citySlug: "andijan", extraCharge: 8000, lat: 40.71, lng: 72.06 },

  { name: "Центр", citySlug: "namangan", extraCharge: 0, lat: 40.9983, lng: 71.6726 },
  { name: "Чуст", citySlug: "namangan", extraCharge: 10000, lat: 41.00, lng: 71.23 },
  { name: "Поп", citySlug: "namangan", extraCharge: 15000, lat: 40.87, lng: 71.10 },

  { name: "Центр", citySlug: "nukus", extraCharge: 0, lat: 42.4628, lng: 59.6022 },
  { name: "Ходжейли", citySlug: "nukus", extraCharge: 10000, lat: 42.40, lng: 59.45 },

  { name: "Центр", citySlug: "kokand", extraCharge: 0, lat: 40.5286, lng: 70.9425 },

  { name: "Центр", citySlug: "navoiy", extraCharge: 0, lat: 40.0984, lng: 65.3691 },
  { name: "Зарафшан", citySlug: "navoiy", extraCharge: 20000, lat: 41.57, lng: 64.19 },

  { name: "Центр", citySlug: "termez", extraCharge: 0, lat: 37.2241, lng: 67.2783 },
  { name: "Денау", citySlug: "termez", extraCharge: 15000, lat: 38.27, lng: 67.89 },

  { name: "Центр", citySlug: "gulistan", extraCharge: 0, lat: 40.4875, lng: 68.7842 },

  { name: "Центр", citySlug: "jizzakh", extraCharge: 0, lat: 40.1158, lng: 67.8422 },
  { name: "Дустлик", citySlug: "jizzakh", extraCharge: 10000, lat: 40.52, lng: 68.04 },

  { name: "Центр", citySlug: "urgench", extraCharge: 0, lat: 41.5500, lng: 60.6333 },
  { name: "Хива", citySlug: "urgench", extraCharge: 15000, lat: 41.38, lng: 60.36 },

  { name: "Центр", citySlug: "qarshi", extraCharge: 0, lat: 38.8600, lng: 65.7983 },
  { name: "Шахрисабз", citySlug: "qarshi", extraCharge: 20000, lat: 39.05, lng: 66.83 },

  { name: "Центр", citySlug: "margilan", extraCharge: 0, lat: 40.4677, lng: 71.7148 },
];

async function rehashAllPasswords(): Promise<void> {
  const knownPasswords: Record<string, string> = {
    "+998922222222": "driver123",
    "+998882015555": "driver123",
    "+998905365555": "driver123",
  };

  for (const [phone, pw] of Object.entries(knownPasswords)) {
    const [user] = await db.select({ id: usersTable.id, passwordHash: usersTable.passwordHash })
      .from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    if (user) {
      const freshHash = await bcrypt.hash(pw, 10);
      const verifyOk = await bcrypt.compare(pw, freshHash);
      await db.update(usersTable).set({ passwordHash: freshHash }).where(eq(usersTable.id, user.id));
      console.log(`[SEED] Re-hashed password for ${phone} (user ${user.id}), verify=${verifyOk}`);
    }
  }
}

async function seedCitiesAndDistricts(): Promise<void> {
  const existingCities = await db.select().from(citiesTable);
  const existingSlugs = new Set(existingCities.map(c => c.slug).filter(Boolean));
  const existingNames = new Set(existingCities.map(c => c.nameRu));

  const missingCities = CITIES_DATA.filter(c => !existingSlugs.has(c.slug) && !existingNames.has(c.nameRu));

  if (missingCities.length > 0) {
    await db.insert(citiesTable).values(missingCities);
    console.log(`[SEED] Inserted ${missingCities.length} missing cities`);
  }

  for (const existing of existingCities) {
    if (!existing.slug) {
      const match = CITIES_DATA.find(c => c.nameRu === existing.nameRu);
      if (match) {
        await db.update(citiesTable).set({ slug: match.slug }).where(eq(citiesTable.id, existing.id));
        console.log(`[SEED] Updated slug for city: ${existing.nameRu} → ${match.slug}`);
      }
    }
  }

  const allCities = await db.select().from(citiesTable);
  const [{ districtCount }] = await db.select({ districtCount: sql<number>`count(*)::int` }).from(districtsTable);

  if (districtCount === 0) {
    const districtValues = DISTRICTS_DATA.map(d => ({
      name: d.name,
      cityId: d.citySlug,
      extraCharge: d.extraCharge,
      lat: d.lat || null,
      lng: d.lng || null,
    }));
    await db.insert(districtsTable).values(districtValues);
    console.log(`[SEED] Inserted ${districtValues.length} districts`);
  }

  const [{ finalCityCount }] = await db.select({ finalCityCount: sql<number>`count(*)::int` }).from(citiesTable);
  const [{ finalDistrictCount }] = await db.select({ finalDistrictCount: sql<number>`count(*)::int` }).from(districtsTable);
  console.log(`[SEED] CITIES: ${finalCityCount}, DISTRICTS: ${finalDistrictCount}`);
}

export async function seedDatabase(): Promise<void> {
  try {
    await seedCitiesAndDistricts();

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable);
    if (count > 0) {
      console.log("[SEED] Database has", count, "users, re-hashing demo passwords...");
      await rehashAllPasswords();
      return;
    }

    console.log("[SEED] Empty database detected, seeding essential data...");

    const dispatcherHash = await hashPw("password");
    const driverHash = await hashPw("driver123");

    await db.insert(usersTable).values([
      {
        phone: "+998901234567",
        name: "Диспетчер Алишер",
        passwordHash: dispatcherHash,
        role: "dispatcher",
      },
      {
        phone: "+998922222222",
        name: "Санжар Исмоилов",
        passwordHash: driverHash,
        role: "driver",
        status: "offline",
        carBrand: "Chevrolet",
        carModel: "Gentra",
        carClass: "economy",
        city: "Ташкент",
      },
      {
        phone: "+998882015555",
        name: "Давлатбек Низомов",
        passwordHash: driverHash,
        role: "driver",
        status: "offline",
        carBrand: "Chevrolet",
        carModel: "Cobalt",
        carClass: "economy",
        city: "Фергана",
      },
      {
        phone: "+998905365555",
        name: "Давлат Низомов",
        passwordHash: driverHash,
        role: "driver",
        status: "offline",
        carBrand: "Chevrolet",
        carModel: "Lacetti",
        carClass: "economy",
        city: "Фергана",
      },
    ]);
    console.log("[SEED] Created 4 users (1 dispatcher + 3 drivers)");

    const [{ routeCount }] = await db.select({ routeCount: sql<number>`count(*)::int` }).from(routesTable);
    if (routeCount === 0) {
      const cities = await db.select().from(citiesTable);
      const getCity = (name: string) => cities.find(c => c.nameRu === name);
      const tashkent = getCity("Ташкент");
      const fergana = getCity("Фергана");
      const samarkand = getCity("Самарканд");
      const bukhara = getCity("Бухара");
      const andijan = getCity("Андижан");
      const namangan = getCity("Наманган");

      if (tashkent && fergana && samarkand && bukhara && andijan && namangan) {
        await db.insert(routesTable).values([
          { fromCity: tashkent.nameRu, toCity: fergana.nameRu, distanceKm: 300, durationMin: 300, priceEconomy: 120000, priceFrontEconomy: 150000, priceComfort: 180000, priceFrontComfort: 220000, isActive: true },
          { fromCity: tashkent.nameRu, toCity: samarkand.nameRu, distanceKm: 270, durationMin: 270, priceEconomy: 100000, priceFrontEconomy: 130000, priceComfort: 150000, priceFrontComfort: 180000, isActive: true },
          { fromCity: tashkent.nameRu, toCity: bukhara.nameRu, distanceKm: 450, durationMin: 390, priceEconomy: 170000, priceFrontEconomy: 200000, priceComfort: 250000, priceFrontComfort: 300000, isActive: true },
          { fromCity: tashkent.nameRu, toCity: andijan.nameRu, distanceKm: 350, durationMin: 330, priceEconomy: 140000, priceFrontEconomy: 170000, priceComfort: 200000, priceFrontComfort: 240000, isActive: true },
          { fromCity: tashkent.nameRu, toCity: namangan.nameRu, distanceKm: 320, durationMin: 310, priceEconomy: 130000, priceFrontEconomy: 160000, priceComfort: 190000, priceFrontComfort: 230000, isActive: true },
          { fromCity: fergana.nameRu, toCity: tashkent.nameRu, distanceKm: 300, durationMin: 300, priceEconomy: 120000, priceFrontEconomy: 150000, priceComfort: 180000, priceFrontComfort: 220000, isActive: true },
          { fromCity: samarkand.nameRu, toCity: tashkent.nameRu, distanceKm: 270, durationMin: 270, priceEconomy: 100000, priceFrontEconomy: 130000, priceComfort: 150000, priceFrontComfort: 180000, isActive: true },
          { fromCity: samarkand.nameRu, toCity: bukhara.nameRu, distanceKm: 270, durationMin: 240, priceEconomy: 100000, priceFrontEconomy: 130000, priceComfort: 150000, priceFrontComfort: 180000, isActive: true },
        ]);
        console.log("[SEED] Created 8 routes");
      }
    }

    const [{ settingsCount }] = await db.select({ settingsCount: sql<number>`count(*)::int` }).from(settingsTable);
    if (settingsCount === 0) {
      await db.insert(settingsTable).values(DEFAULT_SETTINGS);
      console.log(`[SEED] Created ${DEFAULT_SETTINGS.length} settings`);
    }

    const [{ roleCount }] = await db.select({ roleCount: sql<number>`count(*)::int` }).from(rolesTable);
    if (roleCount === 0) {
      await db.insert(rolesTable).values([
        { name: "Администратор", description: "Полный доступ ко всем функциям" },
        { name: "Диспетчер", description: "Стандартный диспетчер — заказы, водители, чат" },
        { name: "Оператор", description: "Только просмотр и создание заказов" },
      ]);
      console.log("[SEED] Created 3 roles");
    }

    const [{ permCount }] = await db.select({ permCount: sql<number>`count(*)::int` }).from(permissionsTable);
    if (permCount === 0) {
      const perms = [
        { key: "drivers.view", group: "Водители", label: "Просмотр водителей" },
        { key: "drivers.create", group: "Водители", label: "Создание водителей" },
        { key: "drivers.edit", group: "Водители", label: "Редактирование водителей" },
        { key: "orders.view", group: "Заказы", label: "Просмотр заказов" },
        { key: "orders.create", group: "Заказы", label: "Создание заказов" },
        { key: "orders.assign", group: "Заказы", label: "Назначение водителей" },
        { key: "orders.cancel", group: "Заказы", label: "Отмена заказов" },
        { key: "finance.view", group: "Финансы", label: "Просмотр финансов" },
        { key: "finance.edit", group: "Финансы", label: "Редактирование финансов" },
        { key: "archive.view", group: "Архив", label: "Просмотр архива" },
        { key: "settings.manage", group: "Настройки", label: "Управление настройками" },
        { key: "staff.view", group: "Сотрудники", label: "Просмотр сотрудников" },
        { key: "staff.manage", group: "Сотрудники", label: "Управление сотрудниками" },
        { key: "analytics.view", group: "Аналитика", label: "Просмотр аналитики" },
        { key: "chat.view", group: "Чат", label: "Просмотр чата" },
        { key: "map.view", group: "Карта", label: "Просмотр карты" },
        { key: "branches.manage", group: "Филиалы", label: "Управление филиалами" },
        { key: "addresses.manage", group: "Адреса", label: "Управление адресами" },
        { key: "districts.manage", group: "Районы", label: "Управление районами" },
        { key: "references.manage", group: "Справочники", label: "Управление справочниками" },
      ];
      await db.insert(permissionsTable).values(perms);
      console.log("[SEED] Created 20 permissions");
    }

    const [{ rpCount }] = await db.select({ rpCount: sql<number>`count(*)::int` }).from(rolePermissionsTable);
    if (rpCount === 0) {
      const roles = await db.select().from(rolesTable);
      const allPerms = await db.select().from(permissionsTable);

      const adminRole = roles.find(r => r.name === "Администратор");
      const dispRole = roles.find(r => r.name === "Диспетчер");
      const opRole = roles.find(r => r.name === "Оператор");

      const rpValues: { roleId: number; permissionId: number }[] = [];

      if (adminRole) {
        allPerms.forEach(p => rpValues.push({ roleId: adminRole.id, permissionId: p.id }));
      }

      if (dispRole) {
        const dispPerms = ["drivers.view", "drivers.create", "drivers.edit", "orders.view", "orders.create", "orders.assign", "orders.cancel", "finance.view", "archive.view", "staff.view", "analytics.view", "chat.view", "map.view", "branches.manage", "addresses.manage", "districts.manage", "references.manage"];
        allPerms.filter(p => dispPerms.includes(p.key)).forEach(p => rpValues.push({ roleId: dispRole.id, permissionId: p.id }));
      }

      if (opRole) {
        const opPerms = ["drivers.view", "orders.view", "orders.create"];
        allPerms.filter(p => opPerms.includes(p.key)).forEach(p => rpValues.push({ roleId: opRole.id, permissionId: p.id }));
      }

      if (rpValues.length > 0) {
        await db.insert(rolePermissionsTable).values(rpValues);
        console.log(`[SEED] Created ${rpValues.length} role-permission mappings`);
      }
    }

    await rehashAllPasswords();

    console.log("[SEED] Database seeding complete!");
    console.log("[SEED] Dispatcher: +998901234567 / password");
    console.log("[SEED] Drivers: +998922222222, +998882015555, +998905365555 / driver123");
  } catch (err: any) {
    console.error("[SEED] Error:", err.message);
  }
}
