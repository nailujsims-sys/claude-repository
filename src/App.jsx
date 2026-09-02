import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { resolveAuthPhase } from './lib/auth'
import { ToastProvider } from './context/ToastContext'
import { UIProvider } from './context/UIContext'
import { TasksProvider } from './context/TasksContext'
import { EventsProvider } from './context/EventsContext'
import { GoogleProvider } from './context/GoogleContext'

import BottomNav from './components/BottomNav'
import Sidebar from './components/Sidebar'
import ActionSheet from './components/ActionSheet'
import TaskForm from './components/TaskForm'
import EventForm from './components/EventForm'
import ToastHost from './components/ToastHost'
import ErrorBanner from './components/ErrorBanner'

import Home from './screens/Home'
import TasksList from './screens/TasksList'
import TaskDetail from './screens/TaskDetail'
import Kalender from './screens/Kalender'
import Mehr from './screens/Mehr'
import Profil from './screens/Profil'
import ProfilGoogle from './screens/ProfilGoogle'
import Version from './screens/Version'
import Login from './screens/Login'
import NewPassword from './screens/NewPassword'
import BackendMissing from './screens/BackendMissing'

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </AuthProvider>
  )
}

// The security boundary of the whole app. Nothing that can read or write
// personal data is even mounted until Supabase has said who this is: the data
// providers live *inside* the signed-in branch, so there is no path where a
// repository runs without a user id.
function Gate() {
  const { status, user, recovery, isConfigured } = useAuth()
  const phase = resolveAuthPhase({ configured: isConfigured, status, user, recovery })

  if (phase === 'backend-missing') {
    return (
      <div className="app-frame bg-bg-base">
        <BackendMissing />
      </div>
    )
  }

  if (phase === 'loading') {
    return (
      <div className="app-frame grid min-h-screen place-items-center bg-bg-base">
        <p className="text-ui text-text-secondary">Lädt…</p>
      </div>
    )
  }

  if (phase === 'login') {
    return (
      <div className="app-frame bg-bg-base">
        <Login />
      </div>
    )
  }

  if (phase === 'recovery') {
    return (
      <div className="app-frame bg-bg-base">
        <NewPassword />
      </div>
    )
  }

  return (
    <UIProvider>
      <TasksProvider>
        <EventsProvider>
          {/* Inside the signed-in branch like every other data provider, for
              the same reason: it reads personal rows and must never run
              without a user id. */}
          <GoogleProvider>
            <AppShell />
          </GoogleProvider>
        </EventsProvider>
      </TasksProvider>
    </UIProvider>
  )
}

function AppShell() {
  const location = useLocation()

  return (
    <div className="app-frame bg-bg-base">
      <ErrorBanner />

      {/* Routed screen content. Keyed by path for a subtle enter transition. */}
      <main key={location.pathname} className="page">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/aufgaben" element={<TasksList />} />
          <Route path="/aufgaben/:id" element={<TaskDetail />} />
          <Route path="/kalender" element={<Kalender />} />
          <Route path="/mehr" element={<Mehr />} />
          <Route path="/profil" element={<Profil />} />
          <Route path="/profil/google-kalender" element={<ProfilGoogle />} />
          <Route path="/version" element={<Version />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Persistent chrome + global overlays */}
      <BottomNav />
      <Sidebar />
      <ActionSheet />
      <TaskForm />
      <EventForm />
      <ToastHost />
    </div>
  )
}
