import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { auth, googleProvider, db } from '../lib/firebase';
import { UserProfile, UserRole, UserStatus } from '../types/auth';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAuthorized: boolean;
  isAdmin: boolean;
  isAuditor: boolean;
  isViewer: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
  submitAccessRequest: (reason: string) => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SUPER_ADMIN_EMAIL = 'idarstore24@gmail.com';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const clearError = () => setAuthError(null);

  // Sync auth state and user profile
  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setAuthError(null);

      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (!firebaseUser) {
        setProfile(null);
        setLoading(false);
        return;
      }

      const email = (firebaseUser.email || '').toLowerCase().trim();
      const userRef = doc(db, 'users', firebaseUser.uid);

      const isSuperAdmin = email === SUPER_ADMIN_EMAIL.toLowerCase();

      try {
        const docSnap = await getDoc(userRef);

        if (!docSnap.exists()) {
          // Check if there was a pre-whitelisted invite record by email
          let initialRole: UserRole = isSuperAdmin ? 'admin' : 'viewer';
          let initialStatus: UserStatus = isSuperAdmin ? 'approved' : 'pending';

          try {
            const usersByEmail = query(collection(db, 'users'), where('email', '==', email));
            const emailSnap = await getDocs(usersByEmail);
            if (!emailSnap.empty) {
              const inviteDoc = emailSnap.docs[0].data() as UserProfile;
              if (inviteDoc.role) initialRole = inviteDoc.role;
              if (inviteDoc.status) initialStatus = inviteDoc.status;
            }
          } catch (e) {
            console.warn('Could not query email invites:', e);
          }

          const newProfile: UserProfile = {
            uid: firebaseUser.uid,
            email: email,
            displayName: firebaseUser.displayName || email.split('@')[0] || 'User',
            role: initialRole,
            status: initialStatus,
            createdAt: new Date().toISOString(),
            lastLoginAt: new Date().toISOString(),
          };

          if (firebaseUser.photoURL) {
            newProfile.photoURL = firebaseUser.photoURL;
          }

          await setDoc(userRef, newProfile);
          setProfile(newProfile);
        } else {
          // Update last login
          const existing = docSnap.data() as UserProfile;
          if (isSuperAdmin && (existing.role !== 'admin' || existing.status !== 'approved')) {
            await updateDoc(userRef, {
              role: 'admin',
              status: 'approved',
              lastLoginAt: new Date().toISOString(),
            });
          } else {
            await updateDoc(userRef, {
              lastLoginAt: new Date().toISOString(),
            });
          }
        }

        // Real-time listener for profile changes (e.g. when an admin approves or updates role)
        unsubscribeProfile = onSnapshot(userRef, (snapshot) => {
          if (snapshot.exists()) {
            setProfile(snapshot.data() as UserProfile);
          }
          setLoading(false);
        }, (err) => {
          console.error('User profile subscription error:', err);
          setLoading(false);
        });
      } catch (err: any) {
        console.error('Error synchronizing user doc:', err);
        // Fallback profile if offline/permission issue
        setProfile({
          uid: firebaseUser.uid,
          email: email,
          displayName: firebaseUser.displayName || 'User',
          role: isSuperAdmin ? 'admin' : 'viewer',
          status: isSuperAdmin ? 'approved' : 'pending',
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        });
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  const signInWithGoogle = async () => {
    setLoading(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error('Google Sign-In Error:', err);
      if (err.code === 'auth/popup-closed-by-user') {
        setAuthError('Sign-in cancelled by user.');
      } else {
        setAuthError(err.message || 'Google sign-in failed. Please try again.');
      }
      setLoading(false);
    }
  };

  const signInWithEmail = async (email: string, pass: string) => {
    setLoading(true);
    setAuthError(null);
    try {
      const cleanEmail = email.trim();
      await signInWithEmailAndPassword(auth, cleanEmail, pass);
    } catch (err: any) {
      console.error('Email Sign-In Error:', err);
      if (err.code === 'auth/operation-not-allowed') {
        setAuthError(
          'Email/Password sign-in is not enabled on this Firebase project. Please use "Continue with Google" above to sign in directly.'
        );
      } else if (
        err.code === 'auth/invalid-credential' ||
        err.code === 'auth/wrong-password' ||
        err.code === 'auth/user-not-found' ||
        err.code === 'auth/invalid-login-credentials'
      ) {
        setAuthError('Invalid email or password. Please verify your credentials or create a new account.');
      } else if (err.code === 'auth/invalid-email') {
        setAuthError('Please enter a valid email address.');
      } else if (err.code === 'auth/user-disabled') {
        setAuthError('This user account has been disabled.');
      } else if (err.code === 'auth/too-many-requests') {
        setAuthError('Too many unsuccessful attempts. Access temporarily blocked for security. Please try again later.');
      } else {
        setAuthError(err.message || 'Sign in failed. Please check your credentials.');
      }
      setLoading(false);
    }
  };

  const signUpWithEmail = async (email: string, pass: string, name: string) => {
    setLoading(true);
    setAuthError(null);
    try {
      const cleanEmail = email.trim();
      const cred = await createUserWithEmailAndPassword(auth, cleanEmail, pass);
      if (name && name.trim()) {
        try {
          await updateProfile(cred.user, { displayName: name.trim() });
        } catch (e) {
          console.warn('Profile name update error:', e);
        }
      }
    } catch (err: any) {
      console.error('Email Sign-Up Error:', err);
      if (err.code === 'auth/operation-not-allowed') {
        setAuthError(
          'Email/Password registration is not enabled on this Firebase project. Please use "Continue with Google" above to sign in directly.'
        );
      } else if (err.code === 'auth/email-already-in-use') {
        setAuthError('This email is already registered. Please sign in instead.');
      } else if (err.code === 'auth/weak-password') {
        setAuthError('Password must be at least 6 characters long.');
      } else if (err.code === 'auth/invalid-email') {
        setAuthError('Please enter a valid email address.');
      } else {
        setAuthError(err.message || 'Registration failed. Please check your details.');
      }
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      await fbSignOut(auth);
      setProfile(null);
      setUser(null);
    } catch (err: any) {
      console.error('Sign out error:', err);
    }
  };

  const submitAccessRequest = async (reason: string) => {
    if (!user) return;
    try {
      const reqRef = doc(db, 'access_requests', user.uid);
      await setDoc(reqRef, {
        id: user.uid,
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || user.email?.split('@')[0] || 'User',
        reason: reason.trim() || 'Access required for ClickHouse cluster health inspection.',
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('Error submitting access request:', err);
      throw err;
    }
  };

  const isAuthorized = !!profile && profile.status === 'approved';
  const isAdmin = isAuthorized && profile.role === 'admin';
  const isAuditor = isAuthorized && (profile.role === 'admin' || profile.role === 'auditor');
  const isViewer = isAuthorized;

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        isAuthorized,
        isAdmin,
        isAuditor,
        isViewer,
        authError,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        signOut,
        submitAccessRequest,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
