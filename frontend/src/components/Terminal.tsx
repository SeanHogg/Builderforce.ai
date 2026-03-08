'use client';

import { useEffect, useRef } from 'react';

interface TerminalProps {
  onReady?: (write: (data: string) => void) => void;
  onInput?: (data: string) => void;
}

export function Terminal({ onReady, onInput }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<import('@xterm/xterm').Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current || typeof window === 'undefined') return;

    let term: import('@xterm/xterm').Terminal | undefined;

    const init = async () => {
      const [{ Terminal: XTerm }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
      ]);

      // xterm CSS is loaded via a script tag or global stylesheet at runtime

      term = new XTerm({
        theme: {
          background: '#1a1a2e',
          foreground: '#e0e0e0',
          cursor: '#ffffff',
        },
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        cursorBlink: true,
        convertEol: true,
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);

      if (containerRef.current) {
        term.open(containerRef.current);
        fitAddon.fit();
      }

      terminalRef.current = term;

      term.writeln('\x1b[32mBuilderforce Terminal\x1b[0m');
      term.writeln('WebContainer ready. Start coding!');
      term.write('\r\n$ ');

      term.onData((data) => {
        term!.write(data);
        onInput?.(data);
      });

      onReady?.((data: string) => {
        term!.write(data);
      });

      const ro = new ResizeObserver(() => fitAddon.fit());
      if (containerRef.current) ro.observe(containerRef.current);

      return () => ro.disconnect();
    };

    let cleanupFn: (() => void) | undefined;
    init().then(fn => { cleanupFn = fn; });

    return () => {
      cleanupFn?.();
      term?.dispose();
      terminalRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="shell-container h-full">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
