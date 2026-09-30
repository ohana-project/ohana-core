# Ohana

Ohana helps couples and families keep shared plans, wishes, and memories together.

## Language

### Spaces and people

**Space** (RU: пространство):
A shared place for a particular couple or family to keep its information. The same person can participate in different spaces using a separate member account in each.
_Avoid_: Family, couple, household (when naming the space rather than its members).

**Member** (RU: участник):
A person's account within exactly one space, including their role and personal state there. The same person has independent members in different spaces, with no shared identity between them.
_Avoid_: Global user, installation-wide user, cross-space membership, participant.

**Member role** (RU: роль участника):
The level of authority a member has in their space: owner or regular in version 1.0, with a child role planned later.
_Avoid_: Instance administrator (not a member role).

**Owner** (RU: владелец):
A member with the owner role, who administers their space: its members, section visibility, and access-code issuance. A space may have several owners. A space that has an owner never loses the last one: the owner role can be passed on, but not removed from the final owner.
_Avoid_: Instance administrator, admin.

**Regular member** (RU: обычный участник):
A member with the regular role, who uses the space's visible sections without administering the space.
_Avoid_: Participant role, user.

**Archived member** (RU: архивный участник):
A member removed from a space who can no longer sign in, but whose published history and attribution remain. An owner can restore them by issuing a new access code while their private state still exists.
_Avoid_: Deleted member, deleted account.

**Instance administrator** (RU: администратор инстанса):
The person responsible for an Ohana installation, who creates spaces, provisions members, and manages installation settings. The instance administrator is not a member of any space; to use a space they need a separately created member there.
_Avoid_: Owner, space owner, admin without qualification.

**Access code** (RU: код входа):
A one-time code issued by an owner or the instance administrator to sign in as a specific member. It expires after 24 hours, can be redeemed once, and can be replaced or revoked. Replacing the code preserves the member and all their data.
_Avoid_: Shared space password, global login code.

**Profile contact detail** (RU: контактные данные профиля):
An optional email address or phone number displayed as informational profile data to other members of the same space. Ohana does not use it for authentication, recovery, or notifications in version 1.0.
_Avoid_: Login identifier, recovery contact.

### Sections

**Section** (RU: раздел):
One of a space's shared areas, such as the Journal, Calendar, or Wishlist.
_Avoid_: Tab, module, feature (when referring to the member-facing area).

**Section visibility** (RU: видимость раздела):
A space setting that controls whether a section appears to members. Hiding a section does not delete its existing data.
_Avoid_: Feature deletion, data removal.

### Journal

**Journal entry** (RU: запись дневника):
A member's record of an experience or thought, which can include text and images. An entry is always in exactly one state: draft, published, or trashed.
_Avoid_: Post, note.

**Draft** (RU: черновик):
The state of a journal entry that is visible only to its author. A published entry cannot return to draft in version 1.0.
_Avoid_: Shared entry, separate draft object.

**Published entry** (RU: опубликованная запись):
The state of a journal entry that is shared with every member of the space. Only its author can edit it.
_Avoid_: Draft.

**Trashed entry** (RU: запись в корзине):
The state of a journal entry that has been removed but is retained for recovery until its permanent-deletion date. A trashed draft remains visible only to its author.
_Avoid_: Permanently deleted entry.

### Wishlist

**Wishlist** (RU: виш-лист):
A member's collection of their own wishes, visible to the other members of the space.
_Avoid_: Gift favorites (which are private to a member).

**Wish** (RU: пожелание):
Something a member would like for themselves, recorded in their wishlist.
_Avoid_: Shared household purchase.

**Gift favorite** (RU: избранная идея подарка):
A member's private bookmark of someone else's wish as a possible gift. Other members never see it, and it does not reserve the wish.
_Avoid_: Shared favorite, gift reservation.

**Gift reservation** (RU: бронь подарка):
A member's claim that they intend to give a particular wish, visible to every member except the wish's author, so that relatives do not buy the same gift.
_Avoid_: Gift favorite, purchase.

**Received wish** (RU: полученное пожелание):
A wish its author has marked as received. It is no longer an open wish.
_Avoid_: Deleted wish, fulfilled reservation.

### Calendar

**Calendar event** (RU: событие календаря):
A planned activity or significant date shared in a space's calendar, occurring once or on a repeating schedule.
_Avoid_: Reminder (the event exists independently of its notifications).

**Event occurrence** (RU: отдельное событие серии):
A particular instance of a repeating calendar event that can be changed independently of the rest of the series.
_Avoid_: Entire series (when referring to a single instance).

**Reminder recipient** (RU: получатель напоминания):
A member selected by an event's creator to receive its reminders. Being able to see an event does not automatically make a member a recipient.
_Avoid_: Event viewer.

**Calendar reminder** (RU: напоминание о событии):
A notification that alerts a member about an upcoming or due event in their space.
_Avoid_: Event (the reminder concerns an event but is not the event itself).
