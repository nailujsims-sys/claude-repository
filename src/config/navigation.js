import {
  Home,
  Calendar,
  CheckSquare,
  MoreHorizontal,
  FolderKanban,
  GraduationCap,
  Dumbbell,
  Sparkles,
  ShoppingCart,
  Sunrise,
  Users,
  Brain,
  LineChart,
  ClipboardList,
  CalendarPlus,
  Info,
  UserCircle,
} from 'lucide-react'

// ── Bottom navigation ──────────────────────────────────────────────────────
// 5 fixed slots. The center slot is the Plus action button. Add/replace items
// by editing this array — BottomNav renders whatever it finds.
export const bottomNav = [
  { id: 'home', label: 'heute', icon: Home, to: '/' },
  { id: 'calendar', label: 'Kalender', icon: Calendar, to: '/kalender' },
  { id: 'plus', type: 'plus' },
  { id: 'tasks', label: 'Aufgaben', icon: CheckSquare, to: '/aufgaben' },
  { id: 'more', label: 'Mehr', icon: MoreHorizontal, to: '/mehr' },
]

// ── Sidebar (hamburger) primary links ──────────────────────────────────────
// `enabled: false` renders the row greyed out (module not built yet).
export const sidebarNav = [
  { id: 'home', label: 'Heute', icon: Home, to: '/', enabled: true },
  { id: 'tasks', label: 'Aufgaben', icon: CheckSquare, to: '/aufgaben', enabled: true },
  { id: 'calendar', label: 'Kalender', icon: Calendar, to: '/kalender', enabled: true },
  { id: 'more', label: 'Mehr', icon: MoreHorizontal, to: '/mehr', enabled: true },
  { id: 'profil', label: 'Profil', icon: UserCircle, to: '/profil', enabled: true },
  { id: 'version', label: 'Version', icon: Info, to: '/version', enabled: true },
]

// ── Future modules (preview of where the app is going) ──────────────────────
// Shown greyed-out with a "Demnächst" badge on /mehr and at the foot of the
// sidebar. Build a module: add its route, then flip it into the lists above.
export const futureModules = [
  { id: 'projekte', label: 'Projekte', icon: FolderKanban },
  { id: 'studienplaner', label: 'Studienplaner', icon: GraduationCap },
  { id: 'fitness', label: 'Fitness', icon: Dumbbell },
  { id: 'prompts', label: 'Prompt-Datenbank', icon: Sparkles },
  { id: 'einkaufsliste', label: 'Einkaufsliste', icon: ShoppingCart },
  { id: 'morning', label: 'Morning Dashboard', icon: Sunrise },
  { id: 'crm', label: 'Personal CRM', icon: Users },
  { id: 'secondbrain', label: 'Second Brain', icon: Brain },
  { id: 'watchlist', label: 'Finanz-Watchlist', icon: LineChart },
]

// ── Plus action sheet ───────────────────────────────────────────────────────
// `action` is resolved by the ActionSheet component. Add rows here as new
// creation flows arrive (Neuer Termin, Neue Notiz, …).
export const actionSheetItems = [
  { id: 'new-task', label: 'Neue Aufgabe', icon: ClipboardList, action: 'task' },
  { id: 'new-event', label: 'Neuer Termin', icon: CalendarPlus, action: 'event' },
]
