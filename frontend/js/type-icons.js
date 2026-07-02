// Symbole für die vier Flashcard-Typen (currentColor, damit sie sich an Hover/Invertierung anpassen)
export const TYPE_ICONS = {
    standard: `<svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" fill="none" stroke="currentColor" stroke-width="2"/>
        <circle cx="8.5" cy="9.5" r="2" fill="currentColor"/>
        <circle cx="15.5" cy="9.5" r="2" fill="none" stroke="currentColor" stroke-width="2"/>
        <line x1="7" y1="15.5" x2="17" y2="15.5" stroke="currentColor" stroke-width="2"/>
    </svg>`,
    prozess: `<svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="6" cy="5" r="2.2" fill="currentColor"/>
        <circle cx="6" cy="12" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/>
        <circle cx="6" cy="19" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/>
        <line x1="6" y1="7.2" x2="6" y2="9.4" stroke="currentColor" stroke-width="2"/>
        <line x1="6" y1="14.2" x2="6" y2="16.4" stroke="currentColor" stroke-width="2"/>
        <line x1="11" y1="5" x2="21" y2="5" stroke="currentColor" stroke-width="2"/>
        <line x1="11" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="2"/>
        <line x1="11" y1="19" x2="21" y2="19" stroke="currentColor" stroke-width="2"/>
    </svg>`,
    mnemo: `<svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="11" height="7" rx="3.5" fill="none" stroke="currentColor" stroke-width="2"/>
        <rect x="10" y="13" width="11" height="7" rx="3.5" fill="currentColor"/>
    </svg>`,
    oklusion: `<svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" fill="none" stroke="currentColor" stroke-width="2"/>
        <line x1="6" y1="9" x2="18" y2="9" stroke="currentColor" stroke-width="2"/>
        <rect x="6" y="12.5" width="12" height="4.5" fill="currentColor"/>
    </svg>`
};

export function typeIconKey(typ) {
    const key = String(typ || '').toLowerCase();
    return TYPE_ICONS[key] ? key : '';
}

export function typeIcon(typ) {
    return TYPE_ICONS[typeIconKey(typ)] || '';
}
