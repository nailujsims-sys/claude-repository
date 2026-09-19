// Die drei Felder, aus denen ein Konto besteht — an genau einer Stelle.
//
// WARUM SIE HIER LIEGEN. Bis v1.24 gab es ein Kontoformular, und es steckte
// mitten im FinanceAccountPicker: „Neues Konto", zwischen zwei Buchungen, ohne
// den Flow zu verlassen. v1.25 braucht dieselben drei Felder ein zweites Mal —
// beim Bearbeiten in der Kontoverwaltung. Zwei Formulare für dieselben drei
// Felder wären zwei Wahrheiten über Feldlängen, Platzhalter und die Frage, ob
// die Bank optional ist; spätestens beim dritten Aufrufer stimmen sie nicht
// mehr überein.
//
// Die Komponente hält KEINEN Zustand und entscheidet nichts. Sie zeigt drei
// Eingaben und meldet, was getippt wurde — wer sie benutzt, hält den Entwurf,
// prüft ihn (src/lib/finance/accounts.js) und speichert.
export default function FinanceAccountFields({
  name,
  onName,
  provider,
  onProvider,
  currency,
  onCurrency,
  // Die Währung eines Kontos mit Historie ist nicht mehr frei (§3). Gesperrt
  // statt versteckt: ein Feld, das verschwindet, sieht aus wie ein Fehler —
  // eines, das dasteht und nicht reagiert, braucht den Satz daneben, und den
  // liefert `currencyHint`.
  currencyLocked = false,
  currencyHint = null,
  autoFocus = false,
  disabled = false,
}) {
  return (
    <>
      <input
        autoFocus={autoFocus}
        value={name}
        onChange={(e) => onName?.(e.target.value)}
        placeholder="Name, z. B. Girokonto"
        maxLength={120}
        aria-label="Name des Kontos"
        disabled={disabled}
        className="w-full rounded-input bg-bg-input px-4 py-3.5 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
      />

      <div className="mt-3 flex gap-2">
        <input
          value={provider}
          onChange={(e) => onProvider?.(e.target.value)}
          placeholder="Bank (optional)"
          maxLength={80}
          aria-label="Bank oder Anbieter"
          disabled={disabled}
          className="min-w-0 flex-1 rounded-input bg-bg-input px-4 py-3.5 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
        />
        <input
          value={currency}
          onChange={(e) => onCurrency?.(e.target.value.toUpperCase().slice(0, 3))}
          aria-label="Währung"
          disabled={disabled || currencyLocked}
          readOnly={currencyLocked}
          className={`w-[84px] shrink-0 rounded-input bg-bg-input px-3 py-3.5 text-center text-field tabular-nums outline-none ring-1 ring-transparent focus:ring-accent ${
            currencyLocked ? 'text-text-muted' : 'text-text-primary'
          }`}
        />
      </div>

      {currencyLocked && currencyHint && (
        <p className="mt-2 px-1 text-caption text-text-secondary">{currencyHint}</p>
      )}
    </>
  )
}
