import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import {
  Badge,
  Button,
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
      <h2 id={id} className="mb-6 font-serif text-2xl font-semibold text-fg">
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
            <h1 className="font-serif text-4xl font-semibold tracking-[-0.01em]">
              {t('dev.title')}
            </h1>
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

        <Section id="type" title={t('dev.typography')}>
          <div className="flex flex-col gap-4">
            <p lang="en" className="font-serif text-display font-semibold">
              meticulous
            </p>
            <p className="font-serif text-4xl font-semibold">{t('home.title')} · 36</p>
            <p className="font-serif text-3xl font-semibold">{t('library.title')} · 30</p>
            <p className="font-serif text-2xl font-semibold">{t('dev.dialogTitle')} · 24</p>
            <p className="font-serif text-xl">{card.meaning} · 20</p>
            <p lang="en" className="font-serif text-lg italic">
              {card.example}
            </p>
            <p className="text-base">{t('dev.dialogBody')} · 16</p>
            <p className="text-sm text-fg-muted">{t('library.emptyHint')} · 14</p>
            <p className="text-xs text-fg-muted">{t('sync.offline')} · 12</p>
            <p lang="tr" className="font-serif text-2xl">
              Iğdır, İzmir, şiş, çöğür — ıİ ğĞ şŞ çÇ öÖ üÜ
            </p>
          </div>
        </Section>

        <Section id="buttons" title={t('dev.buttons')}>
          <Row label="variant">
            <Button>{t('home.startReview')}</Button>
            <Button variant="secondary">{t('common.edit')}</Button>
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
