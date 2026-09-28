# Deliver calendar reminders through Web Push

Version 1.0 includes calendar reminders delivered through standard Web Push on supported devices with the member's permission. Accept the external browser or operating-system push infrastructure while keeping the Ohana application and its data self-hosted. This enables reminders outside an open web page without requiring native mobile clients.

Reminders are scheduled for server-side sending; exact display time is not guaranteed, and the feature is not an offline alarm. Connectivity, permission, message expiration, and device settings affect delivery. Version 1.0 supports one configurable reminder per event; multiple reminders and per-recipient schedules are deferred.

All members can view shared calendar events. The event creator selects reminder recipients from accounts in that space, individually or by selecting everyone; visibility alone does not automatically subscribe a member to reminders. Version 1.0 includes one-time events and simple daily, weekly, monthly, and yearly recurrence. Recurrence is stored as an RFC 5545 RRULE with per-date exceptions, and version 1.0 accepts only the subset matching those four frequencies; this keeps later iCalendar export and synchronisation with Google and Apple calendars possible without migrating event data. Users can change one occurrence without changing the rest, or change the entire series. Editing this and all following occurrences is deferred.

A timed event retains its time zone, initially taken from the space settings. Devices display the corresponding local time with a clear zone indication. All-day events retain their calendar date rather than shifting it when viewed from another time zone.

Notification text is composed by the worker, so each member's interface language is stored with the member rather than only in the browser. Notifications use neutral wording by default. A member may opt into displaying event details on a particular device. Platform requirements and primary sources are recorded in [the foundation research](../research/foundation-constraints.md#calendar-reminders-with-web-push).
