// auth.js — register/sign-in form handling and current-user state.

const WaypointAuth = (() => {
  const USER_KEY = 'waypoint_user';

  function getCurrentUser() {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function setCurrentUser(user) {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  }

  function isAdmin(user) {
    return !!user && user.role === 'admin';
  }

  function signOut() {
    WaypointAPI.clearToken();
    setCurrentUser(null);
  }

  return {
    getCurrentUser,
    setCurrentUser,
    isAdmin,
    signOut,
  };
})();
