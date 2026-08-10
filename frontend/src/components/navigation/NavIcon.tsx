import type { SVGProps } from 'react';
import { Icon } from '@/components/ui/Icon';

/**
 * One restrained line-icon language for the application rail. Navigation used
 * to render platform-dependent emoji, which changed size, colour and baseline
 * between operating systems. These icons deliberately inherit the row colour.
 */
export function NavIcon({ name, ...props }: { name: string } & SVGProps<SVGSVGElement>) {
  return <Icon source={name} size={20} {...props} />;
}
