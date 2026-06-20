'use strict';
// Soft client-side login gate. ONE shared password for everyone.
// The password word is never stored here — only its SHA-256 hash. This keeps the
// plaintext out of page source, but note this is a SOFT gate by design: a technical
// user can set the unlock flag manually, and the data functions stay publicly
// callable. It just keeps casual visitors out.
//
// To change the password: run
//   node -e "console.log(require('crypto').createHash('sha256').update('YOURPW').digest('hex'))"
// and paste the result into HASH below.
(function () {
  var HASH = 'dfdbdf4b8c0405370c4dfa25c34e1e63dbe83b693d0fb04b8bf85f2213605bbc'; // 'camp2026'
  var KEY = 'camp_authed';

  var gate = document.getElementById('gate');
  var form = document.getElementById('gateForm');
  var pw = document.getElementById('gatePw');
  var err = document.getElementById('gateErr');

  function unlock() {
    try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
    if (gate) gate.classList.add('hidden');
    document.dispatchEvent(new Event('camp:unlocked'));
  }

  // sha256 hex of a string via WebCrypto (needs a secure context: https or localhost)
  function sha256Hex(str) {
    var bytes = new TextEncoder().encode(str);
    return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
      var arr = Array.prototype.slice.call(new Uint8Array(buf));
      return arr.map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  // Already unlocked this session → skip the prompt.
  var authed = false;
  try { authed = sessionStorage.getItem(KEY) === '1'; } catch (e) {}
  if (authed) { unlock(); return; }

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (err) err.hidden = true;
      sha256Hex(pw ? pw.value : '').then(function (hex) {
        if (hex === HASH) {
          unlock();
        } else if (err) {
          err.hidden = false;
          if (pw) { pw.value = ''; pw.focus(); }
        }
      });
    });
    if (pw) pw.focus();
  }
})();
