import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdminLayout } from '@/app/layouts/admin-layout.tsx'
import { MemberLayout } from '@/app/layouts/member-layout.tsx'
import { type ThemeChoice, useTheme } from '@/app/theme.tsx'
import { LanguageSwitcher } from '@/features/language/language-switcher.tsx'
import { AccessCodeInput } from '@/ui/access-code-input.tsx'
import { ActionBar } from '@/ui/action-bar.tsx'
import { AuthFrame } from '@/ui/auth-frame.tsx'
import { Avatar } from '@/ui/avatar.tsx'
import { AvatarStack } from '@/ui/avatar-stack.tsx'
import { Badge } from '@/ui/badge.tsx'
import { Banner } from '@/ui/banner.tsx'
import { Button } from '@/ui/button.tsx'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/ui/card.tsx'
import { CodeDisplay } from '@/ui/code-display.tsx'
import { CountBadge } from '@/ui/count-badge.tsx'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui/dialog.tsx'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/ui/drawer.tsx'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu.tsx'
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { ErrorState } from '@/ui/error-state.tsx'
import { Fab } from '@/ui/fab.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/ui/field.tsx'
import { Icon, type IconName } from '@/ui/icon.tsx'
import { Input } from '@/ui/input.tsx'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/ui/item.tsx'
import { NoteBlock } from '@/ui/note-block.tsx'
import { PickRow } from '@/ui/pick-row.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover.tsx'
import { SectionHeader } from '@/ui/section-header.tsx'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/ui/sheet.tsx'
import { Skeleton } from '@/ui/skeleton.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { Switch } from '@/ui/switch.tsx'
import { type SyncState, SyncStatus } from '@/ui/sync-status.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs.tsx'
import { Textarea } from '@/ui/textarea.tsx'
import { toast } from '@/ui/toast.tsx'
import { Toggle } from '@/ui/toggle.tsx'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group.tsx'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/tooltip.tsx'

/* The demo entry date, formatted for the active locale. */
function demoDate(language: string): string {
  return new Intl.DateTimeFormat(language, { day: '2-digit', month: '2-digit' }).format(
    new Date(2026, 8, 28),
  )
}

/* The row heights the prototypes use inline, as size variants (issue #58). */
const ROW_HEIGHTS = [
  { size: 'sm', pixels: '52px', icon: 'cake', titleKey: 'designPreview.lists.eventOne' },
  { size: 'default', pixels: '56px', icon: 'clock', titleKey: 'designPreview.lists.eventTwo' },
  { size: 'md', pixels: '60px', icon: 'calendar', titleKey: 'designPreview.lists.eventThree' },
  { size: 'lg', pixels: '64px', icon: 'gift', titleKey: 'designPreview.lists.giftIdeas' },
  { size: 'xl', pixels: '68px', icon: 'heart', titleKey: 'designPreview.lists.paddedTitle' },
] as const

export const Route = createFileRoute('/design')({ component: DesignPreview })

/* The «Наша семья» demo world: every preview string and mark. */
const HUES = { anya: 60, dima: 145, misha: 25, luda: 340 } as const

function DesignPreview() {
  const { t } = useTranslation()

  return (
    <TooltipProvider>
      <div className="mx-auto flex max-w-[var(--content-w)] flex-col gap-14 px-(--pad) py-10 pb-24">
        <header className="flex flex-col gap-4">
          <p className="text-meta font-mono text-muted-foreground uppercase">/design</p>
          <h1 className="text-display">{t('designPreview.title')}</h1>
          <p className="max-w-[70ch] text-body text-muted-foreground">{t('designPreview.intro')}</p>
          <div className="flex flex-wrap items-center gap-6">
            <ThemeSwitch />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-muted-foreground">
                {t('designPreview.languageLabel')}
              </span>
              <LanguageSwitcher />
            </div>
          </div>
        </header>

        <TokensSection />
        <TypographySection />
        <ButtonsSection />
        <InputsSection />
        <OverlaysSection />
        <BadgesSection />
        <ControlsSection />
        <FeedbackSection />
        <ListsSection />
        <PiecesSection />
        <LayoutsSection />
      </div>
    </TooltipProvider>
  )
}

function PreviewSection({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="flex flex-col gap-5">
      <h2 className="text-h1 border-b border-border pb-3">{title}</h2>
      {children}
    </section>
  )
}

