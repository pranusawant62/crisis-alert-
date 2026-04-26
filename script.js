// ═══════════════════════════════════════════════════
//  CrisisAlert — script.js
// ═══════════════════════════════════════════════════

// ── SECURITY CONFIG ─────────────────────────────────
const INVITE = {
  'Police':       'POLICE-2024',
  'Fire Brigade': 'FIRE-2024',
  'Ambulance':    'AMBU-2024',
  'Disaster Mgmt':'DISAS-2024'
};
const MAX_ATT = 3;
const LOCK_MS = 2 * 60 * 1000;   // 2 min lockout
const SESS_MS = 30 * 60 * 1000;  // 30 min session

// ── STATE ───────────────────────────────────────────
let selDeptVal = 'Police';
let curFilter  = 'all';
let sessTimer  = null;
let cachedLoc  = null;     // { lat, lon, address } — cached GPS
let currentUser = null;    // logged in user object

// ── DATA HELPERS ────────────────────────────────────
const getAlerts    = () => JSON.parse(localStorage.getItem('ca_alerts')   || '[]');
const getResolved  = () => JSON.parse(localStorage.getItem('ca_resolved') || '[]');
const saveAlerts   = a  => localStorage.setItem('ca_alerts',   JSON.stringify(a));
const saveResolved = r  => localStorage.setItem('ca_resolved', JSON.stringify(r));
const getUser      = () => JSON.parse(localStorage.getItem('ca_user')  || 'null');
const getAdmin     = () => JSON.parse(localStorage.getItem('ca_admin') || 'null');

