'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SectionTourExit, SectionTourPhase } from './useSectionTour';
import styles from './SectionTour.module.css';

export interface SectionTourStep {
  title: string;
  body: string;
  target: string;
}

interface SectionTourProps {
  phase: SectionTourPhase;
  step: number;
  steps: SectionTourStep[];
  label: string;
  offerTitle: string;
  offerBody: string;
  startLabel: string;
  cancelLabel: string;
  closeLabel: string;
  backLabel: string;
  nextLabel: string;
  finishLabel: string;
  stepLabel: (current: number, total: number) => string;
  onStart: () => void;
  onCancel: (reason: SectionTourExit) => void;
  onNext: () => void;
  onBack: () => void;
  onStepChange?: (step: number) => void;
}

interface Box { top:number; left:number; width:number; height:number }

function findVisibleTarget(selector: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find((element) => {
    const rect = element.getBoundingClientRect();
    return element.offsetParent !== null && rect.width > 0 && rect.height > 0;
  }) ?? null;
}

function positionCard(box: Box | null): React.CSSProperties {
  if (!box) return { top:'50%', left:'50%', transform:'translate(-50%,-50%)' };
  const width = Math.min(380, window.innerWidth - 28);
  const height = 250;
  const gap = 16;
  if (box.left + box.width + width + gap < window.innerWidth) return { top:Math.min(Math.max(14,box.top),window.innerHeight-height-14), left:box.left+box.width+gap };
  if (box.left - width - gap > 0) return { top:Math.min(Math.max(14,box.top),window.innerHeight-height-14), left:box.left-width-gap };
  if (box.top + box.height + height + gap < window.innerHeight) return { top:box.top+box.height+gap, left:Math.min(Math.max(14,box.left),window.innerWidth-width-14) };
  return { top:Math.max(14,box.top-height-gap), left:Math.min(Math.max(14,box.left),window.innerWidth-width-14) };
}

export function SectionTour(props: SectionTourProps) {
  const { phase, step, steps, onCancel, onStepChange } = props;
  const [mounted,setMounted] = useState(false);
  const [box,setBox] = useState<Box|null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement|null>(null);
  const current = steps[step];

  useEffect(() => setMounted(true),[]);
  useEffect(() => {
    if (phase === 'idle') return;
    previousFocus.current = document.activeElement as HTMLElement|null;
    const frame = requestAnimationFrame(() => cardRef.current?.focus());
    return () => { cancelAnimationFrame(frame); previousFocus.current?.focus(); };
  },[phase]);
  useEffect(() => {
    if (phase !== 'active') return;
    const onKey = (event:KeyboardEvent) => { if (event.key === 'Escape') onCancel('escape'); };
    window.addEventListener('keydown',onKey);
    return () => window.removeEventListener('keydown',onKey);
  },[onCancel,phase]);
  useEffect(() => {
    if (phase !== 'offer') return;
    const onKey = (event:KeyboardEvent) => { if (event.key === 'Escape') onCancel('escape'); };
    window.addEventListener('keydown',onKey);
    return () => window.removeEventListener('keydown',onKey);
  },[onCancel,phase]);

  const measure = useCallback(() => {
    if (phase !== 'active' || !current) { setBox(null); return; }
    const target = findVisibleTarget(current.target);
    if (!target) { setBox(null); return; }
    const rect = target.getBoundingClientRect();
    const pad = 6;
    setBox({ top:Math.max(8,rect.top-pad), left:Math.max(8,rect.left-pad), width:Math.min(window.innerWidth-Math.max(8,rect.left-pad)-8,rect.width+pad*2), height:Math.min(window.innerHeight-Math.max(8,rect.top-pad)-8,rect.height+pad*2) });
  },[current,phase]);

  useLayoutEffect(() => {
    if (phase !== 'active') return;
    onStepChange?.(step);
    const frame = requestAnimationFrame(() => { findVisibleTarget(current.target)?.scrollIntoView({ block:'nearest',inline:'nearest' }); measure(); });
    const onMove = () => measure();
    window.addEventListener('resize',onMove);
    window.addEventListener('scroll',onMove,true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize',onMove); window.removeEventListener('scroll',onMove,true); };
  },[current,measure,onStepChange,phase,step]);

  if (!mounted || phase === 'idle' || !current) return null;
  const offer = phase === 'offer';
  const cardStyle = offer ? undefined : positionCard(box);
  return createPortal(<div className={styles.root} role="dialog" aria-modal="true" aria-label={props.label}>
    <div className={`${styles.veil} ${offer ? styles.offerVeil : ''}`} />
    {!offer && box && <div className={styles.spotlight} style={box} />}
    <div ref={cardRef} tabIndex={-1} className={`${styles.card} ${offer ? styles.offerCard : ''}`} style={cardStyle}>
      <button type="button" className={styles.close} aria-label={props.closeLabel} onClick={() => props.onCancel('close')}>×</button>
      <p className={styles.eyebrow}>{offer ? props.label : props.stepLabel(step+1,steps.length)}</p>
      <h2 className={styles.title}>{offer ? props.offerTitle : current.title}</h2>
      <p className={styles.body}>{offer ? props.offerBody : current.body}</p>
      <div className={styles.actions}>
        {offer ? <><button type="button" className={styles.button} onClick={() => props.onCancel('cancel')}>{props.cancelLabel}</button><button type="button" className={`${styles.button} ${styles.primary}`} onClick={props.onStart}>{props.startLabel}</button></> : <><button type="button" className={styles.button} onClick={() => props.onCancel('cancel')}>{props.cancelLabel}</button><div className={styles.nav}>{step>0&&<button type="button" className={styles.button} onClick={props.onBack}>{props.backLabel}</button>}<button type="button" className={`${styles.button} ${styles.primary}`} onClick={props.onNext}>{step===steps.length-1?props.finishLabel:props.nextLabel}</button></div></>}
      </div>
    </div>
  </div>,document.body);
}
