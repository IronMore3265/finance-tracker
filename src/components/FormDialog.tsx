/**
 * The shape every create/edit form in the app takes.
 *
 * Phase 3's headline fix is that *everything* is editable — the old app could
 * add and delete transactions and debts but never update them. That means one
 * dialog per entity, times eight entities, and a single wrapper is what keeps
 * those eight consistent (and keeps Astryx's pre-1.0 dialog API behind one
 * import, per PROGRESS.md §7).
 *
 * `purpose="form"` is the important prop: it stops a backdrop click from
 * discarding a half-typed entry once the user has interacted, while leaving
 * Escape working. `required` would trap the user, and `info` would throw away
 * their typing on a stray click.
 */
import type {ReactNode} from 'react';
import {useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {Stack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';

export interface FormDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  subtitle?: string;
  /** Defaults to "Save". Use a verb that names the outcome. */
  submitLabel?: string;
  /** Blocks submission — invalid form, nothing changed. */
  isSubmitDisabled?: boolean;
  /**
   * Perform the write. Resolve to close the dialog; return false to keep it
   * open (a validation failure the form wants to show inline).
   */
  onSubmit: () => Promise<boolean | void> | boolean | void;
  /** An extra action on the leading edge, typically Delete. */
  footerStart?: ReactNode;
  children: ReactNode;
  width?: number | string;
}

export function FormDialog({
  isOpen,
  onOpenChange,
  title,
  subtitle,
  submitLabel = 'Save',
  isSubmitDisabled = false,
  onSubmit,
  footerStart,
  children,
  width = 520,
}: FormDialogProps) {
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    try {
      const result = await onSubmit();
      if (result === false) return;
      onOpenChange(false);
    } catch (cause) {
      // A failed IndexedDB write is rare but real (quota, a blocked upgrade).
      // Showing it here beats closing the dialog on a write that did not land.
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
      purpose="form"
      width={width}
    >
      <DialogHeader
        title={title}
        {...(subtitle !== undefined && {subtitle})}
        onOpenChange={onOpenChange}
      />

      <Stack gap={4} padding={5}>
        {children}
        {error ? (
          <Text type="supporting" as="p" className="text-error">
            {error}
          </Text>
        ) : null}
      </Stack>

      <Stack
        direction="horizontal"
        hAlign="between"
        vAlign="center"
        gap={3}
        paddingInline={5}
        paddingBlock={4}
        wrap="wrap"
      >
        <Stack direction="horizontal" gap={2}>
          {footerStart}
        </Stack>
        <Stack direction="horizontal" gap={2} hAlign="end">
          <Button label="Cancel" variant="ghost" onClick={() => onOpenChange(false)} />
          <Button
            label={submitLabel}
            variant="primary"
            isDisabled={isSubmitDisabled}
            // clickAction rather than onClick: Astryx drives the button's own
            // loading state off the returned promise and dedupes re-clicks, so
            // a slow write cannot be submitted twice.
            clickAction={handleSubmit}
          />
        </Stack>
      </Stack>
    </Dialog>
  );
}
