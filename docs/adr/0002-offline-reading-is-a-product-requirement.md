# Offline reading is a product requirement

Ohana must let users read previously downloaded information without a network connection; client caching is therefore a user-facing capability rather than only a performance optimization. Version 1.0 covers the journal, calendar, and wishlist. Documents and loyalty cards are scheduled for version 1.1.

Version 1.0 automatically retains synchronized journal text, calendar data, and wishlist data for offline reading. Photographs use cached viewing previews; original photographs are not automatically downloaded in bulk. Offline access is read-only.

The interface makes synchronization and connectivity visible, including during sign-in. It distinguishes initial synchronization, synchronization in progress, up-to-date data, offline operation, server unavailability, and synchronization errors as applicable. Show the last successful synchronization time and a retry action when relevant; already available cached information remains readable during a refresh or connection failure. Synchronization status belongs to the selected member. A device with no downloaded data must not claim that information is available offline.

Document downloads in version 1.1 are an explicit per-device choice: a user selects Save offline and sees whether the selected document is available without a connection on that device. Cache budgets, privacy on logout, and behavior after access revocation remain implementation details to specify within these product boundaries.
