(function () {
  if (API.getToken()) {
    window.location.href = 'index.html';
    return;
  }

  const form = document.getElementById('login-form');
  const errorBox = document.getElementById('login-error');
  const infoBox = document.getElementById('login-info');
  const submitBtn = document.getElementById('login-submit');

  const params = new URLSearchParams(window.location.search);
  if (params.get('registered')) {
    infoBox.textContent = 'Account created. Please sign in.';
    infoBox.classList.add('show');
  }

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

    const email = form.email.value.trim();
    const password = form.password.value;

    if (!email || !password) {
      showError('Please enter your email and password.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';

    try {
      const data = await API.login({ email, password });
      const user = (data && (data.user || data)) || null;
      const token = data && data.token;

      if (!token || !user) {
        throw new Error('Unexpected response from server.');
      }

      API.setSession(token, user);
      window.location.href = 'index.html';
    } catch (err) {
      showError(err.message || 'Sign in failed. Please check your credentials.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
    }
  });
})();
