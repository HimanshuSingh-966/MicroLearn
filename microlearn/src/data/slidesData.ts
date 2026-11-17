import type { PreparedSlide, PeerStation, UserProfile } from '../types/microscope.ts';

export const PREPARED_SLIDES: PreparedSlide[] = [];

export const INITIAL_PEER_STATIONS: PeerStation[] = [];

export const DEFAULT_USER_PROFILE: UserProfile = {
  id: '',
  name: '',
  email: '',
  studentId: '',
  benchId: '',
  role: 'Student',
  avatarColor: '#14422d',
  isAdultConfirmed: false,
};
