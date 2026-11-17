import React, { useState } from 'react';
import type { UserProfile } from '../types/microscope.ts';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  onUpdateUser: (user: UserProfile) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUpdateUser,
}) => {
  const [activeTab, setActiveTab] = useState<'current' | 'signin'>(
    currentUser.name ? 'current' : 'signin'
  );
  const [name, setName] = useState(currentUser.name);
  const [email, setEmail] = useState(currentUser.email);
  const [studentId, setStudentId] = useState(currentUser.studentId);
  const [benchId, setBenchId] = useState(currentUser.benchId || 'Bench #01-A');
  const [role, setRole] = useState<UserProfile['role']>(currentUser.role || 'Student');
  const [isAdultConfirmed, setIsAdultConfirmed] = useState<boolean>(currentUser.isAdultConfirmed ?? false);
  const [isEditing, setIsEditing] = useState(false);

  // New login form state
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newStudentId, setNewStudentId] = useState('');
  const [newBench, setNewBench] = useState('Bench #01-A');
  const [newRole, setNewRole] = useState<UserProfile['role']>('Student');
  const [newIsAdult, setNewIsAdult] = useState<boolean>(true);

  if (!isOpen) return null;

  const handleUpdateCurrent = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateUser({
      ...currentUser,
      name,
      email,
      studentId,
      benchId,
      role,
      isAdultConfirmed,
    });
    setIsEditing(false);
  };

  const handleSignInNew = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !newName) return;
    const user: UserProfile = {
      id: `usr-${Date.now()}`,
      name: newName.trim(),
      email: newEmail.trim(),
      studentId: newStudentId.trim() || 'BIO-' + Math.floor(1000 + Math.random() * 9000),
      benchId: newBench,
      role: newRole,
      avatarColor: '#14422d',
      isAdultConfirmed: newIsAdult,
    };
    onUpdateUser(user);
    setName(user.name);
    setEmail(user.email);
    setStudentId(user.studentId);
    setBenchId(user.benchId);
    setRole(user.role);
    setIsAdultConfirmed(user.isAdultConfirmed ?? false);
    setActiveTab('current');
    onClose();
  };

  const handleSignOut = () => {
    const guestUser: UserProfile = {
      id: '',
      name: '',
      email: '',
      studentId: '',
      benchId: '',
      role: 'Student',
      avatarColor: '#14422d',
    };
    onUpdateUser(guestUser);
    setName('');
    setEmail('');
    setStudentId('');
    setBenchId('');
    setRole('Student');
    setActiveTab('signin');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="bg-surface-container-lowest text-on-surface rounded-2xl w-full max-w-lg p-6 shadow-2xl border border-outline-variant/30 flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-on-primary font-bold shadow-xs">
              <span className="material-symbols-outlined text-[22px]">badge</span>
            </div>
            <div>
              <h2 id="auth-modal-title" className="font-headline-sm text-lg text-primary font-display">
                MicroLearn Workstation Access
              </h2>
              <p className="font-body-sm text-xs text-on-surface-variant">
                Manage bench assignment, credentials, and observation authoring identity.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-on-surface-variant hover:bg-surface-container"
            aria-label="Close dialog"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex bg-surface-container p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('current')}
            className={`flex-1 py-1.5 text-xs font-label-md rounded-lg transition-all ${
              activeTab === 'current'
                ? 'bg-surface-container-lowest text-primary shadow-xs font-semibold'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Current Workstation Profile
          </button>
          <button
            onClick={() => setActiveTab('signin')}
            className={`flex-1 py-1.5 text-xs font-label-md rounded-lg transition-all ${
              activeTab === 'signin'
                ? 'bg-surface-container-lowest text-primary shadow-xs font-semibold'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Sign In / Switch Bench
          </button>
        </div>

        {/* Tab 1: Current Station Info */}
        {activeTab === 'current' ? (
          <div>
            {!isEditing ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3 p-3.5 bg-surface-container-low rounded-2xl border border-outline-variant/20">
                  <div className="w-12 h-12 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold text-base shadow-xs font-display">
                    {currentUser.name ? (
                      currentUser.name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                    ) : (
                      <span className="material-symbols-outlined text-[20px]">person</span>
                    )}
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-headline-sm text-base text-on-surface font-bold">
                        {currentUser.name || 'Guest / Unassigned'}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-primary-fixed text-primary font-label-sm text-[10px] font-semibold">
                        {currentUser.role}
                      </span>
                    </div>
                    <span className="font-body-sm text-xs text-on-surface-variant">
                      {currentUser.email || 'No email registered'}
                    </span>
                    <span className="font-metric-reticle text-[11px] text-primary font-medium mt-0.5">
                      ID: {currentUser.studentId || 'N/A'} • Workstation: {currentUser.benchId || 'Bench Unassigned'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 font-body-sm text-xs">
                  <div className="bg-surface-container p-3 rounded-xl flex flex-col gap-0.5">
                    <span className="font-label-sm text-[10px] text-on-surface-variant uppercase">
                      Workstation Assigned
                    </span>
                    <span className="font-metric-reticle font-bold text-primary">
                      {currentUser.benchId || 'Unassigned'}
                    </span>
                  </div>
                  <div className="bg-surface-container p-3 rounded-xl flex flex-col gap-0.5">
                    <span className="font-label-sm text-[10px] text-on-surface-variant uppercase">
                      Classroom Section
                    </span>
                    <span className="font-metric-reticle font-bold text-primary">Biology Lab</span>
                  </div>
                  <div className="bg-surface-container p-3 rounded-xl flex flex-col gap-0.5">
                    <span className="font-label-sm text-[10px] text-on-surface-variant uppercase">
                      Permission Level
                    </span>
                    <span className="font-label-md font-semibold text-on-surface">
                      Full Optics & Capture
                    </span>
                  </div>
                  <div className="bg-surface-container p-3 rounded-xl flex flex-col gap-0.5">
                    <span className="font-label-sm text-[10px] text-on-surface-variant uppercase">
                      Session
                    </span>
                    <span className="font-metric-reticle text-[#22c55e] flex items-center gap-1 font-semibold">
                      <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
                      {currentUser.name ? 'Authenticated' : 'Guest Mode'}
                    </span>
                  </div>
                  <div className="bg-surface-container p-3 rounded-xl flex flex-col gap-0.5 col-span-2">
                    <span className="font-label-sm text-[10px] text-on-surface-variant uppercase">
                      Age Self-Confirmation (AI Cytology)
                    </span>
                    <span className={`font-label-md font-semibold flex items-center gap-1 ${currentUser.isAdultConfirmed ? 'text-[#22c55e]' : 'text-amber-500'}`}>
                      <span className="material-symbols-outlined text-[15px]">
                        {currentUser.isAdultConfirmed ? 'verified' : 'gpp_maybe'}
                      </span>
                      {currentUser.isAdultConfirmed ? '18+ self-confirmed • Full AI Access' : '18+ not confirmed • AI Cytology Restricted'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-surface-container-high">
                  {currentUser.name ? (
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="px-3 py-1.5 text-error hover:bg-error-container/20 rounded-xl font-label-md text-xs transition-colors flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[16px]">logout</span>
                      <span>Sign Out</span>
                    </button>
                  ) : (
                    <span />
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="px-3.5 py-1.5 bg-surface-container hover:bg-surface-container-high text-on-surface rounded-xl font-label-md text-xs transition-colors flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-[16px]">edit</span>
                      <span>Edit Info</span>
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 py-1.5 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-label-md text-xs font-semibold transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleUpdateCurrent} className="flex flex-col gap-3 font-body-sm text-xs">
                <div>
                  <label className="font-label-sm text-on-surface-variant block mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    placeholder="e.g. Maria Santos"
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl px-3 py-2 text-on-surface focus:outline-none focus:border-primary text-xs"
                  />
                </div>

                <div>
                  <label className="font-label-sm text-on-surface-variant block mb-1">
                    Student / Faculty Email
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    placeholder="name@school.edu"
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl px-3 py-2 text-on-surface focus:outline-none focus:border-primary text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-label-sm text-on-surface-variant block mb-1">
                      Student ID
                    </label>
                    <input
                      type="text"
                      required
                      value={studentId}
                      placeholder="e.g. BIO-2041"
                      onChange={(e) => setStudentId(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl px-3 py-2 text-on-surface focus:outline-none focus:border-primary text-xs"
                    />
                  </div>
                  <div>
                    <label className="font-label-sm text-on-surface-variant block mb-1">
                      Workstation Bench
                    </label>
                    <select
                      value={benchId}
                      onChange={(e) => setBenchId(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl px-3 py-2 text-on-surface focus:outline-none focus:border-primary text-xs"
                    >
                      <option value="Bench #01-A">Bench #01-A</option>
                      <option value="Bench #02-B">Bench #02-B</option>
                      <option value="Bench #03-A">Bench #03-A</option>
                      <option value="Bench #04-B">Bench #04-B</option>
                      <option value="Bench #05-A">Bench #05-A</option>
                      <option value="Bench #06-Instructor">Bench #06 (Instructor)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="font-label-sm text-on-surface-variant block mb-1">Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserProfile['role'])}
                    className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl px-3 py-2 text-on-surface focus:outline-none focus:border-primary text-xs"
                  >
                    <option value="Student">Student (Field Investigator)</option>
                    <option value="Lab Assistant">Lab Assistant (Peer Monitor)</option>
                    <option value="Instructor">Instructor (Broadcast Lead)</option>
                  </select>
                </div>

                <div className="flex items-center gap-2 pt-1 p-2 bg-surface-container rounded-xl">
                  <input
                    type="checkbox"
                    id="adult-confirm-edit"
                    checked={isAdultConfirmed}
                    onChange={(e) => setIsAdultConfirmed(e.target.checked)}
                    className="accent-primary w-4 h-4 rounded cursor-pointer"
                  />
                  <label htmlFor="adult-confirm-edit" className="text-xs text-on-surface cursor-pointer select-none">
                    I confirm I am 18 years of age or older (Required for AI cytology assistant)
                  </label>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-container-high">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-3.5 py-1.5 bg-surface-container text-on-surface-variant hover:text-on-surface rounded-xl font-label-md text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-label-md text-xs font-semibold"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <form onSubmit={handleSignInNew} className="flex flex-col gap-3 font-body-sm text-xs">
            <p className="text-on-surface-variant text-xs">
              Enter your student or instructor credentials to log into this workstation:
            </p>

            <div>
              <label className="font-label-sm text-on-surface-variant block mb-1">Your Full Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Maria Santos"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl px-3 py-2 text-on-surface focus:outline-none focus:border-primary text-xs"
              />
            </div>

            <div>
              <label className="font-label-sm text-on-surface-variant block mb-1">Institutional Email</label>
              <input
                type="email"
                required
                placeholder="name@school.edu"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl px-3 py-2 text-on-surface focus:outline-none focus:border-primary text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-label-sm text-on-surface-variant block mb-1">
                  Student ID (Optional)
                </label>
                <input
                  type="text"
                  placeholder="BIO-1042"
                  value={newStudentId}
                  onChange={(e) => setNewStudentId(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl px-3 py-2 text-on-surface focus:outline-none focus:border-primary text-xs"
                />
              </div>

              <div>
                <label className="font-label-sm text-on-surface-variant block mb-1">
                  Workstation Bench
                </label>
                <select
                  value={newBench}
                  onChange={(e) => setNewBench(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl px-3 py-2 text-on-surface focus:outline-none focus:border-primary text-xs"
                >
                  <option value="Bench #01-A">Bench #01-A</option>
                  <option value="Bench #02-B">Bench #02-B</option>
                  <option value="Bench #03-A">Bench #03-A</option>
                  <option value="Bench #04-B">Bench #04-B</option>
                  <option value="Bench #05-A">Bench #05-A</option>
                  <option value="Bench #06-Instructor">Bench #06 (Instructor)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="font-label-sm text-on-surface-variant block mb-1">Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserProfile['role'])}
                className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl px-3 py-2 text-on-surface focus:outline-none focus:border-primary text-xs"
              >
                <option value="Student">Student (Field Investigator)</option>
                <option value="Lab Assistant">Lab Assistant (Peer Monitor)</option>
                <option value="Instructor">Instructor (Broadcast Lead)</option>
              </select>
            </div>

            <div className="flex items-center gap-2 pt-1 p-2 bg-surface-container rounded-xl">
              <input
                type="checkbox"
                id="adult-confirm-new"
                checked={newIsAdult}
                onChange={(e) => setNewIsAdult(e.target.checked)}
                className="accent-primary w-4 h-4 rounded cursor-pointer"
              />
              <label htmlFor="adult-confirm-new" className="text-xs text-on-surface cursor-pointer select-none">
                I confirm I am 18 years of age or older (Required for AI cytology assistant)
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-surface-container-high">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 bg-surface-container text-on-surface-variant hover:text-on-surface rounded-xl font-label-md text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-1.5 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-label-md text-xs font-semibold shadow-xs flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">login</span>
                <span>Sign In to Workstation</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