// ── NAVIGATION ──────────────────────────────────────
function nav(id) {
  document.querySelectorAll('.pg').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

// ── DEPT SELECT ─────────────────────────────────────
function selDept(el, val) {
  document.querySelectorAll('.dept-opt').forEach(o => o.classList.remove('sel'));
  el.classList.add('sel');
  selDeptVal = val;
}

// ── WA NUMBER FORMAT ────────────────────────────────
function fmtWA(input) {
  // strip everything except digits
  input.value = input.value.replace(/\D/g, '');
}

// ── VALIDATION ──────────────────────────────────────
function chkBadge(input) {
  const ok = /^[A-Z]{2,4}-\d{4}-\d{4}$/.test(input.value);
  input.style.borderColor = input.value.length > 5
    ? (ok ? '#059669' : '#D97706')
    : '';
}

function chkAdminEmail(input) {
  const isGov = /\.(gov|police|fire|mil)/.test(input.value);
  const warn = document.getElementById('emailWarn');
  if (warn) warn.style.display = (input.value.length > 6 && !isGov) ? 'block' : 'none';
}

function chkPass(pass) {
  const wrap = document.getElementById('psWrap');
  if (!wrap) return;
  wrap.style.display = 'block';
  const bars = ['ps1','ps2','ps3','ps4'].map(id => document.getElementById(id));
  let s = 0;
  if (pass.length >= 8)           s++;
  if (/[A-Z]/.test(pass))         s++;
  if (/[0-9]/.test(pass))         s++;
  if (/[^A-Za-z0-9]/.test(pass))  s++;
  const cols  = ['#D92B2B','#D97706','#2563EB','#059669'];
  const labels = ['Weak','Fair','Good','Strong'];
  bars.forEach((b,i) => b.style.background = i < s ? cols[s-1] : 'rgba(255,255,255,.07)');
  const lbl = document.getElementById('psLbl');
  if (lbl) { lbl.textContent = pass.length ? labels[s-1] || '' : ''; lbl.style.color = cols[s-1] || ''; }
}

// ── LOCKOUT ─────────────────────────────────────────
const getLock  = ()  => JSON.parse(localStorage.getItem('ca_lock') || '{"att":0,"until":0}');
const saveLock = o   => localStorage.setItem('ca_lock', JSON.stringify(o));
const isLocked = ()  => Date.now() < getLock().until;

function updateLockUI() {
  const l    = getLock();
  const msg  = document.getElementById('alLock');
  const wrap = document.getElementById('alAttWrap');
  const btn  = document.getElementById('alBtn');
  if (!msg) return;

  if (Date.now() < l.until) {
    const secs = Math.ceil((l.until - Date.now()) / 1000);
    msg.style.display = 'block';
    msg.textContent   = `🔒 Account locked. Try again in ${secs}s.`;
    if (btn)  { btn.disabled = true; btn.style.opacity = '0.4'; }
    if (wrap)   wrap.style.display = 'none';
    setTimeout(updateLockUI, 1000);
  } else {
    msg.style.display = 'none';
    if (btn)  { btn.disabled = false; btn.style.opacity = '1'; }
    if (l.att > 0 && wrap) {
      wrap.style.display = 'block';
      const lbl  = document.getElementById('alAttLbl');
      const fill = document.getElementById('alAttFill');
      if (lbl)  lbl.textContent   = `${l.att}/${MAX_ATT} failed attempts`;
      if (fill) fill.style.width  = `${(l.att / MAX_ATT) * 100}%`;
    } else if (wrap) {
      wrap.style.display = 'none';
    }
  }
}

// ── USER AUTH ────────────────────────────────────────
function userSignup() {
  const name   = v('usName');
  const mob    = v('usMobile');
  const email  = v('usEmail');
  const pass   = v('usPass');
  const ecName = v('usECName');
  const ecNum  = v('usECNum');

  if (!name || !mob || !email || !pass) {
    toast('⚠️','Missing Fields','Please fill in all required fields.'); return;
  }
  if (pass.length < 8) {
    toast('❌','Weak Password','Password must be at least 8 characters.'); return;
  }
  if (!ecNum || ecNum.length < 10) {
    toast('⚠️','Emergency Contact','Enter a valid WhatsApp number with country code (e.g. 919876543210)'); return;
  }

  const userData = {
    name, mob, email,
    pass: btoa(pass + '_ca_2024'),
    ecName, ecNum,   // emergency contact WhatsApp number — no + no spaces
  };
  localStorage.setItem('ca_user', JSON.stringify(userData));
  toast('✅','Account Created',`Emergency contact set to ${ecName}. Please sign in.`);
  nav('pg-userLogin');
}

function userLogin() {
  const email = v('ulEmail');
  const pass  = v('ulPass');

  if (!email || !pass) { toast('⚠️','Empty Fields','Enter your email and password.'); return; }

  const u = getUser();
  if (u && u.email === email && u.pass === btoa(pass + '_ca_2024')) {
    currentUser = u;
    loadUserDash(u);
  } else if (!u) {
    // Demo mode — no user registered yet
    currentUser = { name: email.split('@')[0] || 'User', email, ecNum: null, ecName: null };
    loadUserDash(currentUser);
  } else {
    toast('❌','Invalid Credentials','Email or password is incorrect.');
  }
}

function loadUserDash(user) {
  set('uName', user.name);
  set('uAvatar', user.name[0].toUpperCase());

  // Show EC info card
  const ecCard = document.getElementById('ecInfoCard');
  const ecDisp = document.getElementById('ecContactDisplay');
  if (user.ecName && user.ecNum) {
    if (ecCard) ecCard.style.display = 'block';
    if (ecDisp) ecDisp.textContent = `${user.ecName} (+${user.ecNum})`;
  }

  nav('pg-userDash');
  renderUserFeed();
  renderUserStats();
  startUserPoll();
  prefetchLocation();
}

// ── ADMIN AUTH ───────────────────────────────────────
function adminSignup() {
  const name  = v('asName');
  const email = v('asEmail');
  const badge = v('asBadge');
  const code  = v('asCode');
  const pass  = v('asPass');
  const passC = v('asPassC');

  if (!name || !email || !badge || !code || !pass) {
    toast('⚠️','Missing Fields','Fill in all required fields.'); return;
  }
  if (!/^[A-Z]{2,4}-\d{4}-\d{4}$/.test(badge)) {
    toast('❌','Invalid Badge ID','Format must be: ABC-YYYY-NNNN (e.g. MPD-2024-0192)'); return;
  }
  if (pass !== passC) {
    toast('❌','Password Mismatch','Passwords do not match.'); return;
  }
  if (pass.length < 8 || !/[0-9]/.test(pass) || !/[^A-Za-z0-9]/.test(pass)) {
    toast('❌','Weak Password','Min 8 chars, at least 1 number and 1 special character.'); return;
  }
  if (code !== INVITE[selDeptVal]) {
    toast('🚫','Invalid Invite Code',`Code does not match "${selDeptVal}" department.`); return;
  }

  localStorage.setItem('ca_admin', JSON.stringify({
    name, email, badge,
    pass: btoa(pass + '_ca_adm_2024'),
    dept: selDeptVal
  }));
  toast('✅','Account Registered','You can now sign in with your credentials.');
  nav('pg-adminLogin');
}

function adminLogin() {
  if (isLocked()) { updateLockUI(); return; }
  const emailV = v('alEmail');
  const passV  = v('alPass');

  if (!emailV || !passV) { toast('⚠️','Empty Fields','Enter your credentials.'); return; }

  const a = getAdmin();
  const ok = a && (a.email === emailV || a.badge === emailV)
             && a.pass === btoa(passV + '_ca_adm_2024');

  if (ok) {
    saveLock({ att: 0, until: 0 });
    loadAdminDash(a);
  } else {
    const l = getLock();
    l.att++;
    if (l.att >= MAX_ATT) {
      l.until = Date.now() + LOCK_MS;
      toast('🔒','Account Locked','Too many failed attempts. Locked for 2 minutes.');
      addActivityLog('⚠️ Login lockout triggered', '#F87171');
    } else {
      toast('❌','Invalid Credentials', `${MAX_ATT - l.att} attempt(s) remaining before lockout.`);
    }
    saveLock(l);
    updateLockUI();
  }
}

function loadAdminDash(admin) {
  set('aUName', admin.name);
  set('aUDept', admin.dept || 'Responder');
  set('aAv',    admin.name[0].toUpperCase());
  resetSession();
  nav('pg-adminDash');
  renderAdminAlerts();
  renderAdminStats();
  startAdminClock();
  startAdminPoll();
  addActivityLog(`✅ ${admin.name} (${admin.dept}) signed in`, '#6EE7B7');
}

// ── SESSION ──────────────────────────────────────────
function resetSession() {
  clearTimeout(sessTimer);
  sessTimer = setTimeout(() => {
    toast('⏱️','Session Expired','Logged out due to inactivity.');
    setTimeout(() => logout('admin'), 2500);
  }, SESS_MS);
}
['click','keydown','mousemove','touchstart'].forEach(e =>
  document.addEventListener(e, () => {
    if (document.getElementById('pg-adminDash')?.classList.contains('active')) resetSession();
  }, { passive: true })
);

// ── LOGOUT ───────────────────────────────────────────
function logout(role) {
  currentUser = null;
  if (role === 'user') nav('pg-userLogin');
  else nav('pg-adminLogin');
}

// ── GEOLOCATION ──────────────────────────────────────
function prefetchLocation() {
  if (!navigator.geolocation || cachedLoc) return;
  navigator.geolocation.getCurrentPosition(async pos => {
    const addr = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
    cachedLoc = { lat: pos.coords.latitude, lon: pos.coords.longitude, address: addr };
  }, () => {}, { enableHighAccuracy: true });
}

async function reverseGeocode(lat, lon) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const d = await r.json();
    const parts = d.display_name.split(',');
    return parts.slice(0, 4).join(',').trim();
  } catch {
    return `${lat.toFixed(5)}°N, ${lon.toFixed(5)}°E`;
  }
}