function ThemeSwitch() {
  const { t } = useTranslation()
  const { choice, setTheme } = useTheme()
  const options: { value: ThemeChoice; icon: IconName; label: string }[] = [
    { value: 'light', icon: 'sun', label: t('designPreview.theme.light') },
    { value: 'dark', icon: 'moon', label: t('designPreview.theme.dark') },
    { value: 'system', icon: 'repeat', label: t('designPreview.theme.system') },
  ]

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-muted-foreground">
        {t('designPreview.themeLabel')}
      </span>
      <ToggleGroup
        value={[choice]}
        onValueChange={(values) => setTheme((values[0] ?? 'system') as ThemeChoice)}
        aria-label={t('designPreview.themeLabel')}
      >
        {options.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value} aria-label={option.label}>
            <Icon name={option.icon} className="size-3.5" />
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

/* ── tokens ─────────────────────────────────────────────────────── */

const SWATCHES: { token: string; labelKey: string }[] = [
  { token: '--bg', labelKey: 'swatchBg' },
  { token: '--surface', labelKey: 'swatchSurface' },
  { token: '--surface-2', labelKey: 'swatchSurface2' },
  { token: '--fg', labelKey: 'swatchFg' },
  { token: '--muted', labelKey: 'swatchMuted' },
  { token: '--border', labelKey: 'swatchBorder' },
  { token: '--accent', labelKey: 'swatchAccent' },
  { token: '--accent-fg', labelKey: 'swatchAccentFg' },
  { token: '--ok', labelKey: 'swatchOk' },
  { token: '--warn', labelKey: 'swatchWarn' },
  { token: '--danger', labelKey: 'swatchDanger' },
  { token: '--accent-soft', labelKey: 'swatchAccentSoft' },
  { token: '--fg-soft', labelKey: 'swatchFgSoft' },
  { token: '--scrim', labelKey: 'swatchScrim' },
]

function TokensSection() {
  const { t } = useTranslation()

  return (
    <PreviewSection id="tokens" title={t('designPreview.sections.tokens')}>
      <h3 className="text-h3">{t('designPreview.tokens.colour')}</h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
        {SWATCHES.map(({ token, labelKey }) => (
          <figure key={token} className="flex flex-col gap-1.5">
            <div
              className="h-14 rounded-md border border-border"
              style={{ background: `var(${token})` }}
            />
            <figcaption className="font-mono text-meta text-muted-foreground">
              {t(`designPreview.tokens.${labelKey}`)}
              <br />
              {token}
            </figcaption>
          </figure>
        ))}
      </div>

      <h3 className="text-h3 mt-4">{t('designPreview.tokens.radius')}</h3>
      <div className="flex flex-wrap items-center gap-4">
        {(['sm', 'md', 'lg', 'xl', 'full'] as const).map((radius) => (
          <div
            key={radius}
            className={`h-16 w-16 border-2 border-primary bg-primary-soft ${
              radius === 'full' ? 'rounded-full' : `rounded-${radius}`
            }`}
          />
        ))}
      </div>

      <h3 className="text-h3 mt-4">{t('designPreview.tokens.shadows')}</h3>
      <div className="flex flex-wrap gap-8">
        {(['1', '2', '3'] as const).map((level) => (
          <div
            key={level}
            className={`grid h-20 w-32 place-items-center rounded-lg bg-card font-mono text-meta text-muted-foreground shadow-${level}`}
          >
            shadow-{level}
          </div>
        ))}
      </div>
    </PreviewSection>
  )
}

function TypographySection() {
  const { t } = useTranslation()

  return (
    <PreviewSection id="typography" title={t('designPreview.sections.typography')}>
      <div className="flex flex-col gap-4">
        <p className="text-display">
          {t('designPreview.type.display')}: {t('designPreview.demo.greeting')}
        </p>
        <h1>
          {t('designPreview.type.h1')}: {t('designPreview.lists.cardTitle')}
        </h1>
        <h2>
          {t('designPreview.type.h2')}: {t('designPreview.lists.eventOne')}
        </h2>
        <h3>
          {t('designPreview.type.h3')}: {t('designPreview.lists.eventThree')}
        </h3>
        <p>
          {t('designPreview.type.body')}: {t('designPreview.lists.cardText')}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('designPreview.type.sm')}: {t('designPreview.demo.membersLabel')}
        </p>
        <p className="font-mono text-meta text-muted-foreground uppercase">
          {t('designPreview.type.meta')}: {t('designPreview.type.sample')}
        </p>
      </div>
    </PreviewSection>
  )
}

/* ── buttons ────────────────────────────────────────────────────── */

function ButtonsSection() {
  const { t } = useTranslation()

  return (
    <PreviewSection id="buttons" title={t('designPreview.sections.buttons')}>
      <div className="flex flex-wrap items-center gap-3">
        <Button>{t('designPreview.buttons.primary')}</Button>
        <Button variant="secondary">{t('designPreview.buttons.secondary')}</Button>
        <Button variant="ghost">{t('designPreview.buttons.ghost')}</Button>
        <Button variant="destructive">{t('designPreview.buttons.destructive')}</Button>
        <Button variant="link">{t('designPreview.buttons.link')}</Button>
        {/* a small link stays an sm button (.btn-sm follows .btn-link) —
            the app's update banner ships that combination */}
        <Button variant="link" size="sm">
          {t('designPreview.buttons.linkSm')}
        </Button>
        <Button disabled>{t('designPreview.buttons.disabled')}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary">
          <Icon name="plus" />
          {t('designPreview.buttons.sm')}
        </Button>
        <Button>
          <Icon name="camera" />
          {t('designPreview.lists.cardLink')}
        </Button>
        <Button size="icon" variant="secondary" aria-label={t('designPreview.buttons.icon')}>
          <Icon name="search" />
        </Button>
        {/* the 36px round icon button (.btn-icon.btn-sm, issue #60) */}
        <Button size="icon-sm" variant="secondary" aria-label={t('designPreview.buttons.iconSm')}>
          <Icon name="search" />
        </Button>
        <Button size="icon" variant="ghost" aria-label={t('designPreview.buttons.icon')}>
          <Icon name="more-h" />
        </Button>
      </div>
      <Button size="lg" className="max-w-sm">
        {t('designPreview.buttons.lg')}
      </Button>
    </PreviewSection>
  )
}

