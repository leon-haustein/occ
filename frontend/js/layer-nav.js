/**
 * Klick auf .cards-manage-btn → Ziel-URL von getTargetHref().
 */
// Exportiert die Funktion, damit Page-Skripte (kurse, themen, karten, kartenverwaltung) sie importieren können.
export function setupCardsManageBtn(getTargetHref) {
    // Sucht im aktuellen HTML-Dokument den ersten Button mit der Klasse „cards-manage-btn“.
    const btn = document.querySelector('.cards-manage-btn');
    // Beendet die Funktion still, wenn auf dieser Seite kein solcher Button vorhanden ist.
    if (!btn) return;
    // Registriert einen Klick-Handler auf dem Button.
    btn.addEventListener('click', () => {
        // Ruft die vom Aufrufer übergebene Funktion auf, um die Ziel-URL zu ermitteln.
        const href = getTargetHref();
        // Navigiert nur dann weiter, wenn eine gültige URL zurückgegeben wurde (nicht null/leer).
        if (href) window.location.href = href;
    });
}