import React from 'react';
import type { UserProfile, MicroscopeStatusChip } from '../types/microscope.ts';

interface HeaderProps {
  status: MicroscopeStatusChip;
  onOpenMobileMenu: () => void;
  onOpenAuth: () => void;
  currentUser: UserProfile;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  onOpenMobileMenu,
  onOpenAuth,
  currentUser,
  isDarkMode,
  onToggleDarkMode,
}) => {
  // Map simplified status chip colors and styling
  const getStatusChipConfig = (s: MicroscopeStatusChip) => {
    switch (s) {
      case 'Connecting':
        return {
          bg: 'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300',
          dot: 'bg-amber-500 animate-pulse',
          icon: 'sync',
        };
      case 'Live':
        return {
          bg: 'bg-[#22c55e]/15 border-[#22c55e]/30 text-[#15803d] dark:text-[#4ade80]',
          dot: 'bg-[#22c55e] animate-ping',
          icon: 'videocam',
        };
      case 'Capturing':
        return {
          bg: 'bg-secondary/20 border-secondary/40 text-secondary-dark dark:text-secondary',
          dot: 'bg-secondary animate-bounce',
          icon: 'photo_camera',
        };
      case 'Analyzing':
        return {
          bg: 'bg-blue-500/15 border-blue-500/30 text-blue-700 dark:text-blue-300',
          dot: 'bg-blue-500 animate-spin',
          icon: 'psychology',
        };
      case 'Ready to inspect':
        return {
          bg: 'bg-primary/15 border-primary/30 text-primary dark:text-primary-fixed',
          dot: 'bg-primary',
          icon: 'check_circle',
        };
      case 'No signal':
      default:
        return {
          bg: 'bg-error/15 border-error/30 text-error',
          dot: 'bg-error',
          icon: 'videocam_off',
        };
    }
  };

  const statusConfig = getStatusChipConfig(status);

  return (
    <header className="sticky top-0 left-0 right-0 z-40 bg-surface/90 backdrop-blur-md border-b border-outline-variant/30 transition-colors">
      <div className="h-16 w-full px-4 md:px-8 flex items-center justify-between gap-4">
        {/* Left: Mobile Toggle & Simplified Current-State Status Chip */}
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenMobileMenu}
            aria-label="Open navigation menu"
            className="lg:hidden p-2 rounded-xl bg-surface-container text-on-surface hover:bg-surface-container-high transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">menu</span>
          </button>

          {/* Simplified Status Chip: Connecting | Live | Capturing | Analyzing | Ready to inspect | No signal */}
          <div
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-label-md font-semibold transition-all shadow-2xs ${statusConfig.bg}`}
          >
            <span className="relative flex h-2 w-2">
              <span className={`relative inline-flex rounded-full h-2 w-2 ${statusConfig.dot}`} />
            </span>
            <span>{status}</span>
          </div>

          <span className="hidden sm:inline font-metric-reticle text-xs text-on-surface-variant">
            Raspberry Pi 4 Microscope Stage
          </span>
        </div>

        {/* Right: Actions, Dark Mode & Account */}
        <div className="flex items-center gap-3">
          {/* Action buttons */}
          <div className="flex items-center gap-1.5">
            {/* Dark Mode Toggle */}
            <button
              onClick={onToggleDarkMode}
              title="Toggle Light / Dark Mode"
              className="w-9 h-9 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface flex items-center justify-center transition-colors"
            >
              <span className="material-symbols-outlined text-[19px]">
                {isDarkMode ? 'light_mode' : 'dark_mode'}
              </span>
            </button>
          </div>

          {/* User Account / Bench Badge */}
          <button
            onClick={onOpenAuth}
            className="flex items-center gap-2 pl-2.5 pr-3 py-1 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface transition-colors border border-outline-variant/20 shadow-2xs"
            title="Manage Bench Station & Student Profile"
          >
            <div
              className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: currentUser.avatarColor || '#14422d' }}
            >
              {currentUser.name ? (
                currentUser.name.charAt(0).toUpperCase()
              ) : (
                <span className="material-symbols-outlined text-[15px]">person</span>
              )}
            </div>
            <div className="flex flex-col text-left">
              <span className="font-label-md text-xs font-semibold leading-none">
                {currentUser.name || currentUser.benchId || 'Bench Unassigned'}
              </span>
              <span className="font-metric-reticle text-[10px] text-on-surface-variant leading-none mt-0.5">
                {currentUser.name ? currentUser.benchId || 'Station' : 'Sign In'}
              </span>
            </div>
          </button>
        </div>
      </div>
    </header>
  );
};
