import {
  Add01Icon,
  AlertCircleIcon,
  ArchiveIcon,
  BirthdayCakeIcon,
  Bookmark01Icon,
  Calendar03Icon,
  Camera01Icon,
  Cancel01Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Clock01Icon,
  CloudOffIcon,
  Copy01Icon,
  CrownIcon,
  Delete02Icon,
  Download04Icon,
  Edit02Icon,
  GiftIcon,
  GlobeIcon,
  HeartIcon,
  Home01Icon,
  Image01Icon,
  InformationCircleIcon,
  LicenseDraftIcon,
  LockIcon,
  Logout01Icon,
  Mail01Icon,
  Moon02Icon,
  MoreHorizontalIcon,
  NotebookIcon,
  Notification01Icon,
  NotificationOff01Icon,
  PhoneArrowDownIcon,
  PreferenceHorizontalIcon,
  RefreshIcon,
  RepeatIcon,
  RotateLeft01Icon,
  Search01Icon,
  SentIcon,
  ServerIcon,
  Share08Icon,
  Shield01Icon,
  SmartPhone01Icon,
  StarIcon,
  Sun03Icon,
  Tick01Icon,
  UserIcon,
  UserMultipleIcon,
  ViewIcon,
  ViewOffIcon,
  WifiOff01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { cn } from '@/lib/cn'

/*
 * The Ohana icon set: Hugeicons Free, stroke-rounded (docs/design/
 * README.md, "Iconography"). The prototype reuses the phone glyph for
 * install, so install gets the phone-with-arrow instead. Everything in
 * the app renders icons through this wrapper so the 1.5 stroke holds.
 */
const icons = {
  home: Home01Icon,
  book: NotebookIcon,
  calendar: Calendar03Icon,
  gift: GiftIcon,
  user: UserIcon,
  users: UserMultipleIcon,
  heart: HeartIcon,
  bookmark: Bookmark01Icon,
  camera: Camera01Icon,
  image: Image01Icon,
  plus: Add01Icon,
  check: Tick01Icon,
  x: Cancel01Icon,
  'chevron-left': ChevronLeftIcon,
  'chevron-right': ChevronRightIcon,
  'chevron-down': ChevronDownIcon,
  'more-h': MoreHorizontalIcon,
  sync: RefreshIcon,
  'cloud-off': CloudOffIcon,
  'wifi-off': WifiOff01Icon,
  bell: Notification01Icon,
  'bell-off': NotificationOff01Icon,
  repeat: RepeatIcon,
  clock: Clock01Icon,
  globe: GlobeIcon,
  sun: Sun03Icon,
  moon: Moon02Icon,
  trash: Delete02Icon,
  restore: RotateLeft01Icon,
  archive: ArchiveIcon,
  copy: Copy01Icon,
  lock: LockIcon,
  shield: Shield01Icon,
  crown: CrownIcon,
  download: Download04Icon,
  share: Share08Icon,
  search: Search01Icon,
  send: SentIcon,
  edit: Edit02Icon,
  'log-out': Logout01Icon,
  settings: PreferenceHorizontalIcon,
  alert: AlertCircleIcon,
  info: InformationCircleIcon,
  'file-text': LicenseDraftIcon,
  star: StarIcon,
  eye: ViewIcon,
  'eye-off': ViewOffIcon,
  install: PhoneArrowDownIcon,
  cake: BirthdayCakeIcon,
  phone: SmartPhone01Icon,
  mail: Mail01Icon,
  server: ServerIcon,
} as const satisfies Record<string, IconSvgElement>

export type IconName = keyof typeof icons

interface IconProps extends Omit<React.ComponentProps<'svg'>, 'name' | 'children' | 'strokeWidth'> {
  name: IconName
  /**
   * Rendered size in px. Omitted, the icon takes the size its context
   * dictates: a container's `[&_svg:not([class*='size-'])]` sizing
   * rule where one exists (button, menu item, list row media, pill,
   * empty-state plate…), the parent's font size (1em) otherwise.
   */
  size?: number
}

export function Icon({ name, size, className, style, ...rest }: IconProps) {
  return (
    <HugeiconsIcon
      icon={icons[name]}
      aria-hidden="true"
      size={size}
      className={cn(size === undefined && 'h-[1em] w-[1em]', 'shrink-0', className)}
      style={size === undefined ? style : { width: size, height: size, ...style }}
      {...rest}
      strokeWidth={1.5}
    />
  )
}
