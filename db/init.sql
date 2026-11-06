-- Битва Классов: схема БД (PostgreSQL 14+; совместимо с Supabase).
-- Выполняется автоматически при первом старте контейнера db.
-- Для Supabase: выполнить в SQL Editor; backend подключать через DATABASE_URL (роль postgres).

CREATE TABLE educational_institutions (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    address         TEXT NOT NULL DEFAULT '',
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    outline_radius_m INT NOT NULL DEFAULT 100,
    hex_radius_m    DOUBLE PRECISION,              -- заполняется при генерации карты
    grid_generated  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE institution_classes (
    id              SERIAL PRIMARY KEY,
    institution_id  INT NOT NULL REFERENCES educational_institutions(id) ON DELETE CASCADE,
    name            VARCHAR(50) NOT NULL,
    grade_level     INT NOT NULL,
    color           VARCHAR(7) NOT NULL DEFAULT '#42a5f5',
    ap_balance      INT NOT NULL DEFAULT 0 CHECK (ap_balance >= 0),   -- Очки Действия
    UNIQUE (institution_id, name)
);

CREATE TABLE app_users (
    max_user_id     BIGINT PRIMARY KEY,
    display_name    VARCHAR(100) NOT NULL DEFAULT '',
    role            VARCHAR(20) NOT NULL CHECK (role IN ('schoolboy','student','curator','admin')),
    class_id        INT REFERENCES institution_classes(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE map_hexes (
    id              SERIAL PRIMARY KEY,
    institution_id  INT NOT NULL REFERENCES educational_institutions(id) ON DELETE CASCADE,
    q               INT NOT NULL,
    r               INT NOT NULL,
    lat             DOUBLE PRECISION NOT NULL,
    lng             DOUBLE PRECISION NOT NULL,
    owner_class_id  INT REFERENCES institution_classes(id) ON DELETE SET NULL,
    is_home         BOOLEAN NOT NULL DEFAULT FALSE,
    value           REAL NOT NULL DEFAULT 0,
    daily_points    INT NOT NULL DEFAULT 1,
    CONSTRAINT unique_hex_coords UNIQUE (institution_id, q, r)
);

-- Журнал движения ОД: баланс класса всегда = сумма delta (для аудита и разбора споров)
CREATE TABLE ap_ledger (
    id              BIGSERIAL PRIMARY KEY,
    class_id        INT NOT NULL REFERENCES institution_classes(id) ON DELETE CASCADE,
    delta           INT NOT NULL,
    reason          VARCHAR(30) NOT NULL,          -- grant | capture | daily_income
    hex_id          INT REFERENCES map_hexes(id) ON DELETE SET NULL,
    actor_user_id   BIGINT,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Защита от двойного начисления дохода при нескольких репликах/рестартах
CREATE TABLE income_runs (
    run_date        DATE PRIMARY KEY
);

CREATE INDEX idx_hexes_inst ON map_hexes (institution_id);
CREATE INDEX idx_hexes_owner ON map_hexes (owner_class_id);
CREATE INDEX idx_classes_inst ON institution_classes (institution_id);
CREATE INDEX idx_ledger_class ON ap_ledger (class_id, created_at DESC);

-- RLS: включён и политик нет → anon/authenticated ключи Supabase не видят и не меняют ничего.
-- Backend ходит под владельцем БД (обходит RLS). Клиенты работают ТОЛЬКО через /api.
ALTER TABLE educational_institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_classes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_hexes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap_ledger                ENABLE ROW LEVEL SECURITY;
ALTER TABLE income_runs              ENABLE ROW LEVEL SECURITY;

-- Демо-данные (Хабаровск; центр карты из DEFAULT_CENTER прототипа)
INSERT INTO educational_institutions (name, address, latitude, longitude) VALUES
    ('Школа №1', 'Хабаровск (демо)', 48.4805, 135.0795),
    ('Гимназия №5', 'Хабаровск (демо)', 48.4700, 135.0600);

INSERT INTO institution_classes (institution_id, name, grade_level, color) VALUES
    (1, '10-А', 10, '#ef5350'), (1, '10-Б', 10, '#42a5f5'),
    (1, '11-А', 11, '#66bb6a'), (1, '11-Б', 11, '#ffa726'),
    (2, '9-А',   9, '#ab47bc'), (2, '9-Б',   9, '#26c6da'),
    (2, '10-А', 10, '#ec407a'), (2, '10-Б', 10, '#8d6e63');

-- Стартовые ОД, чтобы демо можно было играть сразу
UPDATE institution_classes SET ap_balance = 300;
