import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar.tsx';
import { Header } from './components/Header.tsx';
import { LiveStageView } from './components/LiveStageView.tsx';
import { AuthModal } from './components/AuthModal.tsx';
import { DEFAULT_USER_PROFILE } from './data/slidesData.ts';
import type { UserProfile, MicroscopeStatusChip } from './types/microscope.ts';

export default function App() {
  // Navigation tabs: 'live-microscope'
  const [currentTab, setCurrentTab] = useState<string>('live-microscope');

  // Mobile drawer state
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  // Authentication modal state
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);

  // Theme state: dark / light
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('microlearn_theme');
    if (saved) return saved === 'dark';
    return false;
  });

  // User workstation profile
  const [currentUser, setCurrentUser] = useState<UserProfile>(() => {
    const saved = localStorage.getItem('microlearn_user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    return DEFAULT_USER_PROFILE;
  });

  // Global microscope status chip: 'Connecting' | 'Live' | 'Capturing' | 'Analyzing' | 'Ready to inspect' | 'No signal'
  const [cameraStatus, setCameraStatus] = useState<MicroscopeStatusChip>('Connecting');

  // Apply dark mode class to root
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('microlearn_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('microlearn_theme', 'light');
    }
  }, [isDarkMode]);

  // Persist user
  useEffect(() => {
    localStorage.setItem('microlearn_user', JSON.stringify(currentUser));
  }, [currentUser]);

  const toggleDarkMode = () => setIsDarkMode((prev) => !prev);

  return (
    <div className="min-h-screen bg-background text-on-surface flex flex-col font-sans transition-colors duration-200">
      {/* Fixed Left Sidebar */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        currentUser={currentUser}
        isDarkMode={isDarkMode}
        onToggleDarkMode={toggleDarkMode}
        cameraStatus={cameraStatus}
        isMobileOpen={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        onOpenAuth={() => setIsAuthModalOpen(true)}
      />

      {/* Main Content Area */}
      <div className="lg:pl-64 flex flex-col flex-1 min-h-screen">
        {/* Top Header */}
        <Header
          status={cameraStatus}
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          onOpenAuth={() => setIsAuthModalOpen(true)}
          currentUser={currentUser}
          isDarkMode={isDarkMode}
          onToggleDarkMode={toggleDarkMode}
        />

        {/* Dynamic Page Views */}
        <main className="flex-1 w-full flex flex-col">
          <div key="live-stage" className="w-full animate-fade-in">
            <LiveStageView
              currentUser={currentUser}
              status={cameraStatus}
              onStatusChange={setCameraStatus}
            />
          </div>
        </main>
      </div>

      {/* User Authentication & Profile Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        currentUser={currentUser}
        onUpdateUser={setCurrentUser}
      />
    </div>
  );
}
