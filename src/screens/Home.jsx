import { useCallback, useState } from 'react'
import TopBar from '../components/TopBar'
import EventDetailSheet from '../components/EventDetailSheet'
import { useEvents } from '../context/EventsContext'
import { useTasks } from '../context/TasksContext'
import HomeGreeting from './home/HomeGreeting'
import AgendaCard from './home/AgendaCard'
import TasksCard from './home/TasksCard'

// ── Heute ───────────────────────────────────────────────────────────────────
//
// The screen is a composition and nothing else: the greeting block, then one
// card per subject, in the order they are needed — what day it is, what is on
// today, what is still open. Each card owns its data and its interactions, so a
// later block is added here as one more line and cannot disturb the two that
// exist.
//
// Both lists live inside their own height budget (`HomeCard` → `ScrollList`),
// which is what keeps this an overview: the page has one shape whether the day
// holds two events or twenty, and the two lists scroll past each other
// independently instead of pushing each other down the page.
//
// Nothing here is new chrome. The bar is the global `TopBar`, the rows are the
// app's own `TaskRow`, and tapping an event opens the same `EventDetailSheet`
// the calendar opens — the screen is a new arrangement of the product, not a
// second version of it.
export default function Home() {
  const { events, loading: eventsLoading } = useEvents()
  const { tasks, loading: tasksLoading } = useTasks()
  const [selectedEvent, setSelectedEvent] = useState(null)

  const selectEvent = useCallback((ev) => setSelectedEvent(ev), [])

  return (
    <>
      <TopBar title="Heute" />

      <div className="px-5 pb-28">
        <HomeGreeting />

        <div className="space-y-3">
          <AgendaCard
            events={events}
            loading={eventsLoading}
            onSelect={selectEvent}
          />
          <TasksCard tasks={tasks} loading={tasksLoading} />
        </div>
      </div>

      {/* The same sheet the calendar uses, owned by the screen that opens it —
          `onReopen` is what lets a sheet that was flicked away be caught on its
          way out (G16). */}
      <EventDetailSheet
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onReopen={selectEvent}
      />
    </>
  )
}
