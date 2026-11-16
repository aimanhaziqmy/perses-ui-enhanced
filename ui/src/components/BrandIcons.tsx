import type { SvgIconProps } from '@mui/material';
import { SvgIcon } from '@mui/material';

export function PersesLogoMark({
  size = 26,
  logoUrl,
  logoText,
}: {
  size?: number;
  logoUrl?: string;
  logoText?: string;
}) {
  if (logoUrl && logoUrl.trim().length > 0) {
    return (
      <img
        src={logoUrl}
        alt="Site logo"
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          borderRadius: Math.max(4, Math.round(size * 0.25)),
          display: 'block',
          flexShrink: 0,
        }}
      />
    );
  }

  const monogram = (logoText ?? '').trim().slice(0, 2);
  if (monogram && monogram !== 'P') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
        <defs>
          <linearGradient id="perses-grad" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#6366F1" />
            <stop offset="55%" stopColor="#5B4FE9" />
            <stop offset="100%" stopColor="#0EA5E9" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#perses-grad)" />
        <text
          x="16"
          y="21"
          textAnchor="middle"
          fill="#FFFFFF"
          fontSize={monogram.length > 1 ? '13' : '16'}
          fontWeight="800"
          fontFamily="Inter, system-ui, sans-serif"
        >
          {monogram}
        </text>
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="perses-grad" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6366F1" />
          <stop offset="55%" stopColor="#5B4FE9" />
          <stop offset="100%" stopColor="#0EA5E9" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#perses-grad)" />
      <path
        d="M10.5 22.5V10.5H16.8C19.8 10.5 21.8 12.2 21.8 14.9C21.8 17.6 19.8 19.3 16.8 19.3H13.3V22.5H10.5ZM13.3 16.9H16.4C17.9 16.9 18.9 16.1 18.9 14.9C18.9 13.7 17.9 12.9 16.4 12.9H13.3V16.9Z"
        fill="#FFFFFF"
      />
      <circle cx="22.5" cy="21.5" r="2.2" fill="#38BDF8" />
    </svg>
  );
}

export function PrometheusBrandIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10.5" fill="#E6522C" />
      <path
        d="M12 5.2C12 5.2 14.9 8.1 14.9 10.6C14.9 12.1 14.1 13.1 13.3 13.7C13.7 12.4 13.1 11.4 12 10.4C10.9 11.4 10.3 12.4 10.7 13.7C9.9 13.1 9.1 12.1 9.1 10.6C9.1 8.1 12 5.2 12 5.2ZM7.5 15.6H16.5V17.1H7.5V15.6ZM9.2 18H14.8V19.3H9.2V18Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

export function VictoriaLogsBrandIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#1E293B" />
      <path d="M6.5 7.5L12 17.2L17.5 7.5H14.6L12 12.5L9.4 7.5H6.5Z" fill="#38BDF8" />
      <circle cx="12" cy="7.5" r="1.4" fill="#818CF8" />
    </svg>
  );
}

export function LinuxBadgeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      {/* Tux penguin body & flippers */}
      <path
        d="M12 2.2c-2.6 0-4.3 1.9-4.3 4.6 0 1.2.3 2.1.3 2.7-.8 1.2-2.7 3.8-3.3 6.2-.3 1.2.3 2.1 1.2 2.2.7.1 1.3-.4 1.7-1 .6 1.9 2.1 3.3 4.4 3.3s3.8-1.4 4.4-3.3c.4.6 1 1.1 1.7 1 .9-.1 1.5-1 1.2-2.2-.6-2.4-2.5-5-3.3-6.2 0-.6.3-1.5.3-2.7C16.3 4.1 14.6 2.2 12 2.2z"
        fill="#1E293B"
      />
      {/* White belly */}
      <ellipse cx="12" cy="14.5" rx="3.9" ry="4.8" fill="#F8FAFC" />
      {/* Eyes */}
      <circle cx="10.4" cy="6.1" r="1.05" fill="#FFFFFF" />
      <circle cx="13.6" cy="6.1" r="1.05" fill="#FFFFFF" />
      <circle cx="10.6" cy="6.1" r="0.5" fill="#0F172A" />
      <circle cx="13.4" cy="6.1" r="0.5" fill="#0F172A" />
      {/* Beak */}
      <path d="M10.2 7.6c0-.4.8-.7 1.8-.7s1.8.3 1.8.7c0 .6-.8 1.5-1.8 1.5s-1.8-.9-1.8-1.5z" fill="#F59E0B" />
      {/* Feet */}
      <ellipse cx="9" cy="20.4" rx="2.3" ry="1.2" fill="#F59E0B" />
      <ellipse cx="15" cy="20.4" rx="2.3" ry="1.2" fill="#F59E0B" />
    </svg>
  );
}

