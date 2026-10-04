import { useCallback, type ClipboardEvent, type DragEvent } from 'react';

/**
 * The composer's two drop-in attach paths — paste and drag-and-drop — both feeding
 * the same `onAttach` the `+` menu does. Every handler is undefined when the host
 * takes no attachments, so the composer wires nothing it cannot honour.
 */
export function useAttachmentDropAndPaste(onAttach?: (file: File) => void | Promise<void>) {
  // Paste an image straight from the clipboard (e.g. a screenshot) — same path
  // as the + button, so it flows through onAttach → vision content part.
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      if (!onAttach) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void onAttach(file);
          }
        }
      }
    },
    [onAttach]
  );

  // Drag-and-drop image files onto the input.
  const handleDrop = useCallback(
    (e: DragEvent) => {
      if (!onAttach) return;
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      e.preventDefault();
      void (async () => {
        for (let i = 0; i < files.length; i++) await onAttach(files[i]);
      })();
    },
    [onAttach]
  );

  const handleDragOver = useCallback((e: DragEvent) => e.preventDefault(), []);

  return onAttach
    ? { onPaste: handlePaste, onDrop: handleDrop, onDragOver: handleDragOver }
    : { onPaste: undefined, onDrop: undefined, onDragOver: undefined };
}
