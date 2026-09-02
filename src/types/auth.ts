export type UserRole = 'admin' | 'auditor' | 'viewer';
export type UserStatus = 'approved' | 'pending' | 'revoked';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  lastLoginAt: string;
  notes?: string;
}

export interface AccessRequest {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}