function getLocation(highAccuracy = true) {
  return new Promise(resolve => {
    if (cachedLoc) { resolve(cachedLoc); return; }
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const addr = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        cachedLoc = { lat: pos.coords.latitude, lon: pos.coords.longitude, address: addr };
        resolve(cachedLoc);
      },
      () => resolve(null),
      { timeout: 9000, enableHighAccuracy: highAccuracy }
    );
  });
}

// Build Google Maps link for a location
function mapsLink(lat, lon) {
  return `https://www.google.com/maps?q=${lat},${lon}&z=17`;
}

// ── SOS ──────────────────────────────────────────────
async function sendSOS() {
  toast('📡','Locating...','Getting your GPS position.');
  const loc = await getLocation();

  const id  = 'ALT' + Date.now();
  const now = new Date();
  const payload = {
    id, type: 'SOS Emergency', icon: '🆘',
    location: loc ? loc.address : 'Location unavailable',
    lat: loc?.lat, lon: loc?.lon,
    mapLink: loc ? mapsLink(loc.lat, loc.lon) : null,
    status: 'Active',
    time: now.toLocaleTimeString(),
    date: now.toLocaleDateString(),
    updates: []
  };

  const alerts = getAlerts();
  alerts.push(payload);
  saveAlerts(alerts);
  renderUserFeed();
  renderUserStats();

  toast('🆘','SOS Broadcast Sent','Emergency services notified. Sending WhatsApp alert to your contact.');

  // Auto-send WhatsApp to emergency contact after short delay
  if (loc) {
    setTimeout(() => {
      sendWhatsAppAlert(loc, 'SOS Emergency', id);
    }, 1500);
  } else {
    setTimeout(() => {
      sendWhatsAppAlert(null, 'SOS Emergency', id);
    }, 1500);
  }
}

