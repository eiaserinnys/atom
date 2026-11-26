import { useEffect, type RefObject } from 'react';

const TABBABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

interface DialogKeyboardOptions {
  frameRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  isBusy: boolean;
}

function keepTabInside(event: KeyboardEvent, frame: HTMLElement) {
  const items = [...frame.querySelectorAll<HTMLElement>(TABBABLE)];
  const first = items[0];
  const last = items[items.length - 1];
  if (!first) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  const outside = !frame.contains(active) || active === frame;
  if (outside || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

/** Esc closes, Tab stays inside the frame, and the dialog takes focus when it opens. Closing while busy is ignored. */
export function useDialogKeyboard({ frameRef, initialFocusRef, onClose, isBusy }: DialogKeyboardOptions) {
  useEffect(() => {
    initialFocusRef.current?.focus();
  }, [initialFocusRef]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!isBusy) onClose();
      } else if (event.key === 'Tab' && frameRef.current) {
        keepTabInside(event, frameRef.current);
      }
    }
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [frameRef, isBusy, onClose]);
}
