/**
 * The calendar module's public surface: what the composition root mounts
 * and wires — the member-facing routes, the sync contributor (issue #20),
 * and the reminder worker handlers the buildWorker composition root
 * registers (issue #22). All else is the module's interior; tests import
 * it directly.
 */

export {
  CALENDAR_QUEUE_SETUPS,
  CALENDAR_REMINDER_JOB,
  CALENDAR_REMINDER_SWEEP_CRON,
  CALENDAR_REMINDER_SWEEP_JOB,
  CALENDAR_SENT_QUEUES,
  type CalendarReminderJobData,
  type CalendarReminderJobsDeps,
  extendReminderHorizons,
  sendDueCalendarReminder,
} from './jobs.ts'
export { calendarRoutes } from './routes.ts'
export { CALENDAR_EVENT_SYNC_ENTITY, calendarSyncContributor } from './sync.ts'
