import type React from 'react';
import styles from './figures.module.css';
import { hueOf, type DevicesFigure } from './types';

/**
 * Frames at real widths, drawn to scale against each other.
 *
 * For the capabilities whose whole point is a MEASUREMENT: three device
 * readings that are genuinely 1280, 834 and 390 CSS pixels rather than three
 * labels on one box. Each frame's share of the row is its width over the sum of
 * the widths, so the drawing cannot claim a difference the numbers do not have
 * — which is the exact defect this figure was first written to illustrate.
 */
export default function Devices({ spec }: { spec: DevicesFigure }) {
  const total = spec.devices.reduce((sum, device) => sum + Math.max(1, device.width), 0);
  return (
    <div className={styles.scroll}>
      <ul className={styles.devices}>
        {spec.devices.map((device) => (
          <li
            key={device.label}
            className={styles.device}
            style={{
              '--hue': hueOf(device.hue),
              '--share': `${(Math.max(1, device.width) / total) * 100}%`,
              '--ratio': `${device.width} / ${device.height ?? Math.round(device.width * 0.62)}`,
            } as React.CSSProperties}
          >
            <span className={styles.deviceFrame} aria-hidden="true">
              <span className={styles.deviceBar} />
              <span className={styles.deviceLine} />
              <span className={styles.deviceLine} />
              <span className={styles.deviceLine} />
            </span>
            <strong className={styles.deviceLabel}>{device.label}</strong>
            <span className={styles.deviceWidth}>{device.width} px</span>
            {device.note && <span className={styles.deviceNote}>{device.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
