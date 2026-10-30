CREATE TABLE map_hexes (
    id SERIAL PRIMARY KEY,
    q INT NOT NULL,
    r INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    type VARCHAR(50) NOT NULL,
    CONSTRAINT unique_max_hex_coords UNIQUE (q, r)
);

CREATE TABLE educational_institutions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL
);

CREATE TABLE institution_classes (
    id SERIAL PRIMARY KEY,
    institution_id INT REFERENCES educational_institutions(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    grade_level INT NOT NULL
);

CREATE INDEX idx_max_hexes_coords ON map_hexes(q, r);
CREATE INDEX idx_max_institutions_geo ON educational_institutions(latitude, longitude);

ALTER TABLE map_hexes ENABLE ROW LEVEL SECURITY;
ALTER TABLE educational_institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_classes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow Max App read access to hexes" ON map_hexes FOR SELECT USING (true);
CREATE POLICY "Allow Max App read access to institutions" ON educational_institutions FOR SELECT USING (true);
CREATE POLICY "Allow Max App read access to classes" ON institution_classes FOR SELECT USING (true);