// ── SEND TYPE ────────────────────────────────────────
async function sendType(type, icon) {
  toast('📡','Getting Location...','Acquiring GPS coordinates.');
  const loc = await getLocation();

  const id  = 'ALT' + Date.now();
  const now = new Date();
  const alerts = getAlerts();
  alerts.push({
    id, type, icon,
    location: loc ? loc.address : 'Location unavailable',
    lat: loc?.lat, lon: loc?.lon,
    mapLink: loc ? mapsLink(loc.lat, loc.lon) : null,
    status: 'Pending',
    time: now.toLocaleTimeString(),
    date: now.toLocaleDateString(),
    updates: []
  });
  saveAlerts(alerts);
  renderUserFeed();
  renderUserStats();
  toast('✅','Alert Dispatched',`${type} alert sent to emergency services.`);
}

// ── WHATSAPP TO EMERGENCY CONTACT ────────────────────
// This sends to the user's REGISTERED emergency contact number
function sendWhatsAppAlert(loc, reason, alertId) {
  const user = currentUser || getUser();

  // Get the emergency contact number
  const ecNum  = user?.ecNum  || null;
  const ecName = user?.ecName || 'Emergency Contact';

  // Build the message
  let msg = '';
  if (loc) {
    const mapUrl = mapsLink(loc.lat, loc.lon);
    msg =
      `🚨 *EMERGENCY ALERT — ${reason.toUpperCase()}*\n\n` +
      `*${user?.name || 'Someone'}* needs immediate help!\n\n` +
      `📍 *Location:*\n${loc.address}\n\n` +
      `🗺️ *LIVE MAP — Tap to open:*\n${mapUrl}\n\n` +
      `📌 *GPS Coordinates:*\n${loc.lat.toFixed(6)}, ${loc.lon.toFixed(6)}\n\n` +
      `🕐 *Time:* ${new Date().toLocaleString()}\n` +
      `🆔 *Alert ID:* ${alertId?.slice(-8) || 'N/A'}\n\n` +
      `Please contact emergency services:\n` +
      `🚔 Police: 100  🚒 Fire: 101  🚑 Ambulance: 108  📞 Universal: 112`;
  } else {
    msg =
      `🚨 *EMERGENCY ALERT — ${reason.toUpperCase()}*\n\n` +
      `*${user?.name || 'Someone'}* needs immediate help!\n` +
      `⚠️ Location could not be determined automatically.\n\n` +
      `🕐 *Time:* ${new Date().toLocaleString()}\n\n` +
      `Please contact emergency services immediately:\n` +
      `🚔 Police: 100  🚒 Fire: 101  🚑 Ambulance: 108  📞 Universal: 112`;
  }

  const encoded = encodeURIComponent(msg);

  if (ecNum) {
    // Send to the registered emergency contact
    window.open(`https://wa.me/${ecNum}?text=${encoded}`, '_blank');
    toast('💬','WhatsApp Sent',`Alert + map sent to ${ecName} on WhatsApp.`);
  } else {
    // No EC registered — open WhatsApp with message, user picks contact
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
    toast('💬','WhatsApp Opened','No contact saved — choose your emergency contact in WhatsApp.');
  }
}

