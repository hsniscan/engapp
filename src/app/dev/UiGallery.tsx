import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import {
  Badge,
  BarChart,
  Button,
  Card,
  Chip,
  ChipRow,
  Eyebrow,
  HeatStrip,
  ListGroup,
  ListRow,
  ProgressRing,
  RatingBar,
  SectionHeader,
  StageBar,
  StagePill,
  StatRow,
  StatTile,
  TabHeader,
  Term,
  ratingLook,
  stageBg,
  uiStages,
  Checkbox,
  Dialog,
  DialogClose,
  DropdownMenu,
  EmptyState,
  FlipCard,
  Icon,
  IconButton,
  Kbd,
  Logo,
  ProgressBar,
  RatingButton,
  SegmentedControl,
  Select,
  Skeleton,
  Slider,
  Spinner,
  Surface,
  Switch,
  SyncStatus,
  Tabs,
  TextArea,
  TextField,
  ThemeSwitcher,
  Tooltip,
  applyTheme,
  colorTokens,
  iconNames,
  isThemePreference,
  ratings,
  toast,
} from '@/ui';
import { CardBack, CardFront } from '../pages/ReviewPage';
import { sampleCards, sampleIntervals } from '../pages/sampleCards';

function Section({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="border-t border-border py-10 first-of-type:border-t-0">
      <h2 id={id} className="mb-6 text-heading font-semibold text-fg">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      <h3 lang="en" className="font-mono text-xs text-fg-muted">
        {label}
      </h3>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function Split() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col">
      <h1 className="sr-only">{t('dev.splitTitle')}</h1>
      <div className="grid flex-1 grid-cols-2">
        <iframe
          title={t('theme.light')}
          src="/dev/ui?theme=light&embed=1"
          className="h-dvh w-full border-0"
        />
        <iframe
          title={t('theme.dark')}
          src="/dev/ui?theme=dark&embed=1"
          className="h-dvh w-full border-0"
        />
      </div>
    </div>
  );
}

