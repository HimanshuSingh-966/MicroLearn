import React from 'react';
import type { UserProfile, MicroscopeStatusChip } from '../types/microscope.ts';

interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  currentUser: UserProfile;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  cameraStatus: MicroscopeStatusChip;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
  onOpenAuth: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  currentUser,
  isDarkMode,
  onToggleDarkMode,
  cameraStatus,
  isMobileOpen,
  onCloseMobile,
  onOpenAuth,
}) => {
  const navItems = [
    {
      id: 'live-microscope',
      label: 'Live Stage',
      icon: 'videocam',
      badge:
        cameraStatus === 'Live'
          ? 'LIVE'
          : cameraStatus === 'Ready to inspect'
          ? 'INSPECT'
          : undefined,
      badgeColor:
        cameraStatus === 'Live'
          ? 'bg-[#22c55e] text-white'
          : 'bg-primary text-on-primary',
    },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-xs"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={`fixed left-0 top-0 h-full w-64 bg-surface-container-low border-r border-outline-variant/30 z-50 flex flex-col justify-between py-4 shadow-sm transition-transform duration-300 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex flex-col gap-4">
          {/* Brand Header */}
          <div className="px-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-on-primary shadow-sm">
                <span className="material-symbols-outlined text-[20px]">biotech</span>
              </div>
              <div className="flex flex-col">
                <span className="font-headline-sm text-primary leading-none tracking-tight font-bold">
                  MicroLearn
                </span>
                <span className="font-label-sm text-[10px] text-on-surface-variant uppercase tracking-wider mt-0.5">
                  Classroom Optics
                </span>
              </div>
            </div>

            {/* Close button on mobile */}
            <button
              onClick={onCloseMobile}
              className="lg:hidden p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container"
              aria-label="Close sidebar"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {/* Raspberry Pi Camera & Sensor Status */}
          <div className="px-4">
            <div className="bg-surface-container rounded-xl p-3 flex flex-col gap-1.5 border border-outline-variant/20">
              <div className="flex items-center justify-between">
                <span className="font-label-sm text-[11px] text-on-surface-variant uppercase tracking-wide font-medium">
                  Optics Interface
                </span>
                <span
                  className={`font-label-sm text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    cameraStatus === 'Live'
                      ? 'bg-[#22c55e]/20 text-[#15803d] dark:text-[#4ade80]'
                      : cameraStatus === 'No signal'
                      ? 'bg-error/20 text-error'
                      : 'bg-primary-fixed text-primary'
                  }`}
                >
                  {cameraStatus}
                </span>
              </div>
              <div className="flex items-center gap-2 pt-1 text-on-surface text-xs">
                <span className="material-symbols-outlined text-[17px] text-primary">
                  photo_camera
                </span>
                <span className="font-label-md font-semibold text-xs">
                  Raspberry Pi Camera
                </span>
              </div>
              <span className="font-metric-reticle text-[11px] text-on-surface-variant">
                Manual Focus Microscope Stage
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex flex-col px-3 gap-1">
            {navItems.map((item) => {
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onSelectTab(item.id);
                    onCloseMobile();
                  }}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl font-label-md transition-all text-xs ${
                    isActive
                      ? 'bg-surface-container-highest text-primary font-bold shadow-2xs border-l-3 border-primary'
                      : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-metric-reticle ${item.badgeColor}`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer Controls & Station Identifier */}
        <div className="flex flex-col px-4 gap-3 pt-3 border-t border-outline-variant/20">
          {/* Dark Mode Quick Switch */}
          <button
            onClick={onToggleDarkMode}
            className="flex items-center justify-between w-full px-3 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high transition-colors text-on-surface text-xs font-label-md"
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">
                {isDarkMode ? 'dark_mode' : 'light_mode'}
              </span>
              <span>Dark Mode</span>
            </div>
            <span className="font-metric-reticle text-[10px] text-on-surface-variant uppercase">
              {isDarkMode ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* Workstation Profile Badge */}
          <button
            onClick={onOpenAuth}
            className="flex items-center justify-between p-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface transition-colors border border-outline-variant/20 text-left"
          >
            <div className="flex items-center gap-2.5">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: currentUser.avatarColor || '#14422d' }}
              />
              <div className="flex flex-col">
                <span className="font-label-md text-xs font-semibold leading-tight text-on-surface">
                  {currentUser.benchId || 'Bench Unassigned'}
                </span>
                <span className="font-body-sm text-[10px] text-on-surface-variant leading-tight">
                  {currentUser.name || 'Sign In / Profile'}
                </span>
              </div>
            </div>
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant">
              chevron_right
            </span>
          </button>

          <div className="flex items-center justify-between text-[10px] text-on-surface-variant font-metric-reticle px-1">
            <span>Raspberry Pi 4</span>
            <span
              className={
                cameraStatus === 'Live'
                  ? 'text-[#22c55e] font-semibold'
                  : cameraStatus === 'Connecting'
                  ? 'text-amber-500 font-semibold'
                  : cameraStatus === 'No signal'
                  ? 'text-error font-semibold'
                  : 'text-primary font-semibold'
              }
            >
              {cameraStatus === 'Live'
                ? 'STREAMING'
                : cameraStatus === 'Connecting'
                ? 'SIGNALING...'
                : cameraStatus === 'No signal'
                ? 'OFFLINE'
                : cameraStatus.toUpperCase()}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
