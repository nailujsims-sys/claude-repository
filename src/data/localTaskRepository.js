import { buildTaskRow, pickWritable } from './taskDefaults'
import { seedTasks } from '../lib/seed'

// localStorage-backed implementation of the task repository. Used when Supabase
// is not configured, so the app is fully functional offline. The stored shape
// is identical to the Supabase `tasks` table, making the two interchangeable.

const keyFor = (userId) => `mw.tasks.${userId}`

function read(userId) {
  try {
    const raw = localStorage.getItem(keyFor(userId))
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore corrupt storage
  }
  // First run: seed demo data.
  const seeded = seedTasks().map((row) => buildTaskRow(userId, row))
  write(userId, seeded)
  return seeded
}

function write(userId, tasks) {
  localStorage.setItem(keyFor(userId), JSON.stringify(tasks))
}

export const localTaskRepository = {
  async listTasks(userId) {
    return read(userId).sort((a, b) => a.sort_order - b.sort_order)
  },

  async createTask(userId, data) {
    const tasks = read(userId)
    const row = buildTaskRow(userId, data)
    tasks.push(row)
    write(userId, tasks)
    return row
  },

  async updateTask(userId, id, patch) {
    const tasks = read(userId)
    const idx = tasks.findIndex((t) => t.id === id)
    if (idx === -1) throw new Error('Task not found')
    const updated = {
      ...tasks[idx],
      ...pickWritable(patch),
      updated_at: new Date().toISOString(),
    }
    tasks[idx] = updated
    write(userId, tasks)
    return updated
  },

  // Batch sort_order/due updates for drag-and-drop reordering.
  async reorderTasks(userId, updates) {
    const tasks = read(userId)
    for (const { id, ...patch } of updates) {
      const idx = tasks.findIndex((t) => t.id === id)
      if (idx !== -1) {
        tasks[idx] = {
          ...tasks[idx],
          ...pickWritable(patch),
          updated_at: new Date().toISOString(),
        }
      }
    }
    write(userId, tasks)
    return tasks
  },
}
