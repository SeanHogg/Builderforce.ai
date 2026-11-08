import { useEffect, useState } from 'react';
import { resolveExportPalette, type ExportPalette } from '@/lib/creation/exportColors';

/**
 * The export palette as concrete colours for the editor that is open. Resolved again on
 * mount, because the first render may be the server's, where no stylesheet can be read.
 */
export function useExportPalette(): ExportPalette {
  const [palette, setPalette] = useState<ExportPalette>(resolveExportPalette);
  useEffect(() => setPalette(resolveExportPalette()), []);
  return palette;
}
