# Битва Классов

Геймифицированное приложение для MAX: классы зарабатывают Очки Действия (ОД) за учёбу и тратят их на захват
гексов на карте школы. Аудит прототипа и обоснование архитектуры — в [AUDIT.md](AUDIT.md).

## Архитектура

```
MAX бот (maxapi) ──┐  X-Service-Key
MAX WebApp ─ nginx ┴─► FastAPI backend ─► PostgreSQL
(Leaflet + Canvas)       правила игры, транзакции, ежедневный доход ОД
```

| Каталог | Назначение |
|---|---|
| `backend/` | FastAPI: авторизация, генерация карты, захват, начисление ОД. Единственный писатель в БД |
| `bot/` | Бот: регистрация, профиль, рейтинг, выдача ОД кураторами |
| `frontend/` | Карта (статика за nginx, `/api` проксируется в backend) |
| `db/init.sql` | Схема и демо-данные |

## Быстрый старт

```bash
cp .env.example .env      # заполнить секреты
docker compose up --build
```

Карта: http://localhost:8080 (локально для отладки без MAX: `DEV_MODE=1` и `?dev_user=123`).
Для MAX WebApp нужен публичный HTTPS-адрес (например, Cloudflare Tunnel на порт 8080) — укажите его в `WEBAPP_URL`.

Первичный вход: в боте «Авторизация» → роль. Куратор/админ — по коду из `.env`. Куратор начисляет ОД классу.

## Правила (см. `backend/app/rules.py`)

- Цена захвата = `ceil((20 + 40·value) · 1.5^d · (1.5 для вражеского))`; `d` — расстояние до ближайшего своего гекса.
- Каждый гекс приносит `daily_points` ОД в сутки владельцу (начисление раз в день, идемпотентно).
- Домашние гексы не захватываются.

## API

`GET /api/institutions/{id}/map` · `GET /api/me` · `POST /api/register` · `GET /api/hexes/{id}/quote` ·
`POST /api/hexes/{id}/capture` · `POST /api/classes/{id}/grant` · `GET /api/institutions/{id}/leaderboard` ·
`POST /api/institutions/{id}/reset` (админ) · `GET /api/health`

## Тесты

```bash
pip install pytest && pytest backend/tests
```

## Безопасность

- Секреты только в `.env`; БД недоступна снаружи compose; RLS закрывает таблицы для anon-ключей Supabase.
- Подпись `initData` проверяется на сервере — **сверьте алгоритм с актуальной документацией MAX Bridge**.
- Имена полей событий `maxapi` собраны в хелперах `callback_user/message_user/message_text` в `bot/main.py`;
  при другой версии библиотеки правится только там.