/* ── inputs ─────────────────────────────────────────────────────── */

function InputsSection() {
  const { t } = useTranslation()
  const [codeInvalid, setCodeInvalid] = useState(true)

  return (
    <PreviewSection id="inputs" title={t('designPreview.sections.inputs')}>
      <div className="grid gap-6 desktop:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="preview-name">{t('designPreview.inputs.name')}</FieldLabel>
          <Input id="preview-name" placeholder={t('designPreview.lists.anya')} />
          <FieldDescription>{t('designPreview.inputs.nameHint')}</FieldDescription>
        </Field>

        <Field data-invalid="true">
          <FieldLabel htmlFor="preview-name-invalid">{t('designPreview.inputs.name')}</FieldLabel>
          <Input
            id="preview-name-invalid"
            aria-invalid
            defaultValue=" "
            aria-describedby="preview-name-error"
          />
          <FieldError id="preview-name-error">{t('designPreview.inputs.nameError')}</FieldError>
        </Field>

        <Field className="desktop:col-span-2">
          <FieldLabel htmlFor="preview-excerpt">{t('designPreview.inputs.excerpt')}</FieldLabel>
          <Textarea
            id="preview-excerpt"
            placeholder={t('designPreview.inputs.excerptPlaceholder')}
          />
        </Field>

        <Field data-invalid={codeInvalid || undefined}>
          <FieldLabel htmlFor="preview-code">{t('designPreview.inputs.code')}</FieldLabel>
          <AccessCodeInput
            id="preview-code"
            invalid={codeInvalid}
            onInvalidClear={() => setCodeInvalid(false)}
            aria-describedby="preview-code-error"
          />
          {codeInvalid ? (
            <FieldError id="preview-code-error">{t('designPreview.inputs.codeError')}</FieldError>
          ) : (
            <FieldDescription>{t('designPreview.inputs.codeHint')}</FieldDescription>
          )}
        </Field>

        <Field>
          <FieldLabel>{t('designPreview.inputs.codeDisplay')}</FieldLabel>
          <CodeDisplay code="A1B2-C3D4" />
        </Field>
      </div>
    </PreviewSection>
  )
}

/* ── overlays ───────────────────────────────────────────────────── */

