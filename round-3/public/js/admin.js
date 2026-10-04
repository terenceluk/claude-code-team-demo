// admin.js — renders the "Users" admin table.

const WaypointAdmin = (() => {
  function formatDate(value) {
    if (!value) return '';
    // created_at comes back as a SQLite "YYYY-MM-DD HH:MM:SS" string; swap
    // the space for "T" so Date can parse it reliably across browsers.
    const d = new Date(String(value).replace(' ', 'T'));
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString();
  }

  function cell(text) {
    const td = document.createElement('td');
    td.textContent = text; // textContent — never interpreted as markup
    return td;
  }

  function render(tbodyEl, users) {
    tbodyEl.innerHTML = '';
    if (!users || users.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'pin-list__empty';
      td.textContent = 'No users found.';
      tr.appendChild(td);
      tbodyEl.appendChild(tr);
      return;
    }
    users.forEach((user) => {
      const tr = document.createElement('tr');
      tr.append(
        cell(user.email),
        cell(user.role),
        cell(formatDate(user.created_at)),
        cell(String(user.pin_count))
      );
      tbodyEl.appendChild(tr);
    });
  }

  return { render };
})();
