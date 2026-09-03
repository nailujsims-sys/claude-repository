import {
  Bike,
  BookOpen,
  Briefcase,
  Camera,
  Car,
  ClipboardList,
  Coffee,
  Dumbbell,
  Film,
  GraduationCap,
  Gift,
  Heart,
  Home,
  Music,
  Palmtree,
  PawPrint,
  Plane,
  Shirt,
  ShoppingCart,
  Sparkles,
  Star,
  User,
  Utensils,
  Wallet,
} from 'lucide-react'
import { DEFAULT_TEMPLATE, listTemplate } from './listTemplates'

// ── Icons ───────────────────────────────────────────────────────────────────
//
// A curated set, not an icon browser: 24 symbols in a 6-column grid is four
// rows the eye takes in at once, and every one of them names something a
// personal list is actually about. They come from lucide-react, the library the
// app already uses everywhere — no second icon source, no icon database.
//
// Deliberately monochrome. Blue is the app's only accent (§14), so an icon is
// `text-text-secondary` at rest and accent when it is the selected one; there
// is no per-list colour to choose and none to store.
export const LIST_ICONS = [
  { id: 'clipboard-list', label: 'Checkliste', icon: ClipboardList },
  { id: 'shopping-cart', label: 'Einkauf', icon: ShoppingCart },
  { id: 'user', label: 'Person', icon: User },
  { id: 'gift', label: 'Geschenk', icon: Gift },
  { id: 'plane', label: 'Reise', icon: Plane },
  { id: 'home', label: 'Zuhause', icon: Home },
  { id: 'book', label: 'Buch', icon: BookOpen },
  { id: 'heart', label: 'Herz', icon: Heart },
  { id: 'music', label: 'Musik', icon: Music },
  { id: 'camera', label: 'Kamera', icon: Camera },
  { id: 'star', label: 'Favorit', icon: Star },
  { id: 'utensils', label: 'Essen', icon: Utensils },
  { id: 'car', label: 'Auto', icon: Car },
  { id: 'paw', label: 'Haustier', icon: PawPrint },
  { id: 'wallet', label: 'Geld', icon: Wallet },
  { id: 'coffee', label: 'Café', icon: Coffee },
  { id: 'palmtree', label: 'Urlaub', icon: Palmtree },
  { id: 'dumbbell', label: 'Sport', icon: Dumbbell },
  { id: 'bike', label: 'Fahrrad', icon: Bike },
  { id: 'briefcase', label: 'Arbeit', icon: Briefcase },
  { id: 'graduation-cap', label: 'Studium', icon: GraduationCap },
  { id: 'shirt', label: 'Kleidung', icon: Shirt },
  { id: 'film', label: 'Film', icon: Film },
  { id: 'sparkles', label: 'Ideen', icon: Sparkles },
]

const ICON_BY_ID = new Map(LIST_ICONS.map((entry) => [entry.id, entry]))

// A row whose icon key is not in the set (removed here, written by a newer
// version) renders its template's icon instead of an empty box.
export function listIcon(id, template = DEFAULT_TEMPLATE.id) {
  return (
    ICON_BY_ID.get(id)?.icon ||
    ICON_BY_ID.get(listTemplate(template).icon)?.icon ||
    ClipboardList
  )
}
