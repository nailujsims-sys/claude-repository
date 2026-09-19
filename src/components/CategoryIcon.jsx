import {
  Car,
  CircleDashed,
  GraduationCap,
  HeartPulse,
  House,
  ShoppingBag,
  Sparkles,
  Tag,
  Ticket,
  Utensils,
} from 'lucide-react'
import { categoryIconName } from '../lib/finance/categories'

// Das Icon einer Oberkategorie.
//
// EIN GLYPH, KEINE FARBE. Die Vorgabe ist an dieser Stelle ausdrücklich: es gibt
// keine Kategorie-Farbpalette. Neun Kategorien in neun Tönen wären neun
// Akzentfarben in einer App, die genau eine hat (§14) — und die Zuordnung
// „lila = Freizeit" müsste der Nutzer auswendig lernen, während das Icon sie
// zeigt. Die Farbe kommt deshalb vom Aufrufer über `className` und ist überall
// dieselbe.
//
// Die Zuordnung Slug → Glyph steht in src/config/finance.js als NAME, damit die
// Konfiguration Daten bleibt und kein React importiert. Diese Datei ist die
// einzige Stelle, die aus dem Namen eine Komponente macht.
const GLYPHS = {
  utensils: Utensils,
  'shopping-bag': ShoppingBag,
  car: Car,
  sparkles: Sparkles,
  house: House,
  ticket: Ticket,
  'heart-pulse': HeartPulse,
  'graduation-cap': GraduationCap,
  'circle-dashed': CircleDashed,
}

/**
 * @param {{slug?: string|null, size?: number, className?: string}} props
 */
export default function CategoryIcon({ slug = null, size = 18, className = '' }) {
  // Eine selbst angelegte Kategorie hat kein hinterlegtes Icon. Sie bekommt das
  // neutrale Etikett statt einer leeren Stelle — eine Zeile ohne Icon wäre in
  // einer Liste mit Icons die eine, die verrutscht aussieht.
  const Glyph = GLYPHS[categoryIconName(slug)] ?? Tag
  return <Glyph size={size} className={className} aria-hidden />
}
