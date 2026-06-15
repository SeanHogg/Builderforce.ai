'use client';

import React from 'react';

interface AvatarProps {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
}

const getInitials = (name: string) => {
  const parts = name.split(' ');
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

const getSizeClasses = (size: AvatarProps['size']) => {
  switch (size) {
    case 'sm':
      return 'h-8 w-8 text-xs';
    case 'lg':
      return 'h-14 w-14 text-lg';
    case 'md':
    default:
      return 'h-10 w-10 text-sm';
  }
};

export function Avatar({ name, src, size = 'md' }: AvatarProps) {
  const sizeClasses = getSizeClasses(size);
  const initials = getInitials(name);

  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-full bg-gray-400 text-white flex-shrink-0 ${sizeClasses}`}
    >
      {src ? (
        <img className={`h-full w-full rounded-full`} src={src} alt={name} />
      ) : (
        <span className="font-medium leading-none">{initials}</span>
      )}
    </div>
  );
}
