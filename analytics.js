/* YAPPI Analytics — client tracker */
(function () {
  var API = 'http://' + location.hostname + ':3001/an';
  var start = Date.now();
  var queue = [];
  var flushed = false;

  function device() { return window.innerWidth < 768 ? 'mobile' : 'desktop'; }

  function push(type, extra) {
    var ev = { type: type };
    if (extra) Object.assign(ev, extra);
    queue.push(ev);
  }

  function flush() {
    if (flushed || !queue.length) return;
    flushed = true;
    var payload = JSON.stringify(queue);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(API, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(API, { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json' }, keepalive: true })
        .catch(function () {});
    }
  }

  /* ── Pageview ── */
  push('pageview', {
    page: location.pathname,
    ref: document.referrer.slice(0, 100),
    device: device()
  });

  /* ── Click tracking ── */
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    var href = a.href || '';
    var text = (a.textContent || '').trim().slice(0, 60);

    if (/t\.me|telegram\.me/i.test(href)) {
      push('click_tg', { href: href.slice(0, 100), text: text });
      flush(); flushed = false; /* allow re-flush for next event */
    } else if (a.closest('#partners') || a.classList.contains('pc-btn')) {
      var name = (a.closest('.partner-card') || {}).querySelector
        ? ((a.closest('.partner-card').querySelector('.pc-name') || {}).textContent || href).trim().slice(0, 40)
        : href.slice(0, 40);
      push('click_partner', { name: name, href: href.slice(0, 100) });
      flush(); flushed = false;
    } else if (/\/(web-dev|bots-rental|creatives|tables|automation|ai-production|cases)\.html/.test(href)) {
      var svc = href.split('/').pop().replace('.html', '');
      push('click_service', { service: svc });
      flush(); flushed = false;
    }
  }, true);

  /* ── Section visibility (IntersectionObserver) ── */
  if (typeof IntersectionObserver !== 'undefined') {
    var sections = document.querySelectorAll('section[id], #hero');
    var seen = {};
    var sectionObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !seen[entry.target.id]) {
          seen[entry.target.id] = true;
          push('section_view', { section: entry.target.id });
        }
      });
    }, { threshold: 0.3 });
    sections.forEach(function (s) { sectionObs.observe(s); });
  }

  /* ── Session end ── */
  function onEnd() {
    push('session_end', {
      duration: Date.now() - start,
      device: device(),
      ref: document.referrer.slice(0, 100),
      pages: queue.filter(function (e) { return e.type === 'pageview'; }).length
    });
    flush();
  }
  window.addEventListener('beforeunload', onEnd);
  window.addEventListener('pagehide', onEnd);

  /* ── Public API ── */
  window.yappiTrack = function (type, extra) {
    push(type, extra);
    /* flush on explicit form/feedback events */
    if (type === 'form_submit' || type === 'feedback_sent') {
      flushed = false;
      flush();
    }
  };
})();
