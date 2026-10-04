(async function () {
  const user = await Auth.requireAuth();
  if (!user) return;
  Auth.initHeader(user);

  const forbiddenBox = document.getElementById('forbidden');
  const adminPanel = document.getElementById('admin-panel');
  const pageError = document.getElementById('page-error');
  const usersStatus = document.getElementById('users-status');
  const usersTable = document.getElementById('users-table');
  const usersTbody = document.getElementById('users-tbody');
  const usersEmpty = document.getElementById('users-empty');

  // UI-level gating only: a non-admin never even sees the table markup.
  // Real enforcement must happen server-side on GET /api/admin/users.
  if (!Auth.isAdmin(user)) {
    forbiddenBox.classList.add('show');
    return;
  }

  forbiddenBox.classList.remove('show');
  adminPanel.style.display = '';

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function formatDate(d) {
    if (!d) return '—';
    const date = new Date(d);
    return Number.isNaN(date.getTime()) ? String(d) : date.toLocaleDateString();
  }

  usersStatus.style.display = '';
  try {
    const users = await API.listUsers();
    usersStatus.style.display = 'none';

    if (!users.length) {
      usersEmpty.style.display = '';
      return;
    }

    usersTable.style.display = '';
    usersTbody.innerHTML = users
      .map((u) => {
        const admin = Auth.isAdmin(u);
        return `
          <tr>
            <td>${escapeHtml(u.name || '—')}</td>
            <td>${escapeHtml(u.email || '—')}</td>
            <td><span class="badge ${admin ? 'badge-admin' : 'badge-user'}">${admin ? 'Admin' : 'User'}</span></td>
            <td>${escapeHtml(formatDate(u.createdAt || u.created_at))}</td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    usersStatus.style.display = 'none';
    pageError.textContent = err.message || 'Could not load the user list.';
    pageError.classList.add('show');
  }
})();
