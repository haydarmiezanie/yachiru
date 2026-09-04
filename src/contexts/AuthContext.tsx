import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
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
  signInWithGoogleRedirect: () => Promise<void>;
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

    // Check for any redirect sign-in results (fallback when popups are blocked)
    getRedirectResult(auth)
      .then((result) => {
        if (result && result.user) {
          console.log('Successfully authenticated via redirect:', result.user.email);
        }
      })
      .catch((err: any) => {
        console.error('Redirect sign-in error:', err);
        const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
        if (err.code === 'auth/unauthorized-domain') {
          setAuthError(
            `Domain "${currentHost}" is not authorized in Firebase. Please add "${currentHost}" to Firebase Console > Authentication > Settings > Authorized domains.`
          );
        } else {
          setAuthError(err.message || 'Redirect sign-in failed. Please try again.');
        }
      });

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

      // Seed immediate baseline profile so the interface never freezes on offline/latency
      const defaultProfile: UserProfile = {
        uid: firebaseUser.uid,
        email: email,
        displayName: firebaseUser.displayName || email.split('@')[0] || 'User',
        role: isSuperAdmin ? 'admin' : 'viewer',
        status: isSuperAdmin ? 'approved' : 'pending',
        photoURL: firebaseUser.photoURL || undefined,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      };
      setProfile((prev) => prev || defaultProfile);

      // Real-time listener for profile changes (handles both offline cache and live server updates seamlessly)
      unsubscribeProfile = onSnapshot(
        userRef,
        async (snapshot) => {
          const hasPendingWrites = snapshot.metadata?.hasPendingWrites;
          if (snapshot.exists()) {
            const remoteProfile = snapshot.data() as UserProfile;
            setProfile(remoteProfile);
            setLoading(false);

            if (isSuperAdmin && (remoteProfile.role !== 'admin' || remoteProfile.status !== 'approved')) {
              try {
                await updateDoc(userRef, {
                  role: 'admin',
                  status: 'approved',
                  lastLoginAt: new Date().toISOString(),
                });
              } catch (updateErr) {
                console.warn('Could not sync super admin elevation:', updateErr);
              }
            }
          } else if (!hasPendingWrites) {
            // Document does not exist yet on server or in local pending queue: bootstrap new profile
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
              console.warn('Could not query email invites (using default role/status):', e);
            }

            const newProfile: UserProfile = {
              uid: firebaseUser.uid,
              email: email,
              displayName: firebaseUser.displayName || email.split('@')[0] || 'User',
              role: initialRole,
              status: initialStatus,
              photoURL: firebaseUser.photoURL || undefined,
              createdAt: new Date().toISOString(),
              lastLoginAt: new Date().toISOString(),
            };

            try {
              await setDoc(userRef, newProfile);
              setProfile(newProfile);
            } catch (createErr: any) {
              if (createErr?.message?.includes('the client is offline')) {
                console.warn('User profile creation queued locally (client currently offline)');
              } else {
                console.error('Error creating user profile:', createErr);
              }
            }
            setLoading(false);
          }
        },
        (err) => {
          if (err.message.includes('the client is offline') || err.message.includes('offline')) {
            console.warn('User profile listener operating in offline mode.');
          } else {
            console.error('User profile subscription error:', err);
          }
          setLoading(false);
        }
      );
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
      const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
      if (err.code === 'auth/unauthorized-domain') {
        setAuthError(
          `Domain "${currentHost}" is not authorized in Firebase. Please add "${currentHost}" to Firebase Console > Authentication > Settings > Authorized domains.`
        );
      } else if (err.code === 'auth/popup-blocked') {
        setAuthError('Sign-in popup was blocked by your browser. Please allow popups for this site or use the redirect sign-in option below.');
      } else if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        setAuthError(
          `Google sign-in popup was closed or cancelled. If you did not close it manually, ensure "${currentHost}" is added to Firebase Console > Authentication > Settings > Authorized domains, or use Full-Page Redirect below.`
        );
      } else if (err.code === 'auth/operation-not-allowed') {
        setAuthError('Google Sign-In is not enabled in Firebase Console > Authentication > Sign-in method.');
      } else {
        setAuthError(err.message || 'Google sign-in failed. Please try again.');
      }
      setLoading(false);
    }
  };

  const signInWithGoogleRedirect = async () => {
    setLoading(true);
    setAuthError(null);
    try {
      await signInWithRedirect(auth, googleProvider);
    } catch (err: any) {
      console.error('Google Redirect Sign-In Error:', err);
      const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
      if (err.code === 'auth/unauthorized-domain') {
        setAuthError(
          `Domain "${currentHost}" is not authorized in Firebase. Please add "${currentHost}" to Firebase Console > Authentication > Settings > Authorized domains.`
        );
      } else {
        setAuthError(err.message || 'Google redirect sign-in failed. Please try again.');
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
          'Email/Password sign-in is not enabled in Firebase Console. Please enable it in Firebase Console > Authentication > Sign-in method > Email/Password.'
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
          'Email/Password registration is not enabled in Firebase Console. Please enable it in Firebase Console > Authentication > Sign-in method > Email/Password.'
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
        signInWithGoogleRedirect,
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