function OverlaysSection() {
  const { t } = useTranslation()
  const [order, setOrder] = useState('newest')
  const [withPhotos, setWithPhotos] = useState(true)

  return (
    <PreviewSection id="overlays" title={t('designPreview.sections.overlays')}>
      <div className="flex flex-wrap items-center gap-3">
        <Dialog>
          <DialogTrigger
            render={<Button variant="secondary">{t('designPreview.overlays.dialog')}</Button>}
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('designPreview.overlays.dialogTitle')}</DialogTitle>
              <DialogDescription>{t('designPreview.overlays.dialogText')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="secondary" />}>
                {t('designPreview.overlays.cancel')}
              </DialogClose>
              <DialogClose render={<Button variant="destructive" />}>
                {t('designPreview.overlays.confirmDelete')}
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Sheet>
          <SheetTrigger
            render={<Button variant="secondary">{t('designPreview.overlays.sheet')}</Button>}
          />
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{t('designPreview.overlays.sheetTitle')}</SheetTitle>
              <SheetDescription>{t('designPreview.overlays.sheetText')}</SheetDescription>
            </SheetHeader>
            <SheetFooter>
              <SheetClose render={<Button variant="primary" />}>
                {t('designPreview.overlays.cancel')}
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <Drawer>
          <DrawerTrigger
            render={<Button variant="secondary">{t('designPreview.overlays.drawer')}</Button>}
          />
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{t('designPreview.overlays.sheetTitle')}</DrawerTitle>
              <DrawerDescription>{t('designPreview.overlays.sheetText')}</DrawerDescription>
            </DrawerHeader>
            <DrawerFooter>
              <DrawerClose render={<Button variant="secondary" />}>
                {t('designPreview.overlays.cancel')}
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>

        <Popover>
          <PopoverTrigger
            render={<Button variant="secondary">{t('designPreview.overlays.popover')}</Button>}
          />
          <PopoverContent className="w-64">
            <p className="text-sm">{t('designPreview.lists.cardText')}</p>
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="secondary">{t('designPreview.overlays.menu')}</Button>}
          />
          <DropdownMenuContent>
            <DropdownMenuItem>
              <Icon name="user" />
              {t('designPreview.overlays.profile')}
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Icon name="settings" />
              {t('designPreview.overlays.settings')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Icon name="repeat" />
              {t('designPreview.overlays.switchSpace')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive">
              <Icon name="log-out" />
              {t('designPreview.overlays.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="secondary">{t('designPreview.overlays.viewMenu')}</Button>}
          />
          <DropdownMenuContent>
            <DropdownMenuRadioGroup value={order} onValueChange={setOrder}>
              <DropdownMenuLabel>{t('designPreview.overlays.order')}</DropdownMenuLabel>
              <DropdownMenuRadioItem value="newest">
                {t('designPreview.overlays.newestFirst')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="oldest">
                {t('designPreview.overlays.oldestFirst')}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={withPhotos} onCheckedChange={setWithPhotos}>
              {t('designPreview.overlays.withPhotos')}
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost">{t('designPreview.overlays.tooltip')}</Button>}
          />
          <TooltipContent>{t('designPreview.badges.primary')}</TooltipContent>
        </Tooltip>
      </div>
    </PreviewSection>
  )
}

/* ── pills and avatars ──────────────────────────────────────────── */

function BadgesSection() {
  const { t } = useTranslation()

  return (
    <PreviewSection id="badges" title={t('designPreview.sections.badges')}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge>{t('designPreview.badges.primary')}</Badge>
        <Badge variant="ok">
          <Icon name="check" />
          {t('designPreview.badges.ok')}
        </Badge>
        <Badge variant="warn">{t('designPreview.badges.warn')}</Badge>
        <Badge variant="danger">{t('designPreview.badges.danger')}</Badge>
        <Badge variant="neutral">{t('designPreview.badges.neutral')}</Badge>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {t('designPreview.badges.count')}
          <CountBadge>3</CountBadge>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-end gap-3">
          {(['xs', 'sm', 'default', 'lg'] as const).map((size) => (
            <Avatar key={size} size={size} hue={HUES.anya}>
              А
            </Avatar>
          ))}
        </div>
        <AvatarStack>
          <Avatar size="sm" hue={HUES.anya}>
            А
          </Avatar>
          <Avatar size="sm" hue={HUES.dima}>
            Д
          </Avatar>
          <Avatar size="sm" hue={HUES.misha}>
            М
          </Avatar>
          <Avatar size="sm" hue={HUES.luda}>
            Л
          </Avatar>
        </AvatarStack>
        <Avatar hue={HUES.luda}>Л</Avatar>
      </div>
    </PreviewSection>
  )
}

/* ── controls ───────────────────────────────────────────────────── */

function ControlsSection() {
  const { t } = useTranslation()
  const [pick, setPick] = useState({ anya: true, dima: false, misha: true, luda: false })
  const [reminders, setReminders] = useState(true)

  return (
    <PreviewSection id="controls" title={t('designPreview.sections.controls')}>
      <div className="flex flex-wrap items-start gap-10">
        <Tabs defaultValue="month">
          <TabsList aria-label={t('designPreview.controls.tabs')}>
            <TabsTrigger value="month">{t('designPreview.controls.tabOne')}</TabsTrigger>
            <TabsTrigger value="list">{t('designPreview.controls.tabTwo')}</TabsTrigger>
            <TabsTrigger value="year">{t('designPreview.controls.tabThree')}</TabsTrigger>
          </TabsList>
          <TabsContent value="month">
            <p className="text-sm text-muted-foreground">{t('designPreview.controls.tabOne')}</p>
          </TabsContent>
          <TabsContent value="list">
            <p className="text-sm text-muted-foreground">{t('designPreview.controls.tabTwo')}</p>
          </TabsContent>
          <TabsContent value="year">
            <p className="text-sm text-muted-foreground">{t('designPreview.controls.tabThree')}</p>
          </TabsContent>
        </Tabs>

        <ToggleGroup spacing={0} aria-label={t('designPreview.controls.toggle')}>
          <ToggleGroupItem value="month">{t('designPreview.controls.tabOne')}</ToggleGroupItem>
          <ToggleGroupItem value="list">{t('designPreview.controls.tabTwo')}</ToggleGroupItem>
        </ToggleGroup>

        <Toggle aria-pressed={reminders} onPressedChange={setReminders}>
          {t('designPreview.controls.tabTwo')}
        </Toggle>

        {/* the switch renders a button, so a wrapping label would not
            activate it — the text is its visible caption instead */}
        <span className="flex items-center gap-3 text-sm font-medium">
          <Switch checked={reminders} onCheckedChange={setReminders} />
          {t('designPreview.controls.switchLabel')}
        </span>
      </div>

      <div className="max-w-md overflow-hidden rounded-lg border border-border bg-card">
        <p className="px-3.5 pt-3 text-sm font-medium text-muted-foreground">
          {t('designPreview.lists.pickTitle')}
        </p>
        <ItemGroup>
          <PickRow
            pressed={pick.anya}
            onPressedChange={(value) => setPick({ ...pick, anya: value })}
          >
            {t('designPreview.lists.anya')}
          </PickRow>
          <PickRow
            pressed={pick.dima}
            onPressedChange={(value) => setPick({ ...pick, dima: value })}
          >
            {t('designPreview.lists.dima')}
          </PickRow>
          <PickRow
            pressed={pick.misha}
            onPressedChange={(value) => setPick({ ...pick, misha: value })}
          >
            {t('designPreview.lists.misha')}
          </PickRow>
          <PickRow
            pressed={pick.luda}
            onPressedChange={(value) => setPick({ ...pick, luda: value })}
          >
            {t('designPreview.lists.luda')}
          </PickRow>
        </ItemGroup>
      </div>
    </PreviewSection>
  )
}

/* ── states ─────────────────────────────────────────────────────── */

const SYNC_STATES: SyncState[] = ['first', 'updating', 'synced', 'offline', 'unreachable', 'error']

function FeedbackSection() {
  const { t } = useTranslation()

  return (
    <PreviewSection id="feedback" title={t('designPreview.sections.feedback')}>
      <h3 className="text-h3">{t('designPreview.feedback.sync')}</h3>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {SYNC_STATES.map((state) => (
          <SyncStatus
            key={state}
            state={state}
            syncedAt={new Date(2026, 8, 28, 14, 32)}
            onRetry={() => {}}
            className="max-w-sm"
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => toast(t('designPreview.feedback.toastOk'))}>
          <Icon name="check" />
          {t('designPreview.feedback.ok')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => toast(t('designPreview.feedback.toastDanger'), 'danger')}
        >
          <Icon name="alert" />
          {t('designPreview.badges.danger')}
        </Button>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {t('designPreview.feedback.spinner')} <Spinner />
        </span>
        {/* a pending button's spinner takes the button's 18px, so the
            label does not shift when the action resolves (issue #55) */}
        <Button variant="secondary" disabled>
          <Spinner />
          {t('designPreview.feedback.emptyAction')}
        </Button>
      </div>

      <Banner>{t('designPreview.feedback.banner')}</Banner>

      <h3 className="text-h3 mt-2">{t('designPreview.feedback.skeleton')}</h3>
      <div className="flex max-w-md flex-col gap-2">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>

      <div className="grid gap-6 desktop:grid-cols-2">
        <Empty>
          <EmptyMedia>
            <Icon name="book" />
          </EmptyMedia>
          <EmptyTitle>{t('designPreview.feedback.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('designPreview.feedback.emptyText')}</EmptyDescription>
          <EmptyContent>
            <Button variant="secondary" size="sm">
              <Icon name="plus" />
              {t('designPreview.feedback.emptyAction')}
            </Button>
          </EmptyContent>
        </Empty>
        <ErrorState
          onRetry={() => {}}
          title={t('designPreview.feedback.errorTitle')}
          description={t('designPreview.feedback.errorText')}
        />
      </div>
    </PreviewSection>
  )
}

/* ── lists and cards ────────────────────────────────────────────── */

function ListsSection() {
  const { t, i18n } = useTranslation()
  const date = demoDate(i18n.language)

  return (
    <PreviewSection id="lists" title={t('designPreview.sections.lists')}>
      <div className="grid gap-8 desktop:grid-cols-2">
        <div>
          <SectionHeader
            title={t('designPreview.lists.events')}
            action={<a href="#lists">{t('designPreview.lists.eventsLink')}</a>}
          />
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <ItemGroup>
              <Item size="lg">
                <ItemMedia variant="icon" tone="warn">
                  <Icon name="cake" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{t('designPreview.lists.eventOne')}</ItemTitle>
                  <p className="text-sm text-muted-foreground">
                    {t('designPreview.lists.eventOneSub')}
                  </p>
                </ItemContent>
                <Badge variant="warn">{t('designPreview.badges.warn')}</Badge>
              </Item>
              <Item size="lg">
                <ItemMedia variant="icon">
                  <Icon name="clock" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{t('designPreview.lists.eventTwo')}</ItemTitle>
                  <p className="text-sm text-muted-foreground">
                    {t('designPreview.lists.eventTwoSub')}
                  </p>
                </ItemContent>
                <Icon name="chevron-right" className="text-muted-foreground" />
              </Item>
              <Item size="lg">
                <ItemMedia variant="icon">
                  <Icon name="calendar" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{t('designPreview.lists.eventThree')}</ItemTitle>
                  <p className="text-sm text-muted-foreground">
                    {t('designPreview.lists.eventThreeSub')}
                  </p>
                </ItemContent>
              </Item>
            </ItemGroup>
          </div>

          <div className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
            <ItemGroup>
              {[
                {
                  id: 'anya',
                  initials: 'А',
                  hue: HUES.anya,
                  sub: t('designPreview.lists.memberSub'),
                },
                {
                  id: 'dima',
                  initials: 'Д',
                  hue: HUES.dima,
                  sub: t('designPreview.lists.memberSub2'),
                },
                {
                  id: 'misha',
                  initials: 'М',
                  hue: HUES.misha,
                  sub: t('designPreview.lists.memberSub2'),
                },
                {
                  id: 'luda',
                  initials: 'Л',
                  hue: HUES.luda,
                  sub: t('designPreview.lists.memberSub2'),
                },
              ].map((member) => (
                <Item key={member.id} size="sm" render={<button type="button" />}>
                  <ItemMedia>
                    <Avatar hue={member.hue}>{member.initials}</Avatar>
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{t(`designPreview.lists.${member.id}`)}</ItemTitle>
                    <p className="text-sm text-muted-foreground">{member.sub}</p>
                  </ItemContent>
                  <Icon name="chevron-right" className="text-muted-foreground" />
                </Item>
              ))}
              <Item size="sm" variant="danger">
                <ItemMedia variant="icon" tone="danger">
                  <Icon name="trash" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{t('designPreview.lists.dangerRow')}</ItemTitle>
                </ItemContent>
                {/* the actions slot sizes its own icon and leaves the
                    pill's icon to the pill (issue #55) */}
                <ItemActions>
                  <Badge variant="danger">
                    <Icon name="alert" />
                    {t('designPreview.badges.danger')}
                  </Badge>
                  <Icon name="chevron-right" />
                </ItemActions>
              </Item>
              <Item size="sm" render={<a href="#lists" />}>
                <ItemMedia variant="icon">
                  <Icon name="settings" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{t('designPreview.lists.linkRow')}</ItemTitle>
                </ItemContent>
                <Icon name="chevron-right" className="text-muted-foreground" />
              </Item>
            </ItemGroup>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <a href="#lists" className="block rounded-lg">
            <Card hoverable>
              <CardHeader>
                <CardTitle>{t('designPreview.lists.cardTitle')}</CardTitle>
                <CardDescription>
                  {t('designPreview.lists.cardMeta', {
                    date,
                    author: t('designPreview.lists.misha'),
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-3 grid aspect-[16/10] place-items-center rounded-md bg-surface-2 text-muted-foreground">
                  <Icon name="image" className="size-8" />
                </div>
                <p className="text-sm text-muted-foreground">{t('designPreview.lists.cardText')}</p>
              </CardContent>
              <CardFooter>
                <span className="text-sm font-medium text-primary">
                  {t('designPreview.lists.cardLink')}
                </span>
              </CardFooter>
            </Card>
          </a>

          <Card size="sm">
            <CardHeader>
              <CardTitle>{t('designPreview.lists.pickTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{t('designPreview.lists.cardText')}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <h3 className="text-h3">{t('designPreview.lists.cardForms')}</h3>
      <div className="grid gap-8 desktop:grid-cols-2">
        <div className="flex flex-col gap-3">
          {/* the padded form: 20px on all sides, no forced gap — the
              content sets its own rhythm (issue #58) */}
          <Card variant="padded">
            <h3 className="text-h3">{t('designPreview.lists.paddedTitle')}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('designPreview.lists.paddedText')}
            </p>
            <div className="mt-4">
              <Button size="sm" variant="secondary">
                <Icon name="heart" />
                {t('designPreview.lists.paddedAction')}
              </Button>
            </div>
          </Card>
          <p className="text-sm text-muted-foreground">{t('designPreview.lists.paddedHint')}</p>
        </div>
        <div className="flex flex-col gap-3">
          {/* the list form: no padding, rows flush, the corners clip
              them; a bare leading icon by default, the 38px tinted
              tile opt-in through variant="icon" — a tone alone only
              colours the icon —, an avatar never on a tile */}
          <Card variant="list">
            <ItemGroup>
              <Item size="sm">
                <ItemMedia>
                  <Icon name="book" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{t('designPreview.lists.cardTitle')}</ItemTitle>
                  <ItemDescription>{t('designPreview.lists.leadingBare')}</ItemDescription>
                </ItemContent>
              </Item>
              <Item size="sm">
                <ItemMedia variant="icon">
                  <Icon name="clock" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{t('designPreview.lists.eventTwo')}</ItemTitle>
                  <ItemDescription>{t('designPreview.lists.leadingTile')}</ItemDescription>
                </ItemContent>
              </Item>
              <Item size="sm">
                <ItemMedia variant="icon" tone="warn">
                  <Icon name="cake" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{t('designPreview.lists.eventOne')}</ItemTitle>
                  <ItemDescription>{t('designPreview.lists.leadingTile')}</ItemDescription>
                </ItemContent>
              </Item>
              <Item size="sm">
                {/* the tone alone colours a bare icon, like the
                    prototype's accent heart in the wishlists row */}
                <ItemMedia tone="primary">
                  <Icon name="gift" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{t('designPreview.lists.giftIdeas')}</ItemTitle>
                  <ItemDescription>{t('designPreview.lists.leadingTone')}</ItemDescription>
                </ItemContent>
              </Item>
              <Item size="sm">
                <ItemMedia>
                  <Avatar hue={HUES.anya}>А</Avatar>
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{t('designPreview.lists.anya')}</ItemTitle>
                  <ItemDescription>{t('designPreview.lists.leadingAvatar')}</ItemDescription>
                </ItemContent>
              </Item>
            </ItemGroup>
          </Card>
          <p className="text-sm text-muted-foreground">{t('designPreview.lists.listHint')}</p>
        </div>
      </div>

      <h3 className="text-h3">{t('designPreview.lists.rowHeights')}</h3>
      <Card variant="list" className="max-w-xl">
        <ItemGroup>
          {ROW_HEIGHTS.map(({ size, pixels, icon, titleKey }) => (
            <Item key={size} size={size}>
              <ItemMedia>
                <Icon name={icon} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{t(titleKey)}</ItemTitle>
                <ItemDescription>
                  {t('designPreview.lists.rowSize', { size, pixels })}
                </ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      </Card>
    </PreviewSection>
  )
}

/* ── shared pieces (issue #61) ──────────────────────────────────── */

function PiecesSection() {
  const { t } = useTranslation()

  return (
    <PreviewSection id="pieces" title={t('designPreview.sections.pieces')}>
      <div className="grid gap-8 desktop:grid-cols-2">
        {/* the Home form: title, text and the accent link */}
        <div className="flex flex-col gap-3">
          <NoteBlock icon="gift">
            <p className="font-semibold text-foreground">{t('designPreview.pieces.noteTitle')}</p>
            <p className="mt-0.5 text-muted-foreground">{t('designPreview.pieces.noteText')}</p>
            <a
              href="#pieces"
              className="mt-2 inline-flex font-medium text-primary underline-offset-3 hover:underline"
            >
              {t('designPreview.pieces.noteLink')}
            </a>
          </NoteBlock>
          <p className="text-sm text-muted-foreground">{t('designPreview.pieces.noteHint')}</p>
        </div>
        {/* the invite form: one rich paragraph after the icon */}
        <div className="flex flex-col gap-3">
          <NoteBlock icon="shield">
            <p>
              <b>{t('designPreview.pieces.notePlainLead')}</b>
              {t('designPreview.pieces.notePlainRest')}
            </p>
          </NoteBlock>
          <p className="text-sm text-muted-foreground">
            {t('designPreview.pieces.actionBarInLayouts')}
          </p>
        </div>
      </div>
    </PreviewSection>
  )
}

/* ── shells ─────────────────────────────────────────────────────── */

function LayoutsSection() {
  const { t, i18n } = useTranslation()
  const [activeId, setActiveId] = useState('home')
  const [sectionCount, setSectionCount] = useState(4)
  const [withActionBar, setWithActionBar] = useState(true)
  const date = demoDate(i18n.language)

  const sections: { id: string; label: string; icon: IconName }[] = [
    { id: 'home', label: t('designPreview.demo.homeTitle'), icon: 'home' },
    { id: 'journal', label: t('designPreview.demo.journalTitle'), icon: 'book' },
    { id: 'calendar', label: t('designPreview.demo.calendarTitle'), icon: 'calendar' },
    { id: 'wishlist', label: t('designPreview.demo.wishlistTitle'), icon: 'gift' },
  ]

  const space = {
    name: t('designPreview.demo.spaceNameShort'),
    membersLabel: t('designPreview.demo.membersLabel'),
    marks: [
      { initials: 'А', hue: HUES.anya },
      { initials: 'Д', hue: HUES.dima },
      { initials: 'М', hue: HUES.misha },
      { initials: 'Л', hue: HUES.luda },
    ],
  }

  const userMenuItems = [
    { id: 'profile', label: t('designPreview.overlays.profile'), icon: 'user' as IconName },
    { id: 'settings', label: t('designPreview.overlays.settings'), icon: 'settings' as IconName },
    { id: 'switch', label: t('designPreview.overlays.switchSpace'), icon: 'repeat' as IconName },
    {
      id: 'logout',
      label: t('designPreview.overlays.logout'),
      icon: 'log-out' as IconName,
      danger: true,
    },
  ]

  return (
    <PreviewSection id="layouts" title={t('designPreview.sections.layouts')}>
      <p className="text-sm text-muted-foreground">{t('designPreview.layouts.openInPlace')}</p>

      <div className="flex flex-wrap items-center gap-4">
        <h3 className="text-h3">{t('designPreview.layouts.member')}</h3>
        {/* the layout must hold with one to four visible sections
            (README "Layout") */}
        <ToggleGroup
          value={[String(sectionCount)]}
          onValueChange={(values) => setSectionCount(Number(values[0] ?? 4))}
          aria-label={t('designPreview.layouts.sectionCount')}
        >
          {[1, 2, 3, 4].map((count) => (
            <ToggleGroupItem key={count} value={String(count)}>
              {count}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {/* the switch renders a button, so a wrapping label would not
            activate it — the text is its visible caption, and the
            accessible name is that same text (WCAG 2.5.3) */}
        <span className="flex items-center gap-3 text-sm font-medium">
          <Switch
            checked={withActionBar}
            onCheckedChange={setWithActionBar}
            aria-label={t('designPreview.pieces.actionBarToggle')}
          />
          {t('designPreview.pieces.actionBarToggle')}
        </span>
      </div>
      {/* the transform turns the demo box into the containing block for the
          fixed tab bar and FAB, so they stay inside the demo. The demo
          bar is still real to `html:has`, so while it is up the app's
          own toast viewport lifts above it — what a screen mounting the
          bar gets. The switch is on by default, so at phone width the
          page's toasts sit higher by the bar's --action-bar-h (plus the
          safe-area inset) than on a screen without a bar */}
      <div className="overflow-hidden rounded-lg border border-border [transform:translateZ(0)]">
        <MemberLayout
          space={space}
          sections={sections.slice(0, sectionCount)}
          activeId={activeId}
          sync={{ state: 'synced', syncedAt: new Date(2026, 8, 28, 14, 32) }}
          userMenuItems={userMenuItems}
          title={t('designPreview.demo.homeTitle')}
          onSpaceClick={() => toast(t('designPreview.layouts.spaceToast'))}
          onSectionClick={setActiveId}
        >
          <div className="flex flex-col gap-4 pt-6">
            <h3 className="text-display-lg">{t('designPreview.demo.greeting')}</h3>
            <SectionHeader
              title={t('designPreview.lists.events')}
              action={<a href="#layouts">{t('designPreview.lists.eventsLink')}</a>}
            />
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <ItemGroup>
                <Item size="lg">
                  <ItemMedia variant="icon" tone="warn">
                    <Icon name="cake" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{t('designPreview.lists.eventOne')}</ItemTitle>
                    <p className="text-sm text-muted-foreground">
                      {t('designPreview.lists.eventOneSub')}
                    </p>
                  </ItemContent>
                </Item>
                <Item size="lg">
                  <ItemMedia variant="icon">
                    <Icon name="clock" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{t('designPreview.lists.eventTwo')}</ItemTitle>
                    <p className="text-sm text-muted-foreground">
                      {t('designPreview.lists.eventTwoSub')}
                    </p>
                  </ItemContent>
                </Item>
              </ItemGroup>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>{t('designPreview.lists.cardTitle')}</CardTitle>
                <CardDescription>{date}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{t('designPreview.lists.cardText')}</p>
              </CardContent>
            </Card>
          </div>
          {withActionBar && (
            /* a screen's main actions ride the shared action bar
                (issue #61); mounted as part of the screen, the layout
                reserves the bar's bottom space while it is up */
            <ActionBar>
              <Button variant="secondary" className="min-w-0 flex-1">
                {t('designPreview.pieces.barCancel')}
              </Button>
              <Button className="min-w-0 flex-1">{t('designPreview.pieces.barSave')}</Button>
            </ActionBar>
          )}
        </MemberLayout>
      </div>

      <h3 className="text-h3">{t('designPreview.layouts.admin')}</h3>
      <div className="overflow-hidden rounded-lg border border-border">
        <AdminLayout>
          <div className="flex flex-col gap-3 pt-2">
            <h3 className="text-display-lg">{t('designPreview.layouts.adminHeading')}</h3>
            <p className="text-body text-muted-foreground">
              {t('designPreview.layouts.adminText')}
            </p>
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <ItemGroup>
                <Item size="sm">
                  <ItemMedia>
                    <AvatarStack>
                      <Avatar size="sm" hue={HUES.anya}>
                        А
                      </Avatar>
                      <Avatar size="sm" hue={HUES.dima}>
                        Д
                      </Avatar>
                    </AvatarStack>
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{t('designPreview.demo.spaceName')}</ItemTitle>
                    <p className="text-sm text-muted-foreground">
                      {t('designPreview.demo.membersLabel')}
                    </p>
                  </ItemContent>
                  <Icon name="chevron-right" className="text-muted-foreground" />
                </Item>
              </ItemGroup>
            </div>
          </div>
        </AdminLayout>
      </div>

      <h3 className="text-h3">{t('designPreview.layouts.auth')}</h3>
      <div className="overflow-hidden rounded-lg border border-border">
        <AuthFrame footer={t('designPreview.layouts.demoNote')}>
          <div className="flex flex-col gap-4">
            <h3 className="text-h2 text-center">{t('designPreview.layouts.authHeading')}</h3>
            <p className="text-sm text-muted-foreground">{t('designPreview.layouts.authText')}</p>
            <AccessCodeInput aria-label={t('designPreview.inputs.code')} />
            <Button size="lg">{t('designPreview.layouts.authAction')}</Button>
          </div>
        </AuthFrame>
      </div>

      {/* the FAB demo floats over the page; the screens that mount the
          action bar never carry a FAB, so the demo hides it while the
          bar is up instead of letting the two overlap */}
      {!withActionBar && (
        <Fab
          aria-label={t('designPreview.feedback.emptyAction')}
          onClick={() => toast(t('designPreview.feedback.toastOk'))}
        />
      )}
    </PreviewSection>
  )
}