// Manual WhatsApp button
function sendWhatsApp() {
  toast('📡','Getting Location...','Fetching GPS for WhatsApp.');
  getLocation().then(loc => {
    sendWhatsAppAlert(loc, 'Emergency Alert', 'MANUAL-' + Date.now());
  });
}

// ── SMS ──────────────────────────────────────────────
function sendSMS() {
  getLocation().then(loc => {
    let body = `EMERGENCY ALERT — I need immediate help! `;
    if (loc) {
      body += `My location: ${loc.address}. Maps: ${mapsLink(loc.lat, loc.lon)}. `;
    }
    body += `Time: ${new Date().toLocaleString()}`;
    window.location.href = `sms:100?body=${encodeURIComponent(body)}`;
    toast('✉️','SMS Ready','Pre-filled emergency message opened — tap Send.');
  });
}

// ── CALL LOGGING ─────────────────────────────────────
function logCall(num, service) {
  addActivityLog(`📞 Call to ${service} (${num}) initiated`, '#4ADE80');
  toast('📞',`Calling ${service}`,`Connecting to ${num}...`);
}

// ── USER RENDER ──────────────────────────────────────
function renderUserFeed() {
  const alerts = getAlerts();
  const box    = document.getElementById('uFeed');
  if (!box) return;

  if (!alerts.length) {
    box.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">📭</div>
        <div class="es-title">No reports yet</div>
        <div class="es-sub">Send an SOS or report an emergency type above.</div>
      </div>`;
    return;
  }

  const iconBg = {
    'Active':      'background:rgba(217,43,43,.15)',
    'Pending':     'background:rgba(217,119,6,.15)',
    'In Progress': 'background:rgba(37,99,235,.15)',
    'Resolved':    'background:rgba(5,150,105,.15)'
  };
  const bdgCls = { 'Active':'b-ac','Pending':'b-pe','In Progress':'b-pr','Resolved':'b-do' };

  box.innerHTML = [...alerts].reverse().map(a => `
    <div class="feed-item">
      <div class="fi-icon" style="${iconBg[a.status]||'background:rgba(255,255,255,.06)'}">
        ${a.icon || '📍'}
      </div>
      <div class="fi-body">
        <div class="fi-top">
          <span class="fi-type">${a.type}</span>
          <span class="badge ${bdgCls[a.status]||'b-pe'}">${a.status}</span>
        </div>
        <div class="fi-loc">📍 ${a.location}</div>
        <div class="fi-meta">
          <span>🕐 ${a.time}</span>
          <span>#${a.id.slice(-8)}</span>
          ${a.mapLink ? `<a href="${a.mapLink}" target="_blank" style="color:#60A5FA;font-weight:600">🗺 View on Map</a>` : ''}
        </div>
        ${a.updates?.length ? `<div class="fi-update">↳ ${a.updates[a.updates.length-1]}</div>` : ''}
      </div>
    </div>`).join('');
}

function renderUserStats() {
  const a = getAlerts();
  const r = getResolved();
  set('stAc', a.filter(x => x.status === 'Active').length);
  set('stPe', a.filter(x => x.status === 'Pending').length);
  set('stPr', a.filter(x => x.status === 'In Progress').length);
  set('stRe', r.length);
}

// ── ADMIN RENDER ─────────────────────────────────────
function renderAdminAlerts(filter) {
  const f = filter || curFilter;
  let alerts = getAlerts();
  if (f !== 'all') alerts = alerts.filter(a => a.status === f);

  const box   = document.getElementById('aAlertList');
  const total = getAlerts().filter(a => a.status !== 'Resolved').length;
  set('navBadge', total);
  set('aActiveBadge', `${total} Active Alert${total !== 1 ? 's' : ''}`);

  if (!alerts.length) {
    box.innerHTML = `<div class="no-alerts">No ${f==='all'?'':f+' '}alerts. System monitoring.</div>`;
    return;
  }

  const iconBg = {
    'Active':      'background:rgba(217,43,43,.15)',
    'Pending':     'background:rgba(217,119,6,.15)',
    'In Progress': 'background:rgba(37,99,235,.15)',
    'Resolved':    'background:rgba(5,150,105,.15)'
  };
  const bdgCls = { 'Active':'b-ac','Pending':'b-pe','In Progress':'b-pr','Resolved':'b-do' };

  box.innerHTML = [...alerts].reverse().map(a => {
    let btns = '';
    if (a.status === 'Pending' || a.status === 'Active')
      btns += `<button class="aab aab-r" onclick="aRespond('${a.id}')">▶ Respond</button>`;
    if (a.status === 'In Progress')
      btns += `<button class="aab aab-g" onclick="aResolve('${a.id}')">✓ Resolve</button>`;
    if (a.status !== 'Resolved')
      btns += `<button class="aab aab-a" onclick="aDispatch('${a.id}')">📡 Dispatch</button>`;

    return `
      <div class="a-alert-item">
        <div class="aai-icon" style="${iconBg[a.status]||''}">${a.icon||'📍'}</div>
        <div class="aai-body">
          <div class="aai-top">
            <span class="aai-type">${a.type}</span>
            <span class="badge ${bdgCls[a.status]||'b-pe'}">${a.status}</span>
          </div>
          <div class="aai-loc">📍 ${a.location}</div>
          <div class="aai-meta">
            🕐 ${a.time}
            ${a.mapLink ? ` · <a href="${a.mapLink}" target="_blank" style="color:#60A5FA;font-weight:600">🗺 View Map</a>` : ''}
            · #${a.id.slice(-8)}
          </div>
        </div>
        <div class="aai-actions">${btns}</div>
      </div>`;
  }).join('');
}

function renderAdminStats() {
  const a = getAlerts(), r = getResolved();
  set('aStAc', a.filter(x => x.status === 'Active').length);
  set('aStPe', a.filter(x => x.status === 'Pending').length);
  set('aStPr', a.filter(x => x.status === 'In Progress').length);
  set('aStRe', r.length);
}

function renderResolved() {
  const r = getResolved();
  const box = document.getElementById('resList');
  if (!r.length) { box.innerHTML = '<div class="no-alerts">No resolved incidents yet.</div>'; return; }
  box.innerHTML = [...r].reverse().map(a => `
    <div class="res-card">
      <div class="rc-type">${a.icon||'📍'} ${a.type}</div>
      <div class="rc-loc">📍 ${a.location}${a.mapLink ? ` · <a href="${a.mapLink}" target="_blank" style="color:#6EE7B7">View Map</a>` : ''}</div>
      <div class="rc-tag">✅ Resolved · ${a.resolvedAt || a.time}</div>
    </div>`).join('');
}

// ── ADMIN ACTIONS ────────────────────────────────────
function aRespond(id) {
  const alerts = getAlerts();
  const item   = alerts.find(x => x.id === id);
  if (!item) return;
  item.status = 'In Progress';
  item.updates = item.updates || [];
  item.updates.push('Unit dispatched — en route to location');
  saveAlerts(alerts);
  renderAdminAlerts(); renderAdminStats();
  addActivityLog(`▶ Responding: ${item.type} at ${item.location.split(',')[0]}`, '#60A5FA');
  toast('▶️','Response Started','Unit dispatched to location.');
}

function aResolve(id) {
  const alerts = getAlerts();
  const idx    = alerts.findIndex(x => x.id === id);
  if (idx < 0) return;
  const item = alerts[idx];
  item.status     = 'Resolved';
  item.resolvedAt = new Date().toLocaleTimeString();
  item.updates    = item.updates || [];
  item.updates.push('Incident resolved and closed');
  alerts.splice(idx, 1);
  const r = getResolved(); r.push(item);
  saveAlerts(alerts); saveResolved(r);
  renderAdminAlerts(); renderAdminStats(); renderResolved();
  addActivityLog(`✅ Resolved: ${item.type}`, '#6EE7B7');
  toast('✅','Incident Resolved','Moved to resolved log. Citizen status updated.');
}

function aDispatch(id) {
  const alerts = getAlerts();
  const item   = alerts.find(x => x.id === id);
  if (!item) return;
  item.updates = item.updates || [];
  item.updates.push('Additional units dispatched');
  saveAlerts(alerts);
  addActivityLog(`📡 Extra dispatch for ${item.type}`, '#FCD34D');
  toast('📡','Units Dispatched','Additional resources sent to location.');
}

function filterA(f, btn) {
  curFilter = f;
  document.querySelectorAll('.ftab').forEach(t => t.classList.remove('on'));
  btn.classList.add('on');
  renderAdminAlerts(f);
}

// ── ADMIN TABS ───────────────────────────────────────
function aTab(tab, el) {
  document.querySelectorAll('.as-nav a').forEach(a => a.classList.remove('on'));
  document.querySelectorAll('.a-tab').forEach(t => t.classList.remove('on'));
  if (el) el.classList.add('on');
  if (tab === 'live') {
    document.getElementById('tabLive').classList.add('on');
    renderAdminAlerts();
  } else {
    document.getElementById('tabResolved').classList.add('on');
    renderResolved();
  }
}

// ── ACTIVITY LOG ─────────────────────────────────────
function addActivityLog(text, color) {
  const log = document.getElementById('actLog');
  if (!log) return;
  const d = document.createElement('div');
  d.className = 'act-item';
  d.innerHTML = `
    <div class="act-dot" style="background:${color}"></div>
    <div>
      <div class="act-txt">${text}</div>
      <div class="act-time">${new Date().toLocaleTimeString()}</div>
    </div>`;
  log.insertBefore(d, log.firstChild);
  while (log.children.length > 10) log.removeChild(log.lastChild);
}

// ── CLOCKS & POLLING ─────────────────────────────────
function startAdminClock() {
  const tick = () => { const el = document.getElementById('aClock'); if (el) el.textContent = new Date().toLocaleTimeString(); };
  tick(); setInterval(tick, 1000);
}

function startUserPoll() {
  setInterval(() => {
    if (document.getElementById('pg-userDash')?.classList.contains('active')) {
      renderUserFeed(); renderUserStats();
    }
  }, 3000);
}

function startAdminPoll() {
  setInterval(() => {
    if (document.getElementById('pg-adminDash')?.classList.contains('active')) {
      renderAdminAlerts(); renderAdminStats();
    }
  }, 3000);
}

// ── TOAST ─────────────────────────────────────────────
function toast(icon, title, msg) {
  const el = document.getElementById('toast');
  document.getElementById('tIcon').textContent  = icon;
  document.getElementById('tTitle').textContent = title;
  document.getElementById('tMsg').textContent   = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 4500);
}

// ── HELPERS ───────────────────────────────────────────
function v(id)      { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function set(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
