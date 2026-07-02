const CATEGORIES = [
    { key: 'red', label: 'Rot', color: '#ff5722' },
    { key: 'yellow', label: 'Gelb', color: '#ffdf00' },
    { key: 'green', label: 'Grün', color: '#a1db58' }
];

/** Anzeige: ab 1000 als „1,0k“, „1,2k“ usw. (eine Nachkommastelle, deutsches Komma) */
export function formatCompactCount(n) {
    if (n < 1000) return String(n);
    return `${(n / 1000).toFixed(1).replace('.', ',')}k`;
}

/** Liest Rot/Gelb/Grün aus Entity — Felder kommen später aus der API */
export function progressFromEntity(entity) {
    return {
        red: Number(entity?.sr_red ?? entity?.red ?? 0) || 0,
        yellow: Number(entity?.sr_yellow ?? entity?.yellow ?? 0) || 0,
        green: Number(entity?.sr_green ?? entity?.green ?? 0) || 0
    };
}

export function renderMiniBars(host, data) {
    if (!host) return;

    const max = Math.max(data.red, data.yellow, data.green, 1);
    const ariaLabel = `Fortschritt: Rot ${data.red}, Gelb ${data.yellow}, Grün ${data.green}`;

    const cols = CATEGORIES.map(cat => {
        const n = data[cat.key];
        const h = Math.max(2, Math.round((n / max) * 100));
        return `<div class="progress-mini-bars__col" title="${cat.label}: ${n}">
            <span class="progress-mini-bars__n">${formatCompactCount(n)}</span>
            <div class="progress-mini-bars__bar" style="height:${h}%; background:${cat.color}"></div>
        </div>`;
    }).join('');

    host.className = 'sr-progress-bars progress-mini-bars';
    host.setAttribute('role', 'img');
    host.setAttribute('aria-label', ariaLabel);
    host.innerHTML = cols;
}
