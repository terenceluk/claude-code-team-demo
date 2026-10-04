/**
 * auth.js
 * Shared helpers used by every page: session guard, header wiring
 * (user name, sign-out, admin link visibility).
 */

const Auth = (function () {
  function unwrapUser(data) {
    if (!data) return null;
    if (data.user) return data.user; // ASSUMPTION-compatible: some APIs wrap as {user: {...}}
    return data;
  }

  function isAdmin(user) {
    // ASSUMPTION: boolean `isAdmin` field on the user object determines
    // admin status. Some backends use a `role: "admin"` string instead;
    // we defensively check for that shape too.
    if (!user) return false;
    if (typeof user.isAdmin === 'boolean') return user.isAdmin;
    if (typeof user.is_admin === 'boolean') return user.is_admin;
    if (typeof user.role === 'string') return user.role.toLowerCase() === 'admin';
    return false;
  }

  /**
   * Ensures the visitor is signed in. Tries to validate/refresh the
   * cached user via GET /api/auth/me; if that fails with an auth error
   * (or there's no token at all) it redirects to the login page.
   * Returns the resolved user object, or null if it redirected away.
   */
  async function requireAuth() {
    const token = API.getToken();
    if (!token) {
      redirectToLogin();
      return null;
    }
    try {
      const data = await API.fetchMe();
      const user = unwrapUser(data);
      if (!user) throw new Error('No user in response');
      API.setSession(token, user);
      return user;
    } catch (err) {
      if (err.isNetworkError) {
        // Backend unreachable: fall back to the cached user so the UI
        // is still usable/inspectable offline instead of bouncing to
        // login. Data-fetching calls on the page will surface their own
        // "server unreachable" errors.
        const cached = API.getCachedUser();
        if (cached) return cached;
      }
      redirectToLogin();
      return null;
    }
  }

  function redirectToLogin() {
    API.clearSession();
    if (!/\/(login\.html)?$/.test(location.pathname)) {
      window.location.href = 'login.html';
    }
  }

  async function signOut() {
    await API.logout();
    API.clearSession();
    window.location.href = 'login.html';
  }

  /** Wires up the common header: welcome text, admin link, sign-out button. */
  function initHeader(user) {
    const welcome = document.querySelector('[data-user-email]');
    if (welcome) welcome.textContent = user.name || user.email || '';

    const adminLink = document.querySelector('[data-admin-link]');
    if (adminLink) {
      adminLink.style.display = isAdmin(user) ? '' : 'none';
    }

    const signOutBtn = document.querySelector('[data-sign-out]');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        signOut();
      });
    }
  }

  return { isAdmin, requireAuth, redirectToLogin, signOut, initHeader, unwrapUser };
})();
