(function () {
  // If already signed in, skip straight to the map.
  if (API.getToken()) {
    window.location.href = 'index.html';
    return;
  }

  const form = document.getElementById('register-form');
  const errorBox = document.getElementById('register-error');
  const submitBtn = document.getElementById('register-submit');

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add('show');
  }

  function hideError() {
    errorBox.classList.remove('show');
    errorBox.textContent = '';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;
    const confirmPassword = form.confirmPassword.value;

    if (!name || !email || !password) {
      showError('Please fill in all fields.');
      return;
    }
    if (password.length < 6) {
      showError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      showError('Passwords do not match.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account…';

    try {
      const data = await API.register({ name, email, password });
      const user = Auth_unwrapUser(data);
      const token = data && data.token;

      if (token && user) {
        API.setSession(token, user);
        window.location.href = 'index.html';
      } else {
        // Registration succeeded but did not return a session (ASSUMPTION
        // fallback): send the user to sign in manually instead.
        window.location.href = 'login.html?registered=1';
      }
    } catch (err) {
      showError(err.message || 'Could not create your account. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create account';
    }
  });

  function Auth_unwrapUser(data) {
    if (!data) return null;
    return data.user || data;
  }
})();
