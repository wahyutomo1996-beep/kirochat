'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { LoadingState } from '@/components/LoadingState';

interface User {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
  createdAt: string;
  _count: { providers: number; conversations: number };
}

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchUsers(); }, []);

  const fetchUsers = async () => {
    const res = await fetch('/api/admin/users');
    if (res.ok) { const data = await res.json(); setUsers(data.users); }
    else if (res.status === 401) window.location.href = '/login';
    setLoading(false);
  };

  const updateUser = async (id: string, data: { status?: string; role?: string }) => {
    await fetch(`/api/admin/users/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    fetchUsers();
  };

  const deleteUser = async (id: string) => {
    if (!confirm('Delete this user permanently? All their data will be lost.')) return;
    await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    fetchUsers();
  };

  if (loading) return <LoadingState fullScreen />;

  const pendingUsers = users.filter(u => u.status === 'pending');
  const statusVariants: Record<string, 'success' | 'warning' | 'danger'> = {
    approved: 'success',
    pending: 'warning',
    banned: 'danger',
  };

  return (
    <div className="min-h-screen bg-surface-0">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 animate-fade-in">
          <div>
            <h1 className="text-2xl font-semibold text-white">Admin Panel</h1>
            <p className="text-txt-muted text-sm mt-1">Manage users and approvals</p>
          </div>
          <a href="/chat">
            <Button variant="secondary" size="sm">← Back to Chat</Button>
          </a>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6 animate-slide-up">
          <div className="bg-surface-1 border border-edge rounded-xl p-4">
            <p className="text-xs text-txt-muted uppercase tracking-wider font-semibold">Total Users</p>
            <p className="text-2xl font-semibold text-white mt-1">{users.length}</p>
          </div>
          <div className="bg-surface-1 border border-edge rounded-xl p-4">
            <p className="text-xs text-txt-muted uppercase tracking-wider font-semibold">Pending</p>
            <p className="text-2xl font-semibold text-yellow-400 mt-1">{pendingUsers.length}</p>
          </div>
          <div className="bg-surface-1 border border-edge rounded-xl p-4">
            <p className="text-xs text-txt-muted uppercase tracking-wider font-semibold">Approved</p>
            <p className="text-2xl font-semibold text-green-400 mt-1">{users.filter(u => u.status === 'approved').length}</p>
          </div>
        </div>

        {/* Pending */}
        {pendingUsers.length > 0 && (
          <div className="bg-yellow-500/5 border border-yellow-500/30 rounded-xl overflow-hidden mb-6 animate-slide-up">
            <div className="px-5 py-4 border-b border-yellow-500/20">
              <h2 className="text-base font-semibold text-yellow-400">Pending Approval ({pendingUsers.length})</h2>
              <p className="text-xs text-txt-muted mt-0.5">Review and approve new user registrations</p>
            </div>
            <div className="divide-y divide-yellow-500/10">
              {pendingUsers.map((user) => (
                <div key={user.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{user.username}</p>
                    <p className="text-xs text-txt-muted">{user.email}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => updateUser(user.id, { status: 'approved' })} variant="primary" size="xs">Approve</Button>
                    <Button onClick={() => updateUser(user.id, { status: 'banned' })} variant="danger" size="xs">Reject</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All Users */}
        <div className="bg-surface-1 border border-edge rounded-xl overflow-hidden animate-slide-up">
          <div className="px-5 py-4 border-b border-edge">
            <h2 className="text-base font-semibold text-white">All Users</h2>
            <p className="text-xs text-txt-muted mt-0.5">{users.length} registered accounts</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-surface-2">
                <tr>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-txt-muted uppercase tracking-wider">User</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-txt-muted uppercase tracking-wider">Role</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-txt-muted uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-txt-muted uppercase tracking-wider">Usage</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-txt-muted uppercase tracking-wider">Joined</th>
                  <th className="px-5 py-3 text-right text-[11px] font-semibold text-txt-muted uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-surface-2 transition-colors">
                    <td className="px-5 py-3">
                      <div className="text-sm font-medium text-white">{user.username}</div>
                      <div className="text-xs text-txt-muted">{user.email}</div>
                    </td>
                    <td className="px-5 py-3">
                      <select
                        value={user.role}
                        onChange={(e) => updateUser(user.id, { role: e.target.value })}
                        className="bg-surface-0 border border-edge text-white text-xs rounded px-2 py-1 focus:outline-none focus:border-edge-hover"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-5 py-3">
                      <Badge variant={statusVariants[user.status]}>{user.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-xs text-txt-secondary">
                      {user._count.providers} providers · {user._count.conversations} chats
                    </td>
                    <td className="px-5 py-3 text-xs text-txt-muted">
                      {new Date(user.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1.5 justify-end">
                        {user.status === 'approved' && (
                          <Button onClick={() => updateUser(user.id, { status: 'banned' })} variant="danger" size="xs">Ban</Button>
                        )}
                        {user.status === 'banned' && (
                          <Button onClick={() => updateUser(user.id, { status: 'approved' })} variant="outline" size="xs">Unban</Button>
                        )}
                        <Button onClick={() => deleteUser(user.id)} variant="danger" size="xs">Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