/** /dev/ui — every component, for visual QA in both themes. Dev builds only. */
export function UiGallery() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const forced = params.get('theme');
  const embed = params.has('embed');

  useEffect(() => {
    // ?theme=light|dark previews a theme without persisting the user's preference.
    if (isThemePreference(forced)) applyTheme(forced);
  }, [forced]);

  const [flipped, setFlipped] = useState(params.has('flipped'));
  const [segment, setSegment] = useState<'manual' | 'paste' | 'pdf'>('manual');
  const [limit, setLimit] = useState(10);
  const [dialogOpen, setDialogOpen] = useState(params.get('open') === 'dialog');
  const [sheetOpen, setSheetOpen] = useState(params.get('open') === 'sheet');
  const card = sampleCards[0];

  if (params.has('split')) return <Split />;

  const heat = Array.from({ length: 7 * 12 }, (_, i) => {
    const v = (i * 37 + (i % 7) * 11) % 10;
    return v < 3 ? 'empty' : v < 6 ? 'active' : 'completed';
  });

  return (
    <div className="min-h-dvh bg-canvas">
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
        <header className="mb-4 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-3">
            <Logo size={32} />
            <h1 className="text-page-lg font-semibold">{t('dev.title')}</h1>
            <p className="text-fg-muted">{t('dev.intro')}</p>
          </div>
          {!embed && (
            <div className="flex flex-col gap-3 sm:items-end">
              <ThemeSwitcher className="w-full sm:w-80" />
              <a
                href="/dev/ui?split=1"
                className="hidden text-sm font-medium text-accent-text underline underline-offset-4 lg:inline"
              >
                {t('dev.split')}
              </a>
            </div>
          )}
        </header>

        <Section id="brand" title={t('dev.brand')}>
          <div className="flex flex-wrap items-center gap-8">
            <Logo size={48} />
            <Logo size={28} />
            <Logo size={64} wordmark={false} />
            <img
              src="/icons/icon-192.png"
              alt=""
              width={64}
              height={64}
              className="rounded-[14px]"
            />
            <img
              src="/icons/maskable-512.png"
              alt=""
              width={64}
              height={64}
              className="rounded-full"
            />
          </div>
        </Section>

        <Section id="colors" title={t('dev.colors')}>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {colorTokens.map((name) => (
              <li key={name} className="flex items-center gap-3">
                <span
                  className="size-10 shrink-0 rounded-control ring-1 ring-border ring-inset"
                  style={{ background: `var(--${name})` }}
                />
                <code className="min-w-0 truncate text-xs text-fg-muted">{name}</code>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="identity" title={t('dev.identity')}>
          <p className="mb-6 max-w-prose text-lead text-fg-muted">{t('dev.identityBody')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card tone="default" padding="lg" className="flex flex-col gap-2">
              <Eyebrow>Instrument Sans</Eyebrow>
              <p className="text-numeral font-semibold">Aa Ğğ İı Şş</p>
              <p className="text-ui text-fg-muted">ıİ ğĞ şŞ çÇ öÖ üÜ · 0123456789</p>
            </Card>
            <Card tone="default" padding="lg" className="flex flex-col gap-2">
              <Eyebrow>Literata</Eyebrow>
              <Term size="display">meticulous</Term>
              <Term italic className="text-fg-muted">
                {card.example}
              </Term>
            </Card>
          </div>
        </Section>

        <Section id="type" title={t('dev.typography')}>
          <div className="flex flex-col gap-4">
            <Term size="display" as="p">
              meticulous · display 40
            </Term>
            <p className="text-page-lg font-semibold">{t('home.title')} · page-lg 32</p>
            <p className="text-page font-semibold">{t('library.title')} · page 28</p>
            <p className="text-heading font-semibold">{t('dev.dialogTitle')} · heading 24</p>
            <p className="text-title font-semibold">{card.meaning} · title 20</p>
            <p className="text-lead">{t('dev.dialogBody')} · lead 17</p>
            <p className="text-body">{t('dev.dialogBody')} · body 16</p>
            <p className="text-ui">{t('library.emptyHint')} · ui 15</p>
            <p className="text-meta text-fg-muted">{t('library.emptyHint')} · meta 13</p>
            <p className="text-caption text-fg-muted">{t('sync.offline')} · caption 12</p>
            <Eyebrow>{t('dev.sampleEyebrow')} · eyebrow</Eyebrow>
            <p className="tabular text-numeral font-semibold">248 · numeral 48</p>
            <p lang="tr" className="text-heading">
              Iğdır, İzmir, şiş, çöğür — ıİ ğĞ şŞ çÇ öÖ üÜ
            </p>
            <p lang="tr" className="font-serif text-heading">
              Iğdır, İzmir, şiş, çöğür — ıİ ğĞ şŞ çÇ öÖ üÜ
            </p>
          </div>
        </Section>

        <Section id="stages" title={t('dev.stages')}>
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2">
              {uiStages.map((st) => (
                <StagePill key={st} stage={st} count={[34, 52, 61, 70, 31][uiStages.indexOf(st)]} />
              ))}
            </div>
            <StageBar
              counts={{ new: 34, learning: 52, consolidating: 61, learned: 70, mastered: 31 }}
            />
            <div className="flex gap-1">
              {uiStages.map((st) => (
                <span
                  key={st}
                  className={`h-10 flex-1 first:rounded-l-md last:rounded-r-md ${stageBg[st]}`}
                />
              ))}
            </div>
          </div>
        </Section>

        <Section id="ratingmap" title={t('dev.ratingMap')}>
          <div className="mb-5 flex flex-wrap gap-4">
            {ratings.map((r) => (
              <span key={r} className="flex items-center gap-2 text-ui">
                <span className={`size-3 rounded-full ${ratingLook[r].dot}`} />
                <span className={ratingLook[r].text + ' font-semibold'}>{t(`rating.${r}`)}</span>
              </span>
            ))}
          </div>
          <RatingBar onRate={() => {}} intervals={sampleIntervals} shortcuts className="max-w-md" />
        </Section>

        <Section id="radii" title={t('dev.radii')}>
          <div className="flex flex-wrap items-end gap-4">
            {(
              [
                ['xs 4', 'rounded-xs'],
                ['sm 8', 'rounded-sm'],
                ['control 12', 'rounded-control'],
                ['inner 16', 'rounded-inner'],
                ['card 20', 'rounded-card'],
                ['sheet 28', 'rounded-sheet'],
                ['full', 'rounded-full'],
              ] as const
            ).map(([label, cls]) => (
              <div key={label} className="flex flex-col items-center gap-2">
                <span className={`size-16 border border-border-strong/50 bg-accent-soft ${cls}`} />
                <code className="text-caption text-fg-muted">{label}</code>
              </div>
            ))}
          </div>
        </Section>

        <Section id="elevation" title={t('dev.elevation')}>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            {(['shadow-none', 'shadow-sm', 'shadow-md', 'shadow-lg'] as const).map((cls, i) => (
              <div
                key={cls}
                className={`flex h-20 items-center justify-center rounded-card border border-border bg-surface-raised ${cls}`}
              >
                <code className="text-caption text-fg-muted">e{i}</code>
              </div>
            ))}
          </div>
        </Section>

        <Section id="pageframe" title={t('dev.pageFrame')}>
          <Card tone="outline" padding="md">
            <TabHeader
              eyebrow={t('dev.sampleEyebrow')}
              title={t('dev.sampleTitle')}
              headingLevel="h2"
              description={t('dev.sampleDesc')}
              back={{ to: '/', label: t('settings.title') }}
              actions={<IconButton icon="search" label={t('common.search')} />}
              className="mb-0 md:mb-0"
            />
          </Card>
        </Section>

        <Section id="cards" title={t('dev.cards')}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>{t('dev.cardDefault')}</Card>
            <Card tone="raised">{t('dev.cardRaised')}</Card>
            <Card tone="sunken">{t('dev.cardSunken')}</Card>
            <Card tone="accent">{t('dev.cardAccent')}</Card>
            <Card tone="outline">{t('dev.cardOutline')}</Card>
            <Card tone="placeholder">{t('dev.cardPlaceholder')}</Card>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-[auto_1fr]">
            <Card className="flex items-center gap-4">
              <ProgressRing
                value={12}
                max={30}
                label={t('dev.preview.today.ring')}
                valueText={t('dev.preview.today.ringValue')}
              >
                <span className="tabular text-title font-semibold">18</span>
              </ProgressRing>
              <ProgressRing value={30} max={30} size={44} label={t('dev.preview.today.ring')}>
                <Icon name="check" size={18} className="text-accent-text" />
              </ProgressRing>
            </Card>
            <StatRow>
              <StatTile bare value="248" label={t('dev.preview.words.allUnit')} />
              <StatTile
                bare
                value="5"
                unit={t('stats.daysUnit', { count: 5 })}
                label={t('dev.streak')}
              />
              <StatTile bare value="%91" label={t('dev.retention')} hint="+2" />
            </StatRow>
          </div>
        </Section>

        <Section id="lists" title={t('dev.lists')}>
          <div className="grid gap-6 sm:grid-cols-2">
            <ListGroup label={t('dev.preview.today.shortcuts')}>
              <ListRow
                to="/"
                leadingIcon="alert"
                leadingTone="warn"
                title={t('dev.preview.today.hard')}
                description={t('dev.preview.today.hardDesc')}
                meta="7"
              />
              <ListRow
                to="/"
                leadingIcon="layers"
                leadingTone="accent"
                title={t('dev.preview.today.bank')}
                description={t('dev.preview.today.bankDesc')}
              />
              <Switch label={t('dev.sound')} defaultChecked className="min-h-14 px-4" />
            </ListGroup>
            <ListGroup label={t('dev.preview.words.all')}>
              {sampleCards.map((c, i) => (
                <ListRow
                  key={c.term}
                  to="/"
                  term
                  title={c.term}
                  description={c.meaning}
                  trailing={<StagePill stage={uiStages[i + 1]!} />}
                />
              ))}
            </ListGroup>
          </div>
        </Section>

        <Section id="chips" title={t('dev.chips')}>
          <ChipRow label={t('dev.preview.today.modes')}>
            <Chip selected count={12}>
              {t('dev.preview.today.review')}
            </Chip>
            <Chip count={6}>{t('dev.preview.today.new')}</Chip>
            <Chip count={3}>{t('dev.preview.today.cloze')}</Chip>
            <Chip icon="plus">{t('dev.preview.words.newDeck')}</Chip>
          </ChipRow>
        </Section>

        <Section id="charts" title={t('dev.charts')}>
          <div className="grid gap-6 sm:grid-cols-2">
            <Card>
              <SectionHeader as="h3" title={t('dev.heatmap')} />
              <BarChart
                label={t('dev.chartLabel')}
                data={[3, 5, 2, 9, 4, 0, 6, 3, 2, 4, 7, 1, 0, 3].map((v, i) => ({
                  label: String(i + 1),
                  value: v,
                  highlight: i === 0,
                }))}
                reference={{ value: 20, label: t('dev.capacity') }}
              />
            </Card>
            <Card className="flex flex-col gap-4">
              <HeatStrip
                label={t('dev.heatLabel')}
                days={(
                  [
                    'completed',
                    'completed',
                    'empty',
                    'active',
                    'completed',
                    'completed',
                    'completed',
                  ] as const
                ).map((level, i) => ({ level, label: String(i + 1) }))}
              />
              <p className="text-meta text-fg-muted">{t('dev.streak')}</p>
              <HeatStrip
                layout="grid"
                label={t('dev.heatLabel')}
                days={heat.map((level, i) => ({ level, label: String(i) }))}
              />
            </Card>
          </div>
        </Section>

        <Section id="states" title={t('dev.states')}>
          <div className="grid gap-4 sm:grid-cols-3">
            <EmptyState
              tone="placeholder"
              compact
              icon="cards"
              title={t('dev.preview.words.emptyTitle')}
              description={t('dev.preview.words.emptyBody')}
              action={
                <Button variant="secondary" size="sm" leadingIcon="plus">
                  {t('dev.preview.words.newDeck')}
                </Button>
              }
            />
            <Card className="flex flex-col gap-4" aria-busy="true">
              <Skeleton className="h-6 w-2/5" />
              <Skeleton lines={3} />
              <Skeleton className="h-11 w-full rounded-control" />
            </Card>
            <EmptyState
              tone="card"
              compact
              icon="sync-offline"
              title={t('dev.errorTitle')}
              description={t('dev.errorBody')}
              action={
                <Button variant="secondary" size="sm" leadingIcon="refresh">
                  {t('dev.retry')}
                </Button>
              }
            />
          </div>
        </Section>

        <Section id="buttons" title={t('dev.buttons')}>
          <Row label="variant">
            <Button>{t('home.startReview')}</Button>
            <Button variant="secondary">{t('common.edit')}</Button>
            <Button variant="tonal" leadingIcon="plus">
              {t('common.add')}
            </Button>
            <Button variant="ghost">{t('common.cancel')}</Button>
            <Button variant="danger" leadingIcon="trash">
              {t('common.delete')}
            </Button>
          </Row>
          <Row label="size">
            <Button size="sm">{t('common.save')}</Button>
            <Button size="md">{t('common.save')}</Button>
            <Button size="lg">{t('common.save')}</Button>
          </Row>
          <Row label="state">
            <Button loading>{t('common.save')}</Button>
            <Button variant="secondary" loading>
              {t('sync.syncNow')}
            </Button>
            <Button disabled>{t('common.save')}</Button>
            <Button variant="secondary" leadingIcon="google">
              {t('auth.google')}
            </Button>
            <Button variant="secondary" leadingIcon="upload">
              {t('common.upload')}
            </Button>
            <Button variant="ghost" trailingIcon="chevron-right">
              {t('common.continue')}
            </Button>
          </Row>
          <Row label="IconButton">
            <IconButton icon="speaker" label={t('common.listen')} />
            <IconButton icon="undo" label={t('common.undo')} />
            <IconButton icon="more" label={t('common.more')} variant="secondary" />
            <IconButton icon="plus" label={t('common.add')} variant="primary" />
            <IconButton icon="plus" label={t('common.add')} variant="tonal" />
            <IconButton icon="pencil" label={t('common.edit')} size="sm" />
            <IconButton icon="speaker" label={t('common.listen')} pressed />
          </Row>
        </Section>

        <Section id="icons" title={t('dev.icons')}>
          <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
            {iconNames.map((name) => (
              <li
                key={name}
                className="flex flex-col items-center gap-2 rounded-control border border-border bg-surface px-1 py-3"
              >
                <Icon name={name} size={24} />
                <code className="max-w-full truncate text-[0.6875rem] text-fg-muted">{name}</code>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="fields" title={t('dev.fields')}>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              label={t('dev.sampleLabel')}
              hint={t('dev.sampleHint')}
              defaultValue="meticulous"
            />
            <TextField label={t('dev.sampleLabel')} error={t('dev.sampleError')} />
            <TextField
              label={t('common.search')}
              leadingIcon="search"
              type="search"
              placeholder={t('library.searchPlaceholder')}
            />
            <Select
              label={t('dev.level')}
              defaultValue="b2"
              options={[
                { value: 'a2', label: 'A2' },
                { value: 'b1', label: 'B1' },
                { value: 'b2', label: 'B2' },
                { value: 'c1', label: 'C1' },
              ]}
            />
            <TextArea label={t('dev.sampleNote')} optional fieldClassName="sm:col-span-2" />
          </div>
        </Section>

        <Section id="controls" title={t('dev.controls')}>
          <div className="grid gap-8 sm:grid-cols-2">
            <div className="flex flex-col">
              <Switch label={t('dev.sound')} defaultChecked />
              <Switch label={t('dev.includeSuspended')} description={t('library.emptyHint')} />
              <Checkbox label={t('dev.includeSuspended')} defaultChecked />
              <Checkbox label={t('dev.badgeLowConfidence')} />
            </div>
            <div className="flex flex-col gap-6">
              <Slider
                label={t('dev.dailyLimit')}
                value={limit}
                onValueChange={setLimit}
                min={0}
                max={50}
              />
              <Slider
                label={t('dev.retention')}
                defaultValue={90}
                min={70}
                max={97}
                format={(v) => `%${v}`}
              />
              <SegmentedControl
                legend={t('add.title')}
                value={segment}
                onValueChange={setSegment}
                options={[
                  { value: 'manual', label: t('dev.tabManual') },
                  { value: 'paste', label: t('dev.tabPaste') },
                  { value: 'pdf', label: t('dev.tabPdf') },
                ]}
              />
            </div>
          </div>
          <div className="mt-8">
            <Tabs
              label={t('add.title')}
              items={(['tabManual', 'tabPaste', 'tabPdf'] as const).map((k) => ({
                value: k,
                label: t(`dev.${k}`),
                content: (
                  <p className="text-fg-muted">{t('dev.tabPanel', { tab: t(`dev.${k}`) })}</p>
                ),
              }))}
            />
          </div>
        </Section>

        <Section id="feedback" title={t('dev.feedback')}>
          <Row label="Badge">
            <Badge>{t('dev.badgeNew')}</Badge>
            <Badge tone="accent">{t('dev.badgeLearning')}</Badge>
            <Badge tone="success" dot>
              {t('dev.badgeReview')}
            </Badge>
            <Badge tone="warn">{t('dev.badgeLowConfidence')}</Badge>
            <Badge tone="danger">{t('sync.errorShort')}</Badge>
            <Badge tone="outline">{t('dev.badgeSuspended')}</Badge>
          </Row>
          <Row label="SyncStatus">
            <SyncStatus state="synced" />
            <SyncStatus state="syncing" />
            <SyncStatus state="pending" pendingCount={12} />
            <SyncStatus state="offline" />
            <SyncStatus state="error" />
          </Row>
          <Row label="ProgressBar · Spinner · Kbd">
            <div className="flex w-full max-w-sm flex-col gap-3">
              <ProgressBar value={12} max={40} label={t('a11y.progress')} />
              <ProgressBar value={30} max={40} size="md" label={t('a11y.progress')} />
            </div>
            <Spinner size={20} label={t('common.loading')} />
            <span className="flex gap-1">
              <Kbd>1</Kbd>
              <Kbd>2</Kbd>
              <Kbd>3</Kbd>
              <Kbd>4</Kbd>
              <Kbd>{t('review.spaceKey')}</Kbd>
            </span>
          </Row>
          <Row label="Skeleton">
            <Surface className="flex w-full max-w-sm flex-col gap-4">
              <Skeleton className="h-6 w-2/5" />
              <Skeleton lines={3} />
            </Surface>
          </Row>
          <Row label="Toast">
            <Button
              variant="secondary"
              onClick={() =>
                toast({
                  title: t('dev.toastTitle'),
                  description: t('dev.toastBody'),
                  tone: 'success',
                  action: { label: t('common.undo'), onClick: () => {} },
                })
              }
            >
              {t('dev.showToast')}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                toast.undo({ title: t('dev.undoToast'), undoLabel: t('ui.undo'), onUndo: () => {} })
              }
            >
              {t('dev.showUndo')}
            </Button>
            <Button variant="ghost" onClick={() => toast({ title: t('sync.offline') })}>
              {t('sync.offlineShort')}
            </Button>
          </Row>
          <Surface padding="none">
            <EmptyState
              icon="cards"
              title={t('library.empty')}
              description={t('library.emptyHint')}
              action={<Button variant="secondary">{t('home.addCard')}</Button>}
            />
          </Surface>
        </Section>

        <Section id="overlays" title={t('dev.overlays')}>
          <Row label="Dialog · Sheet · Menu · Tooltip">
            <Dialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              variant="responsive"
              trigger={<Button variant="secondary">{t('dev.openDialog')}</Button>}
              title={t('dev.dialogTitle')}
              description={t('dev.dialogBody')}
              footer={
                <>
                  <DialogClose asChild>
                    <Button variant="ghost">{t('common.cancel')}</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button variant="danger">{t('common.delete')}</Button>
                  </DialogClose>
                </>
              }
            />
            <Dialog
              open={sheetOpen}
              onOpenChange={setSheetOpen}
              variant="sheet"
              trigger={<Button variant="secondary">{t('dev.openSheet')}</Button>}
              title={t('settings.title')}
            >
              <ThemeSwitcher />
            </Dialog>
            <DropdownMenu
              label={t('common.more')}
              trigger={<IconButton icon="more" label={t('common.more')} variant="secondary" />}
              items={[
                { label: t('common.edit'), icon: 'pencil', shortcut: 'E' },
                { label: t('common.suspend'), icon: 'pause' },
                { label: t('common.undo'), icon: 'undo', shortcut: 'Z' },
                { kind: 'separator' },
                { label: t('common.delete'), icon: 'trash', danger: true },
              ]}
            />
            <Tooltip content={t('sync.offline')}>
              <Button variant="ghost">{t('sync.label')}</Button>
            </Tooltip>
          </Row>
        </Section>

        <Section id="flip" title={t('dev.flipCard')}>
          <div className="mx-auto flex max-w-md flex-col gap-4">
            <FlipCard
              flipped={flipped}
              onFlip={() => setFlipped((f) => !f)}
              front={<CardFront card={card} />}
              back={<CardBack card={card} />}
              minHeight="22rem"
            />
            <Button variant="secondary" onClick={() => setFlipped((f) => !f)}>
              {t('dev.flip')}
            </Button>
          </div>
        </Section>

        <Section id="ratings" title={t('dev.ratings')}>
          <div
            role="group"
            aria-label={t('rating.group')}
            className="mx-auto grid max-w-md grid-cols-4 gap-2"
          >
            {ratings.map((r, i) => (
              <RatingButton
                key={r}
                rating={r}
                interval={sampleIntervals[r]}
                shortcut={String(i + 1)}
              />
            ))}
          </div>
        </Section>

        <Section id="heatmap" title={t('dev.heatmap')}>
          <div className="flex flex-col gap-4">
            <div aria-hidden="true" className="grid w-fit grid-flow-col grid-rows-7 gap-[3px]">
              {heat.map((level, i) => (
                <span
                  key={i}
                  className="size-3.5 rounded-[3px]"
                  style={{ background: `var(--heat-${level})` }}
                />
              ))}
            </div>
            <div className="flex items-center gap-4 text-sm text-fg-muted">
              {(['empty', 'active', 'completed'] as const).map((l) => (
                <span key={l} className="flex items-center gap-1.5">
                  <span
                    className="size-3.5 rounded-[3px]"
                    style={{ background: `var(--heat-${l})` }}
                  />
                  <code className="text-xs">heat-{l}</code>
                </span>
              ))}
            </div>
          </div>
        </Section>
      </main>
    </div>
  );
}
