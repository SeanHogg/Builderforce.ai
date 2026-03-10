'use client';

import '@xterm/xterm/css/xterm.css';
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

      let fitCleanup: (() => void) | undefined;
      if (containerRef.current) {
        term.open(containerRef.current);
        fitAddon.fit();
        // Re-fit after layout so we get correct width (avoids squished text when container width was 0 on first paint)
        const raf = requestAnimationFrame(() => {
          requestAnimationFrame(() => fitAddon.fit());
        });
        const t = setTimeout(() => fitAddon.fit(), 100);
        fitCleanup = () => {
          cancelAnimationFrame(raf);
          clearTimeout(t);
        };
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

      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      const onWindowResize = () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          resizeTimer = null;
          fitAddon.fit();
        }, 50);
      };
      window.addEventListener('resize', onWindowResize);

      return () => {
        ro.disconnect();
        window.removeEventListener('resize', onWindowResize);
        if (resizeTimer) clearTimeout(resizeTimer);
        fitCleanup?.();
      };
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
    <div className="shell-container h-full" style={{ minWidth: 0 }}>
      <div ref={containerRef} style={{ width: '100%', minWidth: 0, height: '100%' }} />
    </div>
  );
}
