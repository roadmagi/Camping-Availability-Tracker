'use strict';
(function () {
  var parkSel = document.getElementById('parkSel');
  var monthsSel = document.getElementById('monthsSel');
  var startSel = document.getElementById('startSel');
  var statusEl = document.getElementById('status');
  var mainEl = document.getElementById('main');
  var slider = document.getElementById('monthSlider');
  var slLabel = document.getElementById('slLabel');

  // Track current MONTHS array for slider after each render
  var MONTHS = [];

  function setStatus(msg, isErr) {
    statusEl.textContent = msg;
    statusEl.className = isErr ? 'err' : '';
  }

  // Load parks on startup
  fetch('/.netlify/functions/parks')
    .then(function (r) { return r.json().then(function (d) {
      if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status));
      return d;
    }); })
    .then(function (d) {
      if (!d.parks || !d.parks.length) { setStatus('No parks found.', true); return; }
      var sorted = d.parks.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
      sorted.forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        parkSel.appendChild(opt);
      });
    })
    .catch(function (err) { setStatus('⚠ Failed to load parks: ' + err.message, true); });

  function load() {
    var park = parkSel.value;
    if (!park) return;
    var months = monthsSel.value || '3';
    var start = startSel.value; // YYYY-MM or ''

    setStatus('Loading…', false);
    mainEl.innerHTML = '';
    slider.value = 0;
    MONTHS = [];

    var url = '/.netlify/functions/availability?park=' + encodeURIComponent(park) + '&months=' + months;
    if (start) url += '&start=' + start;

    fetch(url)
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok || d.error) throw new Error(d.error || 'Request failed');
          return d;
        });
      })
      .then(function (d) {
        setStatus('', false);

        MONTHS = Calendar.monthsBetween(d.start, d.end);
        var _now = new Date();
        var todayIso = Calendar.iso(_now.getFullYear(), _now.getMonth(), _now.getDate());

        var html = '<div class="park">';
        html += '<h2>' + Calendar.escapeHtml(d.parkName) + '</h2>';

        if (d.alert) {
          html += '<div class="alert-banner">⚠ <b>' + Calendar.escapeHtml(d.alert.title) + '</b>';
          if (d.alert.body) html += '<div class="ab">' + Calendar.escapeHtml(d.alert.body) + '</div>';
          html += '</div>';
        }

        if (!d.sites || !d.sites.length) {
          html += '<div class="none">No sites found for this park in the selected range.</div>';
        } else {
          d.sites.forEach(function (site) {
            html += Calendar.siteRowHtml(site, MONTHS, todayIso);
          });
        }
        html += '</div>';

        mainEl.innerHTML = html;

        // Bound startSel to the returned availability window (month input uses YYYY-MM)
        startSel.min = d.start.slice(0, 7);
        startSel.max = d.end.slice(0, 7);

        // Wire slider
        wireSlider();
        applySlider();
      })
      .catch(function (err) { setStatus('⚠ ' + err.message, true); });
  }

  // Slider logic — recomputes rows each time (safe after re-render)
  function firstVisible(sel) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) { if (els[i].getClientRects().length) return els[i]; }
    return null;
  }
  function maxScroll() {
    var rows = document.querySelectorAll('.months');
    if (!rows.length) return 0;
    var max = 0;
    for (var i = 0; i < rows.length; i++) { var v = rows[i].scrollWidth - rows[i].clientWidth; if (v > max) max = v; }
    return max;
  }
  function calStep() { var c = firstVisible('.cal'); return c ? c.getBoundingClientRect().width + 12 : 200; }
  function applySlider() {
    var rows = document.querySelectorAll('.months');
    var ms = maxScroll();
    var x = ms * (slider.value / 1000);
    for (var i = 0; i < rows.length; i++) rows[i].scrollLeft = x;
    var cw = calStep();
    var firstIdx = Math.max(0, Math.min(MONTHS.length - 1, Math.round(x / cw)));
    var row = firstVisible('.months');
    var visW = row ? Math.max(0, row.clientWidth - 177) : cw;
    var vis = Math.max(1, Math.floor(visW / cw));
    var lastIdx = Math.min(MONTHS.length - 1, firstIdx + vis - 1);
    var f = MONTHS[firstIdx], l = MONTHS[lastIdx];
    if (f) slLabel.textContent = Calendar.MON[f[1]].slice(0, 3) + ' ' + f[0] + (lastIdx > firstIdx ? ' – ' + Calendar.MON[l[1]].slice(0, 3) + ' ' + l[0] : '');
  }
  function step(dir) {
    var ms = maxScroll();
    if (ms <= 0) return;
    var dv = (calStep() / ms) * 1000;
    slider.value = Math.max(0, Math.min(1000, (+slider.value) + dir * dv));
    applySlider();
  }

  // Wire slider events (idempotent — called after each render)
  var sliderWired = false;
  function wireSlider() {
    if (sliderWired) return;
    sliderWired = true;
    slider.addEventListener('input', applySlider);
    document.getElementById('slPrev').addEventListener('click', function () { step(-1); });
    document.getElementById('slNext').addEventListener('click', function () { step(1); });
    window.addEventListener('resize', applySlider);
  }

  // Cell click — highlight same date across all calendars
  function showDate(k) {
    document.querySelectorAll('.cell.sel').forEach(function (e) { e.classList.remove('sel'); });
    document.querySelectorAll('.cell[data-date="' + k + '"]').forEach(function (e) { e.classList.add('sel'); });
  }
  mainEl.addEventListener('click', function (e) {
    var c = e.target.closest('.cell[data-date]');
    if (c) showDate(c.dataset.date);
  });

  // Control change handlers
  parkSel.addEventListener('change', load);
  monthsSel.addEventListener('change', load);
  startSel.addEventListener('change', load);
})();
