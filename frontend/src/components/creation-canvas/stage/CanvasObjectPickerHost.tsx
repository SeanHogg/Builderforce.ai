import { CanvasObjectPicker, type CanvasObjectPickerProps } from '../CanvasObjectPicker';
import { CANVAS_DND_MIME } from '../hooks/useCanvasBoardDrop';
import type { useCanvasNodePanels } from '../hooks/useCanvasNodePanels';

type NodePanels = ReturnType<typeof useCanvasNodePanels>;

export interface CanvasObjectPickerHostProps {
  objectPicker: NodePanels['objectPicker'];
  setObjectPicker: NodePanels['setObjectPicker'];
  onPick: CanvasObjectPickerProps['onPick'];
}

/**
 * ONE picker, two doors: a node's `+` (insert, connected) and everything else
 * (add) — the command bar's category circles, the board's own toggle, the
 * composer's "add context" row, the large-canvas notice's "Frame" button. This
 * replaced a hand-rolled palette aside that read the same registry through a
 * second, drifting rendering of it. Contents from `CREATION_PALETTE_GROUPS`, so
 * it can never fall behind the object registry.
 */
export function CanvasObjectPickerHost({ objectPicker, setObjectPicker, onPick }: CanvasObjectPickerHostProps) {
  if (!objectPicker) return null;
  return <CanvasObjectPicker
        anchor={objectPicker.anchor}
        {...(objectPicker.group ? { group: objectPicker.group } : {})}
        {...(objectPicker.fromNodeId ? { fromNodeId: objectPicker.fromNodeId } : {})}
        onPick={onPick}
        // Carry a row out of the picker and put it where it goes. On a board, WHERE
        // something lands is half the authoring — a picker that could only be clicked
        // made every placement a click followed by a drag.
        onDragStart={(choice, event) => { event.dataTransfer.setData(CANVAS_DND_MIME, choice); event.dataTransfer.effectAllowed = 'copy'; }}
        onClose={() => setObjectPicker(null)}
      />;
}
