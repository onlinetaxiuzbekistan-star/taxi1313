# Такси 1313 — Инструкция по установке на сервер

## Требования

- Ubuntu 20.04+ или Debian 11+
- Минимум 2 GB RAM, 20 GB диск
- Root-доступ к серверу

## Шаги установки

### 1. Скачайте проект из Replit

В Replit нажмите **три точки** → **Download as ZIP**

### 2. Загрузите ZIP на сервер

```bash
scp project.zip root@ВАШ_IP:/tmp/
```

### 3. Распакуйте проект

```bash
mkdir -p /opt/taxi1313
cd /opt/taxi1313
unzip /tmp/project.zip -d .
```

### 4. Запустите установочный скрипт

```bash
chmod +x deploy/install.sh
sudo bash deploy/install.sh
```

Скрипт автоматически:
- Установит Node.js 20, pnpm, PostgreSQL, Nginx
- Создаст базу данных
- Соберёт проект
- Настроит systemd сервисы
- Настроит Nginx

### 5. Запустите сервисы

```bash
systemctl start taxi1313-api
systemctl start taxi1313-web
systemctl start taxi1313-client
```

### 6. Откройте в браузере

```
http://ВАШ_IP
```

## Полезные команды

```bash
# Статус сервисов
systemctl status taxi1313-api
systemctl status taxi1313-web
systemctl status taxi1313-client

# Логи API сервера
journalctl -u taxi1313-api -f

# Перезапуск после обновления
systemctl restart taxi1313-api
systemctl restart taxi1313-web

# Остановка
systemctl stop taxi1313-api taxi1313-web taxi1313-client
```

## SSL (HTTPS)

Для настройки SSL с бесплатным сертификатом Let's Encrypt:

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d ваш-домен.com
```

## Обновление

1. Скачайте новый ZIP из Replit
2. Распакуйте в `/opt/taxi1313` (с заменой)
3. `cd /opt/taxi1313 && pnpm install && pnpm --filter @workspace/api-server run build && pnpm --filter @workspace/taxi-app run build`
4. `systemctl restart taxi1313-api taxi1313-web taxi1313-client`
