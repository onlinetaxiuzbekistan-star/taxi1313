#!/bin/bash
set -e

echo "============================================="
echo "  Такси 1313 — Установка на сервер"
echo "============================================="
echo ""

APP_DIR="/opt/taxi1313"
DB_NAME="taxi1313"
DB_USER="taxi1313"
DB_PASS=$(openssl rand -hex 16)
SESSION_SECRET=$(openssl rand -hex 32)
NODE_VERSION="20"

if [ "$EUID" -ne 0 ]; then
  echo "Запустите скрипт от root: sudo bash install.sh"
  exit 1
fi

echo "[1/8] Обновление системы..."
apt-get update -y && apt-get upgrade -y

echo "[2/8] Установка Node.js ${NODE_VERSION}..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
fi
echo "Node.js: $(node -v)"

echo "[3/8] Установка pnpm..."
npm install -g pnpm
echo "pnpm: $(pnpm -v)"

echo "[4/8] Установка PostgreSQL..."
if ! command -v psql &> /dev/null; then
  apt-get install -y postgresql postgresql-contrib
fi
systemctl enable postgresql
systemctl start postgresql

echo "[5/8] Настройка базы данных..."
su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'\" | grep -q 1 || psql -c \"CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';\""
su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\" | grep -q 1 || psql -c \"CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};\""
su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};\""

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"

echo "[6/8] Установка Nginx..."
apt-get install -y nginx
systemctl enable nginx

echo "[7/8] Настройка проекта..."
if [ ! -d "$APP_DIR" ]; then
  echo "ВАЖНО: Скопируйте файлы проекта в ${APP_DIR}"
  echo "  1. Скачайте ZIP из Replit"
  echo "  2. Распакуйте: unzip project.zip -d ${APP_DIR}"
  echo "  3. Запустите этот скрипт снова"
  mkdir -p "$APP_DIR"
fi

if [ -f "${APP_DIR}/pnpm-workspace.yaml" ]; then
  cd "$APP_DIR"

  cat > .env <<EOF
DATABASE_URL=${DATABASE_URL}
SESSION_SECRET=${SESSION_SECRET}
NODE_ENV=production
PORT=3000
CLIENT_PORT=3001
EOF

  echo "Установка зависимостей..."
  pnpm install --frozen-lockfile || pnpm install

  echo "Сборка проектов..."
  echo "  [install.sh] SKIPPED db:push to protect prod data; use psql for migrations"
  pnpm --filter @workspace/api-server run build || echo "API build пропущен"
  pnpm --filter @workspace/taxi-app run build || echo "Taxi app build пропущен"
  pnpm --filter @workspace/client-app run build || echo "Client app build пропущен"
else
  echo "Файлы проекта не найдены в ${APP_DIR}"
  echo "Скопируйте проект и запустите скрипт снова."
fi

echo "[8/8] Создание systemd сервисов..."

cat > /etc/systemd/system/taxi1313-api.service <<EOF
[Unit]
Description=Taxi 1313 API Server
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/node ${APP_DIR}/artifacts/api-server/dist/index.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/taxi1313-web.service <<EOF
[Unit]
Description=Taxi 1313 Web App (Dispatcher + Driver)
After=network.target taxi1313-api.service

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}/artifacts/taxi-app
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/npx serve -s dist -l 3001
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/taxi1313-client.service <<EOF
[Unit]
Description=Taxi 1313 Client App
After=network.target taxi1313-api.service

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}/artifacts/client-app
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/npx serve -s dist -l 3002
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

cat > /etc/nginx/sites-available/taxi1313 <<'EOF'
server {
    listen 80;
    server_name _;

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }

    # WebSocket
    location /api/ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    # Dispatcher + Driver app
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        try_files $uri $uri/ /index.html;
    }

    # Client booking app
    location /client/ {
        proxy_pass http://127.0.0.1:3002/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

ln -sf /etc/nginx/sites-available/taxi1313 /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo ""
echo "============================================="
echo "  Установка завершена!"
echo "============================================="
echo ""
echo "Данные подключения к БД:"
echo "  DATABASE_URL=${DATABASE_URL}"
echo "  SESSION_SECRET=${SESSION_SECRET}"
echo ""
echo "Запуск сервисов:"
echo "  systemctl start taxi1313-api"
echo "  systemctl start taxi1313-web"
echo "  systemctl start taxi1313-client"
echo ""
echo "Проверка статуса:"
echo "  systemctl status taxi1313-api"
echo "  systemctl status taxi1313-web"
echo "  systemctl status taxi1313-client"
echo ""
echo "Логи:"
echo "  journalctl -u taxi1313-api -f"
echo ""
echo "Откройте в браузере: http://ВАШ_IP"
echo "============================================="
