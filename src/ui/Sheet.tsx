import { Dialog, type DialogProps } from './Dialog';

export type SheetProps = Omit<DialogProps, 'variant'>;

/**
 * Bottom sheet on every width (centred, max 36rem, on wide screens): the (+) Ekle sheet,
 * the reader's word sheet, pickers. Radius 28 on top, a grab handle, title + close.
 * A confirmation or a short form is a `Dialog` (sheet on phones, centred dialog on desktop).
 */
export function Sheet(props: SheetProps) {
  return <Dialog variant="sheet" {...props} />;
}
