const maxApp = window.Max || (window.parent && window.parent.Max);

if (maxApp && typeof maxApp.ready === 'function') {
    maxApp.ready();
}

function applyMaxTheme() {
    const theme = (maxApp && maxApp.themeParams) || {};
    
    document.documentElement.style.setProperty('--max-bg-color', theme.bg_color || '#ffffff');
    document.documentElement.style.setProperty('--max-text-color', theme.text_color || '#111111');
    document.documentElement.style.setProperty('--max-accent-color', theme.accent_color || '#4A90E2');
    document.documentElement.style.setProperty('--max-hint-color', theme.hint_color || '#8E8E93');
}
applyMaxTheme();


const SUPABASE_URL = 'https://supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


const map = L.map('map').setView([55.7558, 37.6173], 12);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);

function calculateHexGeometry(q, r, size = 0.005) {
    const centerLat = r * size * 1.5 + 55.7558;
    const centerLng = (q + r / 2) * size * Math.sqrt(3) + 37.6173;
    const corners = [];

    for (let i = 0; i < 6; i++) {
        const angleRad = (60 * i * Math.PI) / 180;
        corners.push([
            centerLat + size * Math.sin(angleRad) * 0.6, 
            centerLng + size * Math.cos(angleRad)
        ]);
    }
    return { corners, center: [centerLat, centerLng] };
}

async function loadMapHexesFromDB() {
    try {
        const { data: hexes, error } = await supabase
            .from('map_hexes')
            .select('q, r, name, status, type');

        if (error) throw error;

        const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--max-accent-color').trim();

        hexes.forEach(hex => {
            const hexGeo = calculateHexGeometry(hex.q, hex.r);
            
            L.polygon(hexGeo.corners, {
                color: accentColor,
                weight: 1.5,
                fillColor: hex.type === 'resource' ? '#34C759' : '#FF9500',
                fillOpacity: 0.3
            })
            .addTo(map)
            .bindPopup(`<b>${hex.name}</b><br>Тип: ${hex.type}`);
        });

    } catch (err) {
        console.error('Ошибка получения гексов для Макс-приложения:', err.message);
    }
}

async function loadInstitutionsWithClassesFromDB() {
    const listContainer = document.getElementById('schools-container');
    
    try {
        const { data: institutions, error } = await supabase
            .from('educational_institutions')
            .select(`
                id, 
                name, 
                address, 
                latitude, 
                longitude,
                institution_classes ( id, name, grade_level )
            `);

        if (error) throw error;
        if (!listContainer) return;

        listContainer.innerHTML = '';

        institutions.forEach(institution => {
            const marker = L.marker([institution.latitude, institution.longitude]).addTo(map);
            marker.bindPopup(`<b>${institution.name}</b>`);

            const card = document.createElement('div');
            card.className = 'school-card';
            
            const badges = institution.institution_classes
                .map(cls => `<span class="max-class-badge">${cls.name}</span>`)
                .join('');

            card.innerHTML = `
                <div class="school-name">${institution.name}</div>
                <div class="school-address">${institution.address}</div>
                <div class="classes-container">${badges}</div>
            `;

            card.addEventListener('click', () => {
                map.setView([institution.latitude, institution.longitude], 15);
                marker.openPopup();
                
                if (maxApp && typeof maxApp.sendNotification === 'function') {
                    maxApp.sendNotification('Выбрана школа: ' + institution.name);
                }
            });

            listContainer.appendChild(card);
        });

    } catch (err) {
        if (listContainer) listContainer.innerHTML = 'Ошибка подключения к базе данных Макса.';
        console.error('Ошибка запроса институтов:', err.message);
    }
}

loadMapHexesFromDB();
loadInstitutionsWithClassesFromDB();
