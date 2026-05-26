'use client';

/**
 * Admin panel — list users, approve/ban/role-change, delete.
 *
 * Showcases combined query + mutation pattern with auto-refetch on
 * tag invalidation:
 *   - useListAdminUsersQuery -> table data
 *   - useUpdateAdminUserMutation -> approve/ban/role change
 *   - useDeleteAdminUserMutation -> hard delete
 *   - Both mutations invalidate 'AdminUser' tag so the list refetches
 *     itself after every action. No manual fetchUsers() call needed.
 */

import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { LoadingState } from '@/components/LoadingState';
import { useAppDispatch } from '@/lib/store/hooks';
import { showToast } from '@/lib/store/slices/uiSlice';
import {
  useListAdminUsersQuery,
  useUpdateAdminUserMutation,
  useDeleteAdminUserMutation,
} from '@/lib/store/api/adminUsersApi';

export default function AdminPage() {
  const dispatch = useAppDispatch();
  const { data, isLoading } = useListAdminUsersQuery();
  const [updateUser] = useUpdateAdminUserMutation();
  const [deleteUser] = useDeleteAdminUserMutation();

  if (isLoading || !data) return <LoadingState fullScreen />;

  const users = data.users;
  const pendingUsers = users.filter((u) => u.status === 'pending');
  const statusVariants: Record<string, 'success' | 'warning' | 'danger'> = {
    approved: 'success',
    pending: 'warning',
    banned: 'danger',
  };

  const handleUpdate = async (id: string, payload: { status?: string; role?: string }) => {
    try {
      await updateUser({ id, ...payload }).unwrap();
      dispatch(showToast({ type: 'success', message: 'User updated' }));
    } catch {
      dispatch(showToast({ type: 'error', message: 'Update failed' }));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this user permanently? All their data will be lost.')) return;
    try {
      await deleteUser(id).unwrap();
      dispatch(showToast({ type: 'success', message: 'User deleted' }));
    } catch {
      dispatch(showToast({ type: 'error', message: 'Delete failed' }));
    }
  };

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="page-header animate-fade-in">
          <div>
            <p className="typo-eyebrow mb-2">Administration</p>
            <h1 className="typo-headline">Admin Panel</h1>
            <p className="typo-body-sm mt-2">Manage users and approvals</p>
          </div>
          <a href="/chat">
            <Button variant="secondary" size="sm">← Back to Chat</Button>
          </a>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6 animate-slide-up">
          <div className="bg-surface-1 border border-hairline rounded-xl p-5">
            <p className="typo-eyebrow mb-2">Total Users</p>
            <p className="text-2xl font-semibold text-ink mt-1 tabular-nums">{users.length}</p>
          </div>
          <div className="bg-surface-1 border border-hairline rounded-xl p-5">
            <p className="typo-eyebrow mb-2">Pending</p>
            <p className="text-2xl font-semibold text-yellow-400 mt-1 tabular-nums">{pendingUsers.length}</p>
          </div>
          <div className="bg-surface-1 border border-hairline rounded-xl p-5">
            <p className="typo-eyebrow mb-2">Approved</p>
            <p className="text-2xl font-semibold text-success mt-1 tabular-nums">
              {users.filter((u) => u.status === 'approved').length}
            </p>
          </div>
        </div>

        {/* Pending */}
        {pendingUsers.length > 0 && (
          <div className="bg-yellow-500/5 border border-yellow-500/30 rounded-xl overflow-hidden mb-6 animate-slide-up">
            <div className="px-6 py-4 border-b border-yellow-500/20">
              <h2 className="text-base font-semibold text-yellow-400">Pending Approval ({pendingUsers.length})</h2>
              <p className="text-xs text-ink-subtle mt-0.5">Review and approve new user registrations</p>
            </div>
            <div className="divide-y divide-yellow-500/10">
              {pendingUsers.map((user) => (
                <div key={user.id} className="px-6 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-ink">{user.username}</p>
                    <p className="text-xs text-ink-subtle">{user.email}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => handleUpdate(user.id, { status: 'approved' })} variant="primary" size="xs">
                      Approve
                    </Button>
                    <Button onClick={() => handleUpdate(user.id, { status: 'banned' })} variant="danger" size="xs">
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All Users */}
        <div className="bg-surface-1 border border-hairline rounded-xl overflow-hidden animate-slide-up">
          <div className="px-6 py-5 border-b border-hairline">
            <h2 className="text-base font-semibold text-ink">All Users</h2>
            <p className="text-xs text-ink-subtle mt-0.5">{users.length} registered accounts</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-surface-2">
                <tr>
                  <th className="px-5 py-3 text-left typo-eyebrow">User</th>
                  <th className="px-5 py-3 text-left typo-eyebrow">Role</th>
                  <th className="px-5 py-3 text-left typo-eyebrow">Status</th>
                  <th className="px-5 py-3 text-left typo-eyebrow">Usage</th>
                  <th className="px-5 py-3 text-left typo-eyebrow">Joined</th>
                  <th className="px-5 py-3 text-right typo-eyebrow">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-surface-2 transition-colors">
                    <td className="px-5 py-3">
                      <div className="text-sm font-medium text-ink">{user.username}</div>
                      <div className="text-xs text-ink-subtle">{user.email}</div>
                    </td>
                    <td className="px-5 py-3">
                      <select
                        value={user.role}
                        onChange={(e) => handleUpdate(user.id, { role: e.target.value })}
                        className="bg-canvas border border-hairline text-ink text-xs rounded-md px-2 py-1 focus:outline-none focus:border-hairline-strong focus:ring-2 focus:ring-accent/40"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-5 py-3">
                      <Badge variant={statusVariants[user.status]}>{user.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-muted">
                      {user._count.providers} providers · {user._count.conversations} chats
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-subtle">
                      {new Date(user.createdAt).toLocaleDateString('id-ID', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1.5 justify-end">
                        {user.status === 'approved' && (
                          <Button onClick={() => handleUpdate(user.id, { status: 'banned' })} variant="danger" size="xs">
                            Ban
                          </Button>
                        )}
                        {user.status === 'banned' && (
                          <Button onClick={() => handleUpdate(user.id, { status: 'approved' })} variant="outline" size="xs">
                            Unban
                          </Button>
                        )}
                        <Button onClick={() => handleDelete(user.id)} variant="danger" size="xs">
                          Delete
                        </Button>
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
