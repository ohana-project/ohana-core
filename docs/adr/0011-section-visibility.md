# Allow owners to hide shared sections

Version 1.0 lets owners control the visibility of Journal, Calendar, and Wishlist sections for their space. Hiding a section removes it from the member interface while retaining its existing data; re-enabling the section makes that data available again according to the normal account permissions. This is a presentation and access setting, not deletion or archival.

A hide or show synchronises the way [ADR-0014](0014-revision-based-delta-sync.md) describes: the sections map travels on the space row inside the sync response, and no per-row tombstones are written for a hide.
