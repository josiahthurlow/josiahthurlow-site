/* ==========================================================================
   LEAD ATTRIBUTION  —  josiahthurlow.com
   --------------------------------------------------------------------------
   Loaded on every page. It does three things:

   1. CAPTURES the origin of the visit (utm_*, gclid, fbclid, referrer,
      landing page) the moment someone arrives, and stores it so it survives
      the walk from a blog post or the bio link over to the form.
   2. EXPOSES that data to the forms — jtAttribution.fields() returns a flat
      object written into hidden inputs right before the POST, and
      jtAttribution.payload() returns the structured version for the webhook.
   3. SENDS the lead to the CRM webhook — jtAttribution.sendWebhook().

   FIRST TOUCH vs LAST TOUCH: the first ad/post that brought someone here is
   kept forever (localStorage); the most recent one is updated on every new
   tagged visit. A lead that saw an Instagram ad in March and came back via
   Google in September carries both.

   ANY NEW FIELD must also be declared in the hidden Netlify form on the page,
   or Netlify will not record it. The webhook gets everything either way.
   ========================================================================== */
(function (w, d) {
  'use strict';

  var STORE_KEY = 'jt_attr_v1';
  var WEBHOOK_URL = 'https://webhook.lardia.space/webhook/josiah';
  var SITE = 'josiahthurlow.com';

  /* Everything an ad platform or a CRM uses to name a source. */
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
                  'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic'];
  /* Click IDs — Google, Meta, Microsoft, TikTok, LinkedIn, X, Pinterest, Snap. */
  var CLICK_KEYS = ['gclid', 'gbraid', 'wbraid', 'dclid', 'fbclid', 'msclkid', 'ttclid',
                    'li_fat_id', 'twclid', 'epik', 'ScCid', 'irclickid'];
  /* Granular ad parameters. Meta offers {{campaign.id}}, {{ad.id}},
     {{placement}}, {{site_source_name}}; Google offers {campaignid},
     {adgroupid}, {creative}, {keyword}, {matchtype}, {network}, {device}.
     Campaign NAMES change; IDs do not, so both are worth carrying. */
  var AD_KEYS = ['campaign_id', 'adset_id', 'adgroup_id', 'ad_id', 'creative_id',
                 'placement', 'site_source', 'matchtype', 'network', 'device',
                 'keyword', 'creative', 'gad_source', 'gad_campaignid'];

  /* The site's own tags: /?call=1&from=blog and the bio link. */
  var OWN_KEYS = ['from', 'ref', 'src'];

  var SEARCH_HOSTS = /(^|\.)(google|bing|yahoo|duckduckgo|ecosia|brave|baidu|yandex|ask)\./i;
  var SOCIAL_HOSTS = /(^|\.)(facebook|instagram|fb|m\.facebook|l\.facebook|lm\.facebook|t|twitter|x|linkedin|lnkd|tiktok|pinterest|reddit|youtube|youtu|snapchat|threads|whatsapp|messenger)\./i;
  var MAIL_HOSTS   = /(^|\.)(mail\.google|outlook|mail\.yahoo|superhuman)\./i;

  /* ── storage that never throws ─────────────────────────────────────────── */
  var memory = null;

  function readStore() {
    try {
      var raw = w.localStorage.getItem(STORE_KEY) || w.sessionStorage.getItem(STORE_KEY);
      if (raw) { return JSON.parse(raw); }
    } catch (e) {}
    return memory;
  }

  function writeStore(obj) {
    memory = obj;
    var raw = JSON.stringify(obj);
    try { w.localStorage.setItem(STORE_KEY, raw); return; } catch (e) {}
    try { w.sessionStorage.setItem(STORE_KEY, raw); } catch (e) {}
  }

  function cookie(name) {
    try {
      var m = d.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
      return m ? decodeURIComponent(m.pop()) : '';
    } catch (e) { return ''; }
  }

  function host(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  function nowISO() { try { return new Date().toISOString(); } catch (e) { return ''; } }

  function isLocal() {
    try {
      var h = w.location.hostname;
      return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' ||
             h === '::1' || /\.local$/.test(h) || w.location.protocol === 'file:';
    } catch (e) { return false; }
  }

  function eventId() {
    try {
      if (w.crypto && w.crypto.randomUUID) { return w.crypto.randomUUID(); }
    } catch (e) {}
    return 'evt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* ── read the current URL ──────────────────────────────────────────────── */
  function readTouch() {
    var q;
    try { q = new URLSearchParams(w.location.search); } catch (e) { q = null; }
    var touch = { seen_at: nowISO(), landing_page: '', referrer: '', referrer_host: '' };
    var tagged = false;
    var i, k, v;

    for (i = 0; i < UTM_KEYS.length; i++) {
      k = UTM_KEYS[i]; v = q ? (q.get(k) || '') : '';
      if (v) { touch[k] = v.slice(0, 200); tagged = true; }
    }
    for (i = 0; i < CLICK_KEYS.length; i++) {
      k = CLICK_KEYS[i]; v = q ? (q.get(k) || '') : '';
      /* Click IDs are case-sensitive and some arrive capitalised (ScCid). */
      if (!v && q) { v = q.get(k.toLowerCase()) || ''; }
      if (v) { touch[k.toLowerCase()] = v.slice(0, 400); tagged = true; }
    }
    for (i = 0; i < AD_KEYS.length; i++) {
      k = AD_KEYS[i]; v = q ? (q.get(k) || '') : '';
      if (v) { touch[k] = v.slice(0, 200); tagged = true; }
    }

    /* The site's own tags (/?call=1&from=blog) mark an internal hop, NOT a new
       source. Counting them as a touch would overwrite the ad that brought
       this person in with the name of the page they happened to click from. */
    var ownTagged = false;
    for (i = 0; i < OWN_KEYS.length; i++) {
      k = OWN_KEYS[i]; v = q ? (q.get(k) || '') : '';
      if (v) { touch['tag_' + k] = v.slice(0, 120); ownTagged = true; }
    }

    try { touch.landing_page = w.location.pathname + w.location.search; } catch (e) {}

    var r = '';
    try { r = d.referrer || ''; } catch (e) {}
    var rHost = host(r);
    var selfHost = host(w.location.href);
    /* An internal referrer says nothing about where the visit came from. */
    if (r && rHost && rHost !== selfHost) {
      touch.referrer = r.slice(0, 500);
      touch.referrer_host = rHost;
      tagged = true;
    }

    touch.channel = deriveChannel(touch);
    touch.tagged = tagged;
    touch.own_tagged = ownTagged;
    return touch;
  }

  /* ── name the channel, so the CRM does not have to parse utm strings ───── */
  /* Meta's {{site_source_name}} resolves to fb / ig / an / msg, not to
     "facebook" — matching only the long names would misfile every Meta lead
     whose fbclid got stripped along the way. */
  var SOCIAL_SOURCE = /^(fb|ig|an|msg|facebook|instagram|meta|messenger|audience_?network|threads|tiktok|linkedin|pinterest|snapchat|snap|twitter|x|reddit)$/;
  var SEARCH_SOURCE = /^(google|bing|microsoft|yahoo|duckduckgo|ecosia)$/;
  /* Meta's {{placement}} lands in utm_medium as Instagram_Reels,
     Facebook_Mobile_Feed, an_classic… — a placement, not a medium. */
  var PLACEMENT_MEDIUM = /feed|stories|reels|explore|marketplace|right_hand|instream|video|search_results|profile|threads|^an_|audience_network|messenger/;

  function deriveChannel(t) {
    var medium = (t.utm_medium || '').toLowerCase();
    var source = (t.utm_source || '').toLowerCase();
    var rHost = (t.referrer_host || '').toLowerCase();
    var paidMedium = /cpc|ppc|paid|ads?$|display|cpm|retarget|social_paid/.test(medium);

    if (t.gclid || t.gbraid || t.wbraid || t.dclid || t.gad_source) { return 'paid_search'; }
    if (t.msclkid) { return 'paid_search'; }
    if (t.fbclid || t.ttclid || t.li_fat_id || t.twclid || t.epik || t.sccid) { return 'paid_social'; }
    if (paidMedium) {
      if (SOCIAL_SOURCE.test(source)) { return 'paid_social'; }
      if (SEARCH_SOURCE.test(source)) { return 'paid_search'; }
      return 'paid_other';
    }
    /* A social source whose medium is a placement only ever comes from an ad. */
    if (SOCIAL_SOURCE.test(source) && PLACEMENT_MEDIUM.test(medium)) { return 'paid_social'; }
    /* Ad-level IDs are only ever present on a paid click. */
    if (t.ad_id || t.adset_id || t.creative_id || t.adgroup_id) {
      return SEARCH_SOURCE.test(source) ? 'paid_search' : 'paid_social';
    }
    if (/email|newsletter|e-mail/.test(medium) || /klaviyo|mailchimp|sendgrid|activecampaign/.test(source)) { return 'email'; }
    if (/sms|text/.test(medium)) { return 'sms'; }
    if (medium === 'organic' || medium === 'social') { return 'organic_social'; }
    if (SOCIAL_SOURCE.test(source)) { return 'organic_social'; }
    if (SEARCH_SOURCE.test(source)) { return 'organic_search'; }
    if (t.tag_from || t.tag_ref || t.tag_src) { return 'internal'; }
    if (rHost) {
      if (MAIL_HOSTS.test(rHost)) { return 'email'; }
      if (SEARCH_HOSTS.test(rHost)) { return 'organic_search'; }
      if (SOCIAL_HOSTS.test(rHost)) { return 'organic_social'; }
      return 'referral';
    }
    return 'direct';
  }

  /* ── merge this visit into what we already knew ────────────────────────── */
  function resolve() {
    var touch = readTouch();
    var store = readStore();

    if (!store || !store.first) {
      store = {
        first: touch,
        last: touch,
        first_seen: touch.seen_at,
        last_seen: touch.seen_at,
        visit_count: 1
      };
      writeStore(store);
      return store;
    }

    /* A visit with no tags at all is the same journey continuing — it must not
       overwrite the ad that actually brought this person here. */
    if (touch.tagged) {
      store.last = touch;
      store.visit_count = (store.visit_count || 1) + 1;
    } else if (touch.own_tagged && store.last) {
      /* Keep the real source, but remember which page sent them to the form. */
      if (touch.tag_from) { store.last.tag_from = touch.tag_from; }
      if (touch.tag_ref) { store.last.tag_ref = touch.tag_ref; }
      if (touch.tag_src) { store.last.tag_src = touch.tag_src; }
    }
    store.last_seen = touch.seen_at;
    if (!store.first.landing_page && touch.landing_page) { store.first.landing_page = touch.landing_page; }
    writeStore(store);
    return store;
  }

  var state = resolve();

  /* ── ad-platform identifiers, for offline conversions / CAPI ───────────── */
  function identifiers() {
    var ga = cookie('_ga');
    var gaClientId = '';
    if (ga) {
      var parts = ga.split('.');
      if (parts.length >= 4) { gaClientId = parts.slice(-2).join('.'); }
    }
    var fbc = cookie('_fbc');
    var last = state.last || {};
    /* If the pixel has not written _fbc yet, Meta's own format is reproducible. */
    if (!fbc && last.fbclid) {
      fbc = 'fb.1.' + Date.now() + '.' + last.fbclid;
    }
    return {
      ga_client_id: gaClientId,
      fbp: cookie('_fbp'),
      fbc: fbc,
      gclid_cookie: cookie('_gcl_aw'),
      clarity_id: cookie('_clck')
    };
  }

  function device() {
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    var ua = '';
    try { ua = navigator.userAgent || ''; } catch (e) {}
    return {
      user_agent: ua,
      language: (navigator.languages && navigator.languages[0]) || navigator.language || '',
      timezone: tz,
      screen: (w.screen ? w.screen.width + 'x' + w.screen.height : ''),
      viewport: w.innerWidth + 'x' + w.innerHeight,
      type: /Mobi|Android|iPhone|iPod/i.test(ua) ? 'mobile'
           : /iPad|Tablet/i.test(ua) ? 'tablet' : 'desktop'
    };
  }

  /* Netlify serves /lp-parents and /lp-parents.html as the same page, and
     /blog/ as /blog/index.html. Without normalising, the same form reports
     two or three different paths depending on how the visitor arrived. */
  function cleanPath(pathname) {
    var out = (pathname || '/').replace(/\/index\.html$/i, '/').replace(/\.html$/i, '');
    if (out.length > 1) { out = out.replace(/\/+$/, ''); }
    return out || '/';
  }

  function page() {
    return {
      url: w.location.href,
      path: cleanPath(w.location.pathname),
      title: d.title || '',
      referrer: (function () { try { return d.referrer || ''; } catch (e) { return ''; } })()
    };
  }

  /* ── flat fields, for the hidden inputs Netlify records ────────────────── */
  function fields() {
    var last = state.last || {};
    var first = state.first || {};
    var ids = identifiers();
    var firstTouch = [first.utm_source || first.referrer_host || (first.channel || 'direct'),
                      first.utm_medium || '',
                      first.utm_campaign || ''].filter(Boolean).join(' / ');
    return {
      utm_source:    last.utm_source || '',
      utm_medium:    last.utm_medium || '',
      utm_campaign:  last.utm_campaign || '',
      utm_content:   last.utm_content || '',
      utm_term:      last.utm_term || '',
      gclid:         last.gclid || last.gbraid || last.wbraid || '',
      fbclid:        last.fbclid || '',
      channel:       last.channel || 'direct',
      referrer:      last.referrer || '',
      landing_page:  first.landing_page || '',
      first_touch:   firstTouch + (state.first_seen ? ' @ ' + state.first_seen.slice(0, 10) : ''),
      visit_count:   String(state.visit_count || 1),
      ga_client_id:  ids.ga_client_id || '',
      /* Full detail in one field, so nothing is lost in the Netlify record. */
      attribution:   JSON.stringify({ first: first, last: last, ids: ids })
    };
  }

  /* ── write those fields into a form just before it is serialised ───────── */
  function applyTo(form) {
    if (!form) { return; }
    var f = fields();
    Object.keys(f).forEach(function (name) {
      var input = form.querySelector('input[name="' + name + '"]');
      if (!input) {
        input = d.createElement('input');
        input.type = 'hidden';
        input.name = name;
        form.appendChild(input);
      }
      input.value = f[name];
    });
    return f;
  }

  /* ── the structured payload the CRM receives ───────────────────────────── */
  function payload(formName, data, extra) {
    var lead = {};
    var meta = {};
    /* Everything the person actually typed, minus the plumbing. */
    var SKIP = { 'form-name': 1, 'bot-field': 1, attribution: 1 };
    var FLAT = fields();
    if (data && typeof data.forEach === 'function') {
      data.forEach(function (value, key) {
        if (SKIP[key]) { return; }
        if (Object.prototype.hasOwnProperty.call(FLAT, key)) { return; }
        if (key === 'source') { meta.placement = value; return; }
        lead[key] = value;
      });
    }
    if (lead.sms_consent) { lead.sms_consent = true; }
    else if (formName === 'lp-parents') { lead.sms_consent = false; }

    return {
      /* Stable per submission: the delivery is retried on failure and the
         unverifiable fallback can double up, so the CRM dedupes on this. */
      event_id: eventId(),
      event: 'lead_submit',
      site: SITE,
      /* 'local' while testing from a dev server — filter on this in n8n so a
         test submission never lands in the CRM as a real lead. */
      env: isLocal() ? 'local' : 'production',
      form: formName || '',
      placement: meta.placement || (extra && extra.source) || '',
      submitted_at: nowISO(),
      lead: lead,
      attribution: {
        channel: (state.last && state.last.channel) || 'direct',
        first_seen: state.first_seen || '',
        last_seen: state.last_seen || '',
        visit_count: state.visit_count || 1,
        first_touch: state.first || {},
        last_touch: state.last || {}
      },
      identifiers: identifiers(),
      page: page(),
      device: device()
    };
  }

  /* ── deliver it ────────────────────────────────────────────────────────── */
  var QUEUE_KEY = 'jt_webhook_q';
  var QUEUE_MAX = 20;
  var QUEUE_TTL = 7 * 24 * 60 * 60 * 1000;

  function readQueue() {
    try { return JSON.parse(w.localStorage.getItem(QUEUE_KEY) || '[]') || []; } catch (e) { return []; }
  }

  function writeQueue(list) {
    try { w.localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-QUEUE_MAX))); } catch (e) {}
  }

  /* A lead that the CRM never received is worth money, so a failed delivery is
       parked and retried on the next page view instead of being dropped.
       Netlify still holds the original either way. */
  function enqueue(raw) {
    var list = readQueue();
    list.push({ at: Date.now(), body: raw });
    writeQueue(list);
  }

  function post(raw) {
    /* Proper JSON first — the only variant whose response status the browser
       lets us read, so it is the only one that can be retried reliably. */
    return fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,
      keepalive: true
    }).then(function (res) {
      if (res && res.ok) { return true; }
      throw new Error('status ' + (res && res.status));
    });
  }

  function sendWebhook(body) {
    var raw = typeof body === 'string' ? body : JSON.stringify(body);

    return post(raw).catch(function () {
      /* The endpoint may simply not allow this origin, which kills the
         preflight before the request is ever sent. A "simple" request carries
         no preflight and still reaches the server — the response is opaque, so
         delivery cannot be confirmed, and the lead is queued as well. */
      return fetch(WEBHOOK_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: raw,
        keepalive: true
      }).then(function () {
        enqueue(raw);
        return 'unconfirmed';
      }).catch(function () {
        try { navigator.sendBeacon(WEBHOOK_URL, new Blob([raw], { type: 'text/plain;charset=UTF-8' })); } catch (e) {}
        enqueue(raw);
        return false;
      });
    });
  }

  /* Retry whatever is parked, one page view later. */
  function flushQueue() {
    var list = readQueue();
    if (!list.length) { return; }
    var fresh = list.filter(function (item) { return (Date.now() - item.at) < QUEUE_TTL; });
    writeQueue(fresh);
    if (!fresh.length) { return; }

    var kept = [];
    var pending = fresh.map(function (item) {
      return post(item.body).catch(function () { kept.push(item); });
    });
    Promise.all(pending).then(function () { writeQueue(kept); });
  }

  try {
    if (d.readyState === 'loading') {
      d.addEventListener('DOMContentLoaded', function () { setTimeout(flushQueue, 2500); });
    } else { setTimeout(flushQueue, 2500); }
  } catch (e) {}

  w.jtAttribution = {
    url: WEBHOOK_URL,
    state: function () { return state; },
    fields: fields,
    applyTo: applyTo,
    payload: payload,
    sendWebhook: sendWebhook,
    flushQueue: flushQueue,
    queued: function () { return readQueue().length; }
  };
})(window, document);
