import Image from 'next/image';

/**
 * The Builderforce mascot/logo, for use as a nav or empty-state icon in place
 * of an emoji. One component so the brand mark stays consistent everywhere.
 */
export default function MascotIcon({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/agentHost.png"
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'contain', display: 'inline-block', verticalAlign: 'middle' }}
    />
  );
}