export function WindowsBadgeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="3" y="3" width="8.5" height="8.5" rx="1" fill="#0078D4" />
      <rect x="12.5" y="3" width="8.5" height="8.5" rx="1" fill="#0078D4" />
      <rect x="3" y="12.5" width="8.5" height="8.5" rx="1" fill="#0078D4" />
      <rect x="12.5" y="12.5" width="8.5" height="8.5" rx="1" fill="#0078D4" />
    </svg>
  );
}

export function MacOsBadgeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M15.2 2.2c0 1.4-.5 2.7-1.4 3.6-.9.9-2.2 1.5-3.4 1.4-.1-1.3.5-2.6 1.4-3.5.9-.9 2.2-1.5 3.4-1.5z" />
      <path d="M18.9 12.6c0-2.6 2.1-3.9 2.2-4-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.1 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.5 1.3-.1 1.8-.8 3.4-.8 1.6 0 2 .8 3.3.8 1.4 0 2.3-1.2 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.9-1.1-2.9-4.2z" />
    </svg>
  );
}

export function OsBadgeIcon({
  os,
  osImage,
  size = 14,
}: {
  os?: string;
  osImage?: string;
  size?: number;
}) {
  const normalizedOs = (os ?? '').trim().toLowerCase();
  const normalizedImage = (osImage ?? '').trim().toLowerCase();
  const target = normalizedOs || normalizedImage;

  if (/\b(win|windows)\b/.test(target) || normalizedOs.startsWith('win')) {
    return <WindowsBadgeIcon size={size} />;
  }
  if (/\b(darwin|mac|macos|osx)\b/.test(target) || normalizedOs === 'darwin' || normalizedOs.startsWith('mac')) {
    return <MacOsBadgeIcon size={size} />;
  }
  return <LinuxBadgeIcon size={size} />;
}

export function NavExplorerIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path d="M3 13h2v8H3v-8zm4-6h2v14H7V7zm4 4h2v10h-2V11zm4-7h2v17h-2V4zm4 9h2v8h-2v-8z" />
    </SvgIcon>
  );
}

export function NavAlertsIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
    </SvgIcon>
  );
}

export function NavInfraIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path d="M4 5h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm0 8h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zm2-6v2h2V7H6zm0 8v2h2v-2H6z" />
    </SvgIcon>
  );
}

export function NavIntegrationsIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path d="M12 3C7.58 3 4 4.79 4 7v10c0 2.21 3.58 4 8 4s8-1.79 8-4V7c0-2.21-3.58-4-8-4zm0 2c3.87 0 6 1.31 6 2s-2.13 2-6 2-6-1.31-6-2 2.13-2 6-2zm0 14c-3.87 0-6-1.31-6-2v-2.23c1.54.78 3.68 1.23 6 1.23s4.46-.45 6-1.23V17c0 .69-2.13 2-6 2zm0-5c-3.87 0-6-1.31-6-2V9.77C7.54 10.55 9.68 11 12 11s4.46-.45 6-1.23V12c0 .69-2.13 2-6 2z" />
    </SvgIcon>
  );
}

export function NavOrgIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
    </SvgIcon>
  );
}

export function NavSystemIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.06 7.06 0 0 0-1.62-.94l-.36-2.54A.49.49 0 0 0 13.9 2h-3.8a.49.49 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.64-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.4.31.61.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.09.49 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" />
    </SvgIcon>
  );
}

export function SunIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5h0a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0V3a1 1 0 0 1 1-1zm0 16a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1zM4.22 5.64a1 1 0 0 1 1.42-1.42l1.41 1.42a1 1 0 1 1-1.41 1.41L4.22 5.64zm12.73 12.72a1 1 0 0 1 1.41-1.41l1.42 1.41a1 1 0 1 1-1.42 1.42l-1.41-1.42zM2 12a1 1 0 0 1 1-1h2a1 1 0 0 1 0 2H3a1 1 0 0 1-1-1zm16 0a1 1 0 0 1 1-1h2a1 1 0 0 1 0 2h-2a1 1 0 0 1-1-1zM5.64 19.78a1 1 0 0 1-1.42-1.42l1.42-1.41a1 1 0 1 1 1.41 1.41l-1.41 1.42zm12.72-12.73a1 1 0 0 1-1.41-1.41l1.41-1.42a1 1 0 1 1 1.42 1.42l-1.42 1.41z" />
    </SvgIcon>
  );
}

export function MoonIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </SvgIcon>
  );
}

export function SidebarCollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <line x1="9" y1="4" x2="9" y2="20" />
      {collapsed ? (
        <path d="M13 9l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M16 9l-3 3 3 3" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

