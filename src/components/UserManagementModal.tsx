import React, { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  setDoc,
  deleteDoc,
  query,
  orderBy,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { UserProfile, UserRole, UserStatus, AccessRequest } from '../types/auth';
import { useAuth } from '../contexts/AuthContext';
import {
  X,
  Users,
  UserPlus,
  Shield,
  ShieldCheck,
  Check,
  Ban,
  Clock,
  Trash2,
  Search,
  AlertCircle,
  Key,
} from 'lucide-react';

interface UserManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UserManagementModal: React.FC<UserManagementModalProps> = ({ isOpen, onClose }) => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [search, setSearch] = useState('');
  const [activeSubTab, setActiveSubTab] = useState<'users' | 'requests' | 'add'>('users');

  // Add new user form state
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('auditor');
  const [addingUser, setAddingUser] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Listen to users collection without orderBy so documents without createdAt are not omitted by Firestore
    const usersQuery = collection(db, 'users');
    const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
      const uList: UserProfile[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        // If a document was marked as revoked, permanently delete it from Firestore!
        if (data.status === 'revoked') {
          deleteDoc(doc(db, 'users', d.id)).catch(() => {});
          return;
        }
        const uid = data.uid || d.id;
        const rawEmail = (data.email || (d.id.startsWith('invite_') ? d.id.replace('invite_', '') : '')).toLowerCase().trim();
        uList.push({
          ...data,
          uid,
          id: d.id,
          email: rawEmail,
          displayName: data.displayName || (rawEmail ? rawEmail.split('@')[0] : uid.slice(0, 8)),
          role: (data.role as UserRole) || 'viewer',
          status: (data.status as UserStatus) || 'pending',
          createdAt: data.createdAt || '',
          lastLoginAt: data.lastLoginAt || 'Never logged in',
          notes: data.notes || '',
        } as UserProfile);
      });
      setUsers(uList);
    }, (err) => {
      console.error('Error fetching users:', err);
    });

    // Listen to access requests
    const reqQuery = collection(db, 'access_requests');
    const unsubReqs = onSnapshot(reqQuery, (snapshot) => {
      const rList: AccessRequest[] = [];
      snapshot.forEach((d) => {
        rList.push({ id: d.id, ...d.data() } as AccessRequest);
      });
      // Sort requests descending by creation time in memory
      rList.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
      });
      setRequests(rList);
    }, (err) => {
      console.error('Error fetching requests:', err);
    });

    return () => {
      unsubUsers();
      unsubReqs();
    };
  }, [isOpen]);

  // Consolidate users by email / unique ID (prioritizes real auth UID over invite docs)
  const consolidatedUsers = React.useMemo(() => {
    const map = new Map<string, UserProfile>();
    for (const u of users) {
      if (u.status === 'revoked') continue;
      // Key by normalized email if present, otherwise by uid so no user is ever skipped
      const key = (u.email || u.uid || u.id).toLowerCase().trim();
      if (!key) continue;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, u);
      } else {
        const isRealU = !u.uid.startsWith('invite_');
        const primary = isRealU ? u : existing;
        const secondary = isRealU ? existing : u;

        // Clean up redundant invite doc from Firestore if a real authenticated account exists
        if (secondary.uid.startsWith('invite_')) {
          deleteDoc(doc(db, 'users', secondary.id || secondary.uid)).catch(() => {});
        }

        const roleOrder: Record<UserRole, number> = { admin: 3, auditor: 2, viewer: 1 };
        const highestRole = (roleOrder[primary.role] || 1) >= (roleOrder[secondary.role] || 1) ? primary.role : secondary.role;
        const isApproved = primary.status === 'approved' || secondary.status === 'approved';

        map.set(key, {
          ...primary,
          status: isApproved ? 'approved' : primary.status,
          role: highestRole,
          displayName: primary.displayName || secondary.displayName,
          lastLoginAt: primary.lastLoginAt !== 'Never logged in' ? primary.lastLoginAt : secondary.lastLoginAt,
        });
      }
    }
    const result = Array.from(map.values());
    result.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    });
    return result;
  }, [users]);

  const handlePermanentDeleteUser = async (targetUser: UserProfile) => {
    const userLabel = targetUser.email || targetUser.displayName || targetUser.uid;
    if (
      !window.confirm(
        `Are you sure you want to permanently delete user "${userLabel}"?\n\nThis will completely remove their account, whitelist entry, and access permissions from Firestore.`
      )
    ) {
      return;
    }
    try {
      // 1. Delete user document from users collection
      await deleteDoc(doc(db, 'users', targetUser.uid)).catch(() => {});
      if (targetUser.id && targetUser.id !== targetUser.uid) {
        await deleteDoc(doc(db, 'users', targetUser.id)).catch(() => {});
      }

      // 2. Delete any invite document associated with this email
      if (targetUser.email) {
        const cleanEmailKey = targetUser.email.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, '_');
        await deleteDoc(doc(db, 'users', `invite_${cleanEmailKey}`)).catch(() => {});
      }

      // 3. Delete any access_request document associated with this uid
      await deleteDoc(doc(db, 'access_requests', targetUser.uid)).catch(() => {});

      // 4. Delete any matching duplicate documents by email
      if (targetUser.email) {
        const emailLower = targetUser.email.toLowerCase().trim();
        const duplicates = users.filter((u) => u.email?.toLowerCase().trim() === emailLower && u.uid !== targetUser.uid);
        for (const dup of duplicates) {
          await deleteDoc(doc(db, 'users', dup.uid)).catch(() => {});
          if (dup.id && dup.id !== dup.uid) {
            await deleteDoc(doc(db, 'users', dup.id)).catch(() => {});
          }
        }
      }

      // Optimistically update local state
      setUsers((prev) =>
        prev.filter((u) => u.uid !== targetUser.uid && (!targetUser.email || u.email?.toLowerCase().trim() !== targetUser.email.toLowerCase().trim()))
      );
      setActionMsg({ type: 'success', text: `User ${userLabel} permanently deleted.` });
    } catch (e: any) {
      setActionMsg({ type: 'error', text: e.message || 'Failed to permanently delete user.' });
    }
  };

  const handleUpdateStatus = async (uid: string, status: UserStatus) => {
    const target = users.find((u) => u.uid === uid);
    if (status === 'revoked') {
      if (target) {
        await handlePermanentDeleteUser(target);
      } else {
        await deleteDoc(doc(db, 'users', uid)).catch(() => {});
      }
      return;
    }
    try {
      await updateDoc(doc(db, 'users', uid), { status });
      if (target?.email) {
        const others = users.filter((u) => u.email.toLowerCase() === target.email.toLowerCase() && u.uid !== uid);
        for (const other of others) {
          await updateDoc(doc(db, 'users', other.uid), { status }).catch(() => {});
        }
      }
      setActionMsg({ type: 'success', text: `User status updated to ${status}` });
    } catch (e: any) {
      setActionMsg({ type: 'error', text: e.message || 'Failed to update user status' });
    }
  };

  const handleUpdateRole = async (uid: string, role: UserRole) => {
    try {
      await updateDoc(doc(db, 'users', uid), { role });
      const target = users.find((u) => u.uid === uid);
      if (target?.email) {
        const others = users.filter((u) => u.email.toLowerCase() === target.email.toLowerCase() && u.uid !== uid);
        for (const other of others) {
          await updateDoc(doc(db, 'users', other.uid), { role }).catch(() => {});
        }
      }
      setActionMsg({ type: 'success', text: `User role updated to ${role}` });
    } catch (e: any) {
      setActionMsg({ type: 'error', text: e.message || 'Failed to update user role' });
    }
  };

  const handleApproveRequest = async (req: AccessRequest) => {
    try {
      // 1. Update user doc if exists
      const userRef = doc(db, 'users', req.uid);
      await updateDoc(userRef, {
        status: 'approved',
        role: 'auditor',
      }).catch(async () => {
        // If not exists yet, create it
        await setDoc(userRef, {
          uid: req.uid,
          email: req.email,
          displayName: req.displayName || req.email.split('@')[0],
          role: 'auditor',
          status: 'approved',
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        });
      });

      // 2. Mark request as approved
      await updateDoc(doc(db, 'access_requests', req.id), { status: 'approved' });
      setActionMsg({ type: 'success', text: `Access approved for ${req.email}` });
    } catch (e: any) {
      setActionMsg({ type: 'error', text: e.message || 'Failed to approve access' });
    }
  };

  const handleRejectRequest = async (reqId: string) => {
    try {
      await deleteDoc(doc(db, 'access_requests', reqId));
      setActionMsg({ type: 'success', text: 'Access request permanently rejected & removed' });
    } catch (e: any) {
      setActionMsg({ type: 'error', text: e.message || 'Failed to reject access request' });
    }
  };

  const handleAddNewUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAddingUser(true);
    setActionMsg(null);
    try {
      const cleanEmail = newEmail.toLowerCase().trim();
      const pseudoUid = 'invite_' + cleanEmail.replace(/[^a-zA-Z0-9]/g, '_');
      await setDoc(doc(db, 'users', pseudoUid), {
        uid: pseudoUid,
        email: cleanEmail,
        displayName: newName.trim() || cleanEmail.split('@')[0],
        role: newRole,
        status: 'approved',
        createdAt: new Date().toISOString(),
        lastLoginAt: 'Never logged in',
        notes: 'Pre-whitelisted by administrator',
      });

      // If a real account already logged in with this email, approve and elevate it too
      const existing = users.filter((u) => u.email.toLowerCase() === cleanEmail);
      for (const ex of existing) {
        await updateDoc(doc(db, 'users', ex.uid), {
          role: newRole,
          status: 'approved',
        }).catch(() => {});
      }

      setNewEmail('');
      setNewName('');
      setActionMsg({ type: 'success', text: `User ${cleanEmail} successfully added to whitelist (${newRole})!` });
      setActiveSubTab('users');
    } catch (e: any) {
      setActionMsg({ type: 'error', text: e.message || 'Failed to add user to whitelist' });
    } finally {
      setAddingUser(false);
    }
  };

  if (!isOpen) return null;

  const filteredUsers = consolidatedUsers.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.displayName.toLowerCase().includes(search.toLowerCase())
  );

  const pendingRequests = requests.filter((r) => r.status === 'pending');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="relative flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-mono text-base font-bold text-white flex items-center gap-2">
                Team Access Control & Whitelist
                <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/20">
                  Admin Only
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Manage auditor privileges, role-based access control (Admin/Auditor/Viewer), and user whitelist authorizations.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Sub Tabs */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/20 px-6 py-2">
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => setActiveSubTab('users')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-all ${
                activeSubTab === 'users'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              <span>User Directory ({users.length})</span>
            </button>
            <button
              onClick={() => setActiveSubTab('requests')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-all ${
                activeSubTab === 'requests'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>Access Requests</span>
              {pendingRequests.length > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-bold text-slate-950">
                  {pendingRequests.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveSubTab('add')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-all ${
                activeSubTab === 'add'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>+ Whitelist New User</span>
            </button>
          </div>

          {activeSubTab === 'users' && (
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or email..."
                className="w-full rounded-md border border-slate-800 bg-slate-950 py-1 pl-8 pr-2.5 text-xs text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Feedback Message */}
        {actionMsg && (
          <div
            className={`mx-6 mt-3 flex items-center justify-between rounded-lg p-2.5 text-xs ${
              actionMsg.type === 'success'
                ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-500/30'
                : 'bg-red-950/40 text-red-300 border border-red-500/30'
            }`}
          >
            <span>{actionMsg.text}</span>
            <button onClick={() => setActionMsg(null)} className="text-slate-400 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeSubTab === 'users' && (
            <div className="space-y-3">
              {filteredUsers.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-xs">
                  No users match your search criteria.
                </div>
              ) : (
                filteredUsers.map((u) => {
                  const isCurrent = u.uid === currentUser?.uid;
                  return (
                    <div
                      key={u.uid}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 transition-all hover:border-slate-700"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-800 font-mono text-xs font-bold text-amber-400 border border-slate-700">
                          {u.displayName ? u.displayName.slice(0, 2).toUpperCase() : (u.email || u.uid).slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white text-xs">{u.displayName || 'User'}</span>
                            {isCurrent && (
                              <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[10px] text-amber-400 font-medium border border-slate-700">
                                You
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-xs text-slate-400">{u.email || u.uid}</span>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            Last active: {u.lastLoginAt ? (u.lastLoginAt.includes('T') ? new Date(u.lastLoginAt).toLocaleString() : u.lastLoginAt) : 'Never'}
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-3 self-end sm:self-center">
                        {/* Role Selector */}
                        <div className="flex items-center gap-1.5">
                          <label className="text-[11px] text-slate-400">Role:</label>
                          <select
                            value={u.role || 'viewer'}
                            disabled={isCurrent && u.role === 'admin'}
                            onChange={(e) => handleUpdateRole(u.uid, e.target.value as UserRole)}
                            className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-white focus:border-amber-500 focus:outline-none"
                          >
                            <option value="admin">Admin (Full Control)</option>
                            <option value="auditor">Auditor (Run Scans & DDL)</option>
                            <option value="viewer">Viewer (Read-Only)</option>
                          </select>
                        </div>

                        {/* Status Badge & Actions */}
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase ${
                              u.status === 'approved'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            }`}
                          >
                            {u.status}
                          </span>

                          {u.status === 'pending' && (
                            <button
                              onClick={() => handleUpdateStatus(u.uid, 'approved')}
                              title="Approve Access"
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-emerald-950/80 hover:text-emerald-400 transition-colors cursor-pointer"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                          )}

                          <button
                            disabled={isCurrent}
                            onClick={() => handlePermanentDeleteUser(u)}
                            title={isCurrent ? 'You cannot delete your own admin account' : 'Permanently Delete User from Database'}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-red-950/80 hover:text-red-400 transition-colors disabled:opacity-20 cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeSubTab === 'requests' && (
            <div className="space-y-3">
              {requests.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-xs">
                  No pending access requests.
                </div>
              ) : (
                requests.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white text-xs">{r.displayName || 'User'}</span>
                        <span className="font-mono text-xs text-amber-300">({r.email})</span>
                        <span
                          className={`rounded-full px-2 py-0.2 text-[10px] uppercase font-semibold ${
                            r.status === 'pending'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : r.status === 'approved'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}
                        >
                          {r.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-300 italic bg-slate-900/80 p-2 rounded-lg border border-slate-800/80">
                        "{r.reason || 'No specific notes provided'}"
                      </p>
                      <div className="mt-1 text-[10px] text-slate-500">
                        Submitted on: {new Date(r.createdAt).toLocaleString()}
                      </div>
                    </div>

                    {r.status === 'pending' && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleApproveRequest(r)}
                          className="flex items-center gap-1 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors cursor-pointer"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>Approve</span>
                        </button>
                        <button
                          onClick={() => handleRejectRequest(r.id)}
                          className="flex items-center gap-1 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Reject & Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeSubTab === 'add' && (
            <div className="max-w-md mx-auto py-4">
              <div className="mb-6 rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-300">
                <p className="font-semibold text-white mb-1">Pre-Whitelist Team Member</p>
                <p className="text-slate-400">
                  Pre-register colleague or team member emails in advance. When they authenticate via Google or Email, their accounts will automatically be activated with <strong>Approved</strong> status.
                </p>
              </div>

              <form onSubmit={handleAddNewUser} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">User Email Address</label>
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 py-2 px-3 text-xs text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">User Full Name (Optional)</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Sarah Connor / Platform Team"
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 py-2 px-3 text-xs text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Assigned Role</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 py-2 px-3 text-xs text-white focus:border-amber-500 focus:outline-none"
                  >
                    <option value="admin">Admin (Full Control & Team Management)</option>
                    <option value="auditor">Auditor (Run Scans, Deep Dives & DDL Migrations)</option>
                    <option value="viewer">Viewer (Read-Only Insights)</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={addingUser || !newEmail.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 py-2.5 text-xs font-semibold text-slate-950 shadow-md shadow-amber-500/20 hover:from-amber-400 hover:to-orange-400 active:scale-[0.98] disabled:opacity-50 transition-all cursor-pointer"
                >
                  <UserPlus className="h-4 w-4" />
                  <span>{addingUser ? 'Saving...' : 'Add to Whitelist'}</span>
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
