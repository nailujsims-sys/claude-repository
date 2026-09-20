import { merchantInitials, merchantLogo } from '../config/merchantLogos'

// Das runde Bild neben einem Händlernamen.
//
// ZWEI STUFEN, IN DIESER REIHENFOLGE:
//
//   1. ein Logo, das in diesem Repository liegt (src/config/merchantLogos.js)
//   2. die Initialen des Namens
//
// Und ausdrücklich keine dritte: kein Logo-Dienst, kein Favicon-Abruf, keine
// Anfrage an irgendetwas, das nicht zu dieser App gehört. Ein Avatar ist
// Dekoration; die Einkaufsliste des Nutzers an einen Dritten zu schicken, um sie
// zu bekommen, wäre keine.
//
// DIE INITIALEN SIND EINFARBIG. Ein Logo darf seine Markenfarben behalten — das
// ist der Sinn eines Logos, und es ist die eine Ausnahme von §14. Eine
// generierte Farbe pro Händler wäre dagegen genau das, was die Vorgabe an den
// Kategorien ausschließt: eine Palette, die niemand entschieden hat. Also
// `bg-bg-input` wie jede andere ruhige Fläche dieser App.
//
// Größen sind Tokens, keine Zahlen am Aufrufort: drei Größen decken die drei
// Stellen ab, an denen es diesen Avatar gibt (Händlerliste, größte Ausgaben,
// Kopfzeile eines Händlers), und eine vierte kommt hinzu, wenn es eine vierte
// Stelle gibt.
const SIZES = {
  sm: { box: 'h-8 w-8', text: 'text-caption' },
  md: { box: 'h-10 w-10', text: 'text-body' },
  lg: { box: 'h-14 w-14', text: 'text-section' },
}

/**
 * @param {{
 *   merchant?: {canonical_name?: string}|null,
 *   name?: string|null,
 *   size?: 'sm'|'md'|'lg',
 *   className?: string,
 * }} props
 */
export default function MerchantAvatar({
  merchant = null,
  name = null,
  size = 'md',
  className = '',
}) {
  const label = merchant?.canonical_name ?? name ?? ''
  const logo = merchantLogo(label)
  const dimensions = SIZES[size] ?? SIZES.md

  if (logo) {
    return (
      <span
        className={`grid shrink-0 place-items-center overflow-hidden rounded-full ${dimensions.box} ${className}`}
        style={logo.background ? { backgroundColor: logo.background } : undefined}
      >
        <img src={logo.src} alt={logo.alt ?? label} className="h-full w-full object-contain" />
      </span>
    )
  }

  return (
    <span
      // `aria-hidden`: der Name steht in derselben Zeile daneben. Ein
      // Screenreader, der „R E · REWE" vorliest, sagt dasselbe zweimal.
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full bg-bg-input font-semibold text-text-secondary ${dimensions.box} ${dimensions.text} ${className}`}
    >
      {merchantInitials(label)}
    </span>
  )
}
