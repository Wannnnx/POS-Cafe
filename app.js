/* POS คาเฟ่ – หน้าแอป
 * ทำงานบนเบราว์เซอร์ (มือถือ แท็บเล็ต Laptop) คุยกับ Google Apps Script Web App
 * บิลถูกเก็บในคิวบนเครื่องก่อน แล้วค่อยส่งขึ้น Google Sheet (ใช้ได้แม้เน็ตหลุด)
 */
(function () {
  'use strict';

  // ---------- ค่าเริ่มต้น ----------
  var DEFAULT_SETTINGS = {
    shopName: 'คาเฟ่ของฉัน',
    address: '',
    phone: '',
    footer: 'ขอบคุณที่แวะมาค่ะ',
    device: 'POS-01',
    apiUrl: 'https://script.google.com/macros/s/AKfycbweA1ISC1Fapud4t2JD1iRQwSZrv_NfV8kXaoncEEUPGN7mKNeGSkMKtj1UQWN0N4Q8/exec',
    autoPrint: false
  };
  var IMG_BY_ID = {
    c1: 'espresso', c2: 'americano', c3: 'latte', c4: 'cappuccino', c5: 'mocha', c6: 'caramel',
    t1: 'thaitea', t2: 'matcha', t3: 'lemontea', o1: 'cocoa', o2: 'caramelmilk',
    s1: 'croissant', s2: 'brownie', s3: 'cheesecake', s4: 'toast'
  };
  var IMG_BY_CAT = { 'กาแฟ': 'latte', 'ชา': 'thaitea', 'ไม่มีกาแฟ': 'cocoa', 'ของทานเล่น': 'croissant' };
  var TINT_BY_CAT = { 'กาแฟ': '#F1E3D3', 'ชา': '#EAEBD6', 'ไม่มีกาแฟ': '#F2E3DC', 'ของทานเล่น': '#F6E8CB' };
  var TINTS = ['#F1E3D3', '#EAEBD6', '#F2E3DC', '#F6E8CB', '#E6E9EE'];

  // ---------- สถานะ ----------
  var S = {
    settings: load('pos_settings', DEFAULT_SETTINGS),
    session: load('pos_session', null),     // {pin, name, role}
    menu: load('pos_menu', []),
    queue: load('pos_queue', []),           // บิลที่ยังไม่ได้ส่งขึ้นชีต
    receipts: load('pos_receipts', {}),     // clientId -> เลขใบเสร็จจากเซิร์ฟเวอร์
    cat: 'all',
    q: '',
    cart: [],                               // {key, id, option, qty}
    orderType: 'ทานที่ร้าน',
    pay: 'เงินสด',
    lastOrder: null,
    syncing: false
  };
  S.settings = Object.assign({}, DEFAULT_SETTINGS, S.settings);

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function load(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function baht(n) { return '฿' + Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 }); }
  function money(n) { return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)); }
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 2600); }
  function isoLocal(d) {
    var p = function (n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '+07:00';
  }

  // ---------- เรียก API ----------
  function apiGet(params) {
    var url = S.settings.apiUrl + '?' + new URLSearchParams(params).toString();
    return fetch(url, { method: 'GET', redirect: 'follow' }).then(readJson);
  }
  function apiPost(body) {
    // text/plain เพื่อไม่ให้เบราว์เซอร์ส่ง preflight (Apps Script ไม่รองรับ OPTIONS)
    return fetch(S.settings.apiUrl, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }).then(readJson);
  }
  function readJson(res) {
    return res.json().then(function (j) {
      if (!j.ok) { var e = new Error(j.error || 'เกิดข้อผิดพลาด'); e.server = true; throw e; }
      return j.data;
    });
  }

  // ---------- เข้าสู่ระบบ ----------
  var pin = '';
  function showLogin() {
    $('#app').hidden = true; $('#login').hidden = false;
    pin = ''; drawPin(); $('#loginError').textContent = '';
    $$('.shop-name').forEach(function (el) { el.textContent = S.settings.shopName; });
  }
  function drawPin() { $$('#pinDots span').forEach(function (s, i) { s.classList.toggle('on', i < pin.length); }); }
  $('#pinpad').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var k = b.dataset.k;
    if (k === 'del') { pin = pin.slice(0, -1); drawPin(); return; }
    if (k === 'set') { enterApp({ pin: '', name: 'ตั้งค่า', role: 'setup' }); go('settings'); return; }
    if (pin.length >= 4) return;
    pin += k; drawPin();
    if (pin.length === 4) tryLogin(pin);
  });
  function tryLogin(p) {
    $('#loginError').textContent = 'กำลังตรวจสอบ…';
    apiGet({ action: 'ping', pin: p }).then(function (d) {
      var sess = { pin: p, name: d.staff, role: d.role };
      save('pos_session', sess); enterApp(sess);
    }).catch(function (err) {
      pin = ''; drawPin();
      $('#loginError').textContent = err.server ? err.message : 'เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตหรือ URL ในตั้งค่า';
    });
  }
  $('#logoutBtn').addEventListener('click', function () {
    if (S.cart.length && !confirm('มีออเดอร์ค้างอยู่ ต้องการออกจากระบบไหม')) return;
    S.session = null; localStorage.removeItem('pos_session'); S.cart = []; showLogin();
  });

  function enterApp(sess) {
    S.session = sess;
    $('#login').hidden = true; $('#app').hidden = false;
    $('#logoutBtn').textContent = String(sess.name || '?').replace(/^[เแโใไ]/, '').charAt(0);
    $$('.owner-only').forEach(function (el) { el.hidden = sess.role !== 'owner'; });
    $$('.shop-name').forEach(function (el) { el.textContent = S.settings.shopName; });
    updateSubline();
    if (sess.role === 'setup') return;
    go('sell'); renderAll();
    if (sess.pin) refreshMenu(true);
    flushQueue();
  }
  function updateSubline() {
    var d = new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    $('#subline').textContent = d + ' · ' + (S.session ? S.session.name : '') + ' · ' + S.settings.device;
  }

  // ---------- เปลี่ยนหน้า ----------
  function go(view) {
    if (S.session && S.session.role === 'setup' && view !== 'settings') { showLogin(); return; }
    ['sell', 'report', 'settings'].forEach(function (v) { $('#view-' + v).hidden = v !== view; });
    $('#cart').hidden = view !== 'sell';
    $('#cartbar').hidden = view !== 'sell' || !S.cart.length;
    $$('.rail-btn').forEach(function (b) { b.classList.toggle('on', b.dataset.view === view); });
    if (view === 'report') loadReport();
    if (view === 'settings') fillSettings();
  }
  $$('.rail-btn').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.view); }); });

  // ---------- เมนู ----------
  function refreshMenu(silent) {
    return apiGet({ action: 'menu', pin: S.session.pin }).then(function (d) {
      S.menu = d.menu; save('pos_menu', S.menu); renderAll();
      if (!silent) toast('โหลดเมนูแล้ว ' + S.menu.length + ' รายการ');
    }).catch(function (err) {
      if (err.server && /PIN/.test(err.message)) { toast(err.message); showLogin(); return; }
      if (!silent) toast('โหลดเมนูไม่ได้: ' + err.message);
    });
  }
  function cats() {
    var seen = [];
    S.menu.forEach(function (m) { if (seen.indexOf(m.category) < 0) seen.push(m.category); });
    return seen;
  }
  function tint(cat) { return TINT_BY_CAT[cat] || TINTS[Math.abs(hash(cat)) % TINTS.length]; }
  function hash(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
  function imgFor(m) {
    if (m.image) return { src: m.image, photo: true };
    return { src: 'img/' + (IMG_BY_ID[m.id] || IMG_BY_CAT[m.category] || 'latte') + '.svg', photo: false };
  }
  function findMenu(id) { for (var i = 0; i < S.menu.length; i++) if (S.menu[i].id === id) return S.menu[i]; return null; }

  function renderChips() {
    var list = [{ id: 'all', label: 'ทั้งหมด', n: S.menu.length }].concat(cats().map(function (c) {
      return { id: c, label: c, n: S.menu.filter(function (m) { return m.category === c; }).length };
    }));
    $('#chips').innerHTML = list.map(function (c) {
      return '<button type="button" class="chip' + (S.cat === c.id ? ' on' : '') + '" data-cat="' + esc(c.id) + '" aria-pressed="' + (S.cat === c.id) + '">' + esc(c.label) + '<b>' + c.n + '</b></button>';
    }).join('');
  }
  $('#chips').addEventListener('click', function (e) {
    var b = e.target.closest('.chip'); if (!b) return;
    S.cat = b.dataset.cat; renderChips(); renderGrid();
  });
  $('#search').addEventListener('input', function (e) { S.q = e.target.value.trim(); renderGrid(); });

  function qtyInCart(id) { return S.cart.reduce(function (s, l) { return s + (l.id === id ? l.qty : 0); }, 0); }
  function renderGrid() {
    var q = S.q.toLowerCase();
    var items = S.menu.filter(function (m) {
      return (S.cat === 'all' || m.category === S.cat) && (!q || String(m.name).toLowerCase().indexOf(q) >= 0);
    });
    if (!S.menu.length) { $('#grid').innerHTML = '<div class="empty">ยังไม่มีเมนู ไปที่ ตั้งค่า > โหลดเมนูใหม่</div>'; return; }
    if (!items.length) { $('#grid').innerHTML = '<div class="empty">ไม่พบเมนูที่ค้นหา</div>'; return; }
    $('#grid').innerHTML = items.map(function (m) {
      var im = imgFor(m), n = qtyInCart(m.id);
      return '<button type="button" class="item' + (n ? ' in' : '') + '" data-id="' + esc(m.id) + '" aria-label="เพิ่ม ' + esc(m.name) + '">' +
        '<div class="pic" style="background:' + tint(m.category) + '"><img src="' + esc(im.src) + '" alt="" loading="lazy"' + (im.photo ? ' class="photo"' : '') + '></div>' +
        (n ? '<span class="qty">' + n + '</span>' : '') +
        '<div class="nm">' + esc(m.name) + '</div>' +
        '<div class="sub">' + esc((m.options || []).join(' · ')) + '</div>' +
        '<div class="ft"><span class="pr">' + baht(m.price) + '</span><span class="plus" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span></div>' +
        '</button>';
    }).join('');
  }
  $('#grid').addEventListener('click', function (e) {
    var b = e.target.closest('.item'); if (!b) return;
    var m = findMenu(b.dataset.id); if (!m) return;
    if (m.options && m.options.length > 1) pickOption(m); else addToCart(m.id, (m.options && m.options[0]) || '');
  });

  // ---------- ตัวเลือก ----------
  function pickOption(m) {
    var im = imgFor(m);
    $('#optImg').src = im.src; $('#optImg').style.background = tint(m.category);
    $('#optName').textContent = m.name; $('#optPrice').textContent = baht(m.price);
    $('#optList').innerHTML = m.options.map(function (o) { return '<button value="' + esc(o) + '">' + esc(o) + '</button>'; }).join('');
    var d = $('#optDialog');
    d.onclose = function () { if (d.returnValue && d.returnValue !== 'cancel') addToCart(m.id, d.returnValue); d.returnValue = ''; };
    d.showModal();
  }

  // ---------- ตะกร้า ----------
  function addToCart(id, option) {
    var key = id + '|' + option;
    var l = S.cart.filter(function (x) { return x.key === key; })[0];
    if (l) l.qty++; else S.cart.push({ key: key, id: id, option: option, qty: 1 });
    renderCart(); renderGrid();
  }
  function changeQty(key, d) {
    S.cart = S.cart.map(function (l) { if (l.key === key) l.qty += d; return l; }).filter(function (l) { return l.qty > 0; });
    renderCart(); renderGrid();
  }
  function totals() {
    var sub = S.cart.reduce(function (s, l) { var m = findMenu(l.id); return s + (m ? m.price * l.qty : 0); }, 0);
    var disc = Math.min(sub, Math.max(0, Number($('#discount').value) || 0));
    return { sub: sub, disc: disc, total: sub - disc, count: S.cart.reduce(function (s, l) { return s + l.qty; }, 0) };
  }
  function renderCart() {
    if (!S.cart.length) {
      $('#lines').innerHTML = '<div class="cart-empty"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#C9B19B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/></svg><p>แตะเมนูเพื่อเริ่มออเดอร์</p></div>';
    } else {
      $('#lines').innerHTML = S.cart.map(function (l) {
        var m = findMenu(l.id) || { name: l.id, price: 0 }, im = imgFor(m);
        return '<div class="line"><div class="thumb" style="background:' + tint(m.category) + '"><img src="' + esc(im.src) + '" alt=""' + (im.photo ? ' class="photo"' : '') + '></div>' +
          '<div class="info"><div class="nm">' + esc(m.name) + '</div><div class="op">' + esc(l.option ? l.option + ' · ' : '') + baht(m.price * l.qty) + '</div></div>' +
          '<div class="stepper"><button type="button" data-key="' + esc(l.key) + '" data-d="-1" aria-label="ลด ' + esc(m.name) + '">−</button><span>' + l.qty + '</span>' +
          '<button type="button" class="add" data-key="' + esc(l.key) + '" data-d="1" aria-label="เพิ่ม ' + esc(m.name) + '">+</button></div></div>';
      }).join('');
    }
    var t = totals();
    $('#subtotal').textContent = baht(t.sub);
    $('#total').textContent = baht(t.total);
    $('#chargeTotal').textContent = baht(t.total);
    $('#chargeBtn').disabled = !S.cart.length;
    $('#cartbarCount').textContent = t.count + ' รายการ';
    $('#cartbarTotal').textContent = baht(t.total);
    $('#cartbar').hidden = !S.cart.length || $('#view-sell').hidden;
    if (!S.cart.length) $('#cart').classList.remove('open');
  }
  $('#lines').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-key]'); if (b) changeQty(b.dataset.key, Number(b.dataset.d));
  });
  $('#discount').addEventListener('input', renderCart);
  $('#clearCart').addEventListener('click', function () { if (S.cart.length && confirm('ล้างออเดอร์นี้?')) { S.cart = []; $('#discount').value = 0; renderCart(); renderGrid(); } });
  $$('.seg button').forEach(function (b) { b.addEventListener('click', function () { S.orderType = b.dataset.type; $$('.seg button').forEach(function (x) { x.classList.toggle('on', x === b); }); }); });
  $$('.pay button').forEach(function (b) { b.addEventListener('click', function () { S.pay = b.dataset.pay; $$('.pay button').forEach(function (x) { x.classList.toggle('on', x === b); }); }); });
  $('#cartbar').addEventListener('click', function () { $('#cart').classList.add('open'); });
  $('#closeCart').addEventListener('click', function () { $('#cart').classList.remove('open'); });

  // ---------- ชำระเงิน ----------
  $('#chargeBtn').addEventListener('click', function () {
    if (!S.cart.length) return;
    var t = totals(), now = new Date();
    var order = {
      clientId: uuid(),
      createdAt: isoLocal(now),
      device: S.settings.device,
      orderType: S.orderType,
      payment: S.pay,
      discount: t.disc,
      items: S.cart.map(function (l) { return { id: l.id, qty: l.qty, option: l.option }; })
    };
    // ข้อมูลสำหรับพิมพ์ใบเสร็จ (เก็บไว้บนเครื่อง)
    S.lastOrder = {
      order: order, when: now, staff: S.session.name, sub: t.sub, disc: t.disc, total: t.total,
      lines: S.cart.map(function (l) { var m = findMenu(l.id); return { name: m.name, option: l.option, qty: l.qty, price: m.price }; }),
      cashIn: null
    };
    S.queue.push(order); save('pos_queue', S.queue);
    S.cart = []; $('#discount').value = 0; renderCart(); renderGrid();
    $('#cart').classList.remove('open');
    showDone();
    flushQueue();
  });

  function showDone() {
    var o = S.lastOrder;
    $('#doneInfo').textContent = o.order.payment + ' · ' + baht(o.total);
    var cash = o.order.payment === 'เงินสด';
    $('#changeBox').hidden = !cash;
    $('#cashIn').value = ''; $('#changeOut').textContent = '';
    if (cash) {
      var opts = [o.total, Math.ceil(o.total / 100) * 100, 500, 1000].filter(function (v, i, a) { return v >= o.total && a.indexOf(v) === i; }).slice(0, 4);
      $('#quickCash').innerHTML = opts.map(function (v) { return '<button type="button" data-v="' + v + '">' + baht(v) + '</button>'; }).join('');
    }
    $('#doneDialog').showModal();
    if (S.settings.autoPrint && !cash) setTimeout(printReceipt, 300);
  }
  function updateChange() {
    var o = S.lastOrder, v = Number($('#cashIn').value);
    o.cashIn = v || null;
    $('#changeOut').textContent = v ? (v >= o.total ? 'เงินทอน ' + baht(v - o.total) : 'เงินยังไม่พอ') : '';
  }
  $('#cashIn').addEventListener('input', updateChange);
  $('#quickCash').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { $('#cashIn').value = b.dataset.v; updateChange(); } });
  $('#printBtn').addEventListener('click', printReceipt);
  $('#newOrderBtn').addEventListener('click', function () {
    if (S.settings.autoPrint && S.lastOrder.order.payment === 'เงินสด') printReceipt();
    $('#doneDialog').close();
  });

  // ---------- ใบเสร็จ ----------
  function printReceipt() {
    var o = S.lastOrder; if (!o) return;
    var no = S.receipts[o.order.clientId] || ('รอเลข-' + o.order.clientId.slice(0, 6).toUpperCase());
    var st = S.settings;
    var d = o.when;
    var dt = d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    var html = '<div class="c b big">' + esc(st.shopName) + '</div>' +
      (st.address ? '<div class="c s">' + esc(st.address) + '</div>' : '') +
      (st.phone ? '<div class="c s">โทร ' + esc(st.phone) + '</div>' : '') +
      '<div class="hr"></div><div class="c b">ใบเสร็จรับเงิน</div>' +
      '<div class="r s"><span>เลขที่</span><span>' + esc(no) + '</span></div>' +
      '<div class="r s"><span>วันที่</span><span>' + esc(dt) + '</span></div>' +
      '<div class="r s"><span>พนักงาน</span><span>' + esc(o.staff) + '</span></div>' +
      '<div class="r s"><span>ประเภท</span><span>' + esc(o.order.orderType) + '</span></div>' +
      '<div class="hr"></div>' +
      o.lines.map(function (l) {
        return '<div class="r"><span class="b">' + esc(l.name) + (l.option ? ' (' + esc(l.option) + ')' : '') + '</span><span>' + money(l.price * l.qty) + '</span></div>' +
          '<div class="s">  ' + l.qty + ' x ' + money(l.price) + '</div>';
      }).join('') +
      '<div class="hr"></div>' +
      '<div class="r"><span>ยอดรวม</span><span>' + money(o.sub) + '</span></div>' +
      '<div class="r"><span>ส่วนลด</span><span>' + money(o.disc) + '</span></div>' +
      '<div class="r b big"><span>ยอดสุทธิ</span><span>' + money(o.total) + '</span></div>' +
      '<div class="r s"><span>ชำระโดย</span><span>' + esc(o.order.payment) + '</span></div>' +
      (o.cashIn ? '<div class="r s"><span>รับเงิน</span><span>' + money(o.cashIn) + '</span></div><div class="r s"><span>เงินทอน</span><span>' + money(Math.max(0, o.cashIn - o.total)) + '</span></div>' : '') +
      '<div class="hr"></div><div class="c">' + esc(st.footer) + '</div>';
    $('#receipt').innerHTML = html;
    window.print();
  }

  // ---------- ส่งบิลขึ้นชีต ----------
  function flushQueue() {
    renderSync();
    if (S.syncing || !S.queue.length || !S.session || !S.session.pin) return;
    if (!navigator.onLine) return;
    S.syncing = true; renderSync();
    var o = S.queue[0];
    apiPost({ action: 'saveOrder', pin: S.session.pin, order: o }).then(function (d) {
      S.receipts[o.clientId] = d.receiptNo;
      var keys = Object.keys(S.receipts); if (keys.length > 200) delete S.receipts[keys[0]];
      save('pos_receipts', S.receipts);
      S.queue.shift(); save('pos_queue', S.queue);
      S.syncing = false; flushQueue();
    }).catch(function (err) {
      S.syncing = false;
      if (err.server) {
        // เซิร์ฟเวอร์ปฏิเสธ (เช่น เมนูถูกลบ) ย้ายไปท้ายคิวและแจ้งเตือน ไม่ทิ้งบิล
        toast('ส่งบิลไม่ได้: ' + err.message);
        if (S.queue.length > 1) { S.queue.push(S.queue.shift()); save('pos_queue', S.queue); }
      }
      renderSync();
    });
  }
  function renderSync() {
    var c = $('#syncChip'), t = c.querySelector('span');
    c.classList.remove('wait', 'off');
    if (!navigator.onLine) { c.classList.add('off'); t.textContent = 'ออฟไลน์' + (S.queue.length ? ' · รอส่ง ' + S.queue.length + ' บิล' : ''); }
    else if (S.queue.length) { c.classList.add('wait'); t.textContent = S.syncing ? 'กำลังส่ง ' + S.queue.length + ' บิล' : 'รอส่ง ' + S.queue.length + ' บิล'; }
    else t.textContent = 'Sync แล้ว';
    var qi = $('#queueInfo'); if (qi) qi.textContent = 'บิลที่ยังไม่ได้ส่งขึ้นชีต: ' + S.queue.length + ' บิล';
  }
  window.addEventListener('online', flushQueue);
  window.addEventListener('offline', renderSync);
  setInterval(flushQueue, 20000);

  // ---------- รายงาน ----------
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  $('#reportDate').value = todayStr();
  $('#reportDate').addEventListener('change', loadReport);
  $('#reportReload').addEventListener('click', loadReport);
  function loadReport() {
    $('#report').innerHTML = '<p class="muted">กำลังโหลด…</p>';
    apiGet({ action: 'report', pin: S.session.pin, date: $('#reportDate').value || todayStr() }).then(renderReport).catch(function (err) {
      $('#report').innerHTML = '<p class="muted">โหลดรายงานไม่ได้: ' + esc(err.message) + '</p>';
    });
  }
  function renderReport(r) {
    var hours = []; for (var h = 7; h <= 20; h++) hours.push(h);
    Object.keys(r.hourly || {}).forEach(function (k) { k = Number(k); if (hours.indexOf(k) < 0) hours.push(k); });
    hours.sort(function (a, b) { return a - b; });
    var max = Math.max.apply(null, hours.map(function (h) { return r.hourly[h] || 0; }).concat([1]));
    var pays = Object.keys(r.byPayment || {});
    var vat = 1800000, pct = Math.min(100, (r.yearTotal / vat) * 100);
    $('#report').innerHTML =
      '<div class="card hero"><div class="lab">ยอดขาย</div><div class="big">' + baht(r.total) + '</div>' +
      '<div class="row gap" style="margin-top:8px"><span class="lab">บิล</span><b>' + r.bills + '</b><span class="lab" style="margin-left:12px">เฉลี่ย/บิล</span><b>' + baht(Math.round(r.avgPerBill)) + '</b></div></div>' +
      '<div class="card"><h3>ยอดขายรายชั่วโมง</h3><div class="bars">' + hours.map(function (h) {
        var v = r.hourly[h] || 0;
        return '<div title="' + h + ':00 ' + baht(v) + '"><i style="height:' + Math.round(v / max * 110) + 'px"' + (v === max && v > 0 ? ' class="max"' : '') + '></i>' + h + '</div>';
      }).join('') + '</div></div>' +
      '<div class="card"><h3>เมนูขายดี</h3><div class="toplist">' + (r.topItems.length ? r.topItems.map(function (t, i) {
        return '<div><span>' + (i + 1) + '. ' + esc(t.name) + '</span><span>' + t.qty + ' · ' + baht(t.amount) + '</span></div>';
      }).join('') : '<p class="muted">ยังไม่มีการขาย</p>') + '</div></div>' +
      '<div class="card"><h3>ช่องทางชำระเงิน</h3>' + (pays.length ? pays.map(function (p) {
        var v = r.byPayment[p], pc = r.total ? Math.round(v / r.total * 100) : 0;
        return '<div class="row between" style="margin:8px 0 4px"><span>' + esc(p) + '</span><span>' + pc + '% · ' + baht(v) + '</span></div><div class="meter"><i style="width:' + pc + '%"></i></div>';
      }).join('') : '<p class="muted">ยังไม่มีการขาย</p>') + '</div>' +
      '<div class="card"><h3>ยอดสะสมทั้งปีเทียบเกณฑ์ VAT</h3><div class="row between" style="margin-bottom:6px"><span>' + baht(r.yearTotal) + '</span><span class="muted">จาก ' + baht(vat) + '</span></div><div class="meter"><i style="width:' + pct.toFixed(1) + '%"></i></div></div>';
  }

  // ---------- ตั้งค่า ----------
  function fillSettings() {
    var f = $('#settingsForm');
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
      var el = f.elements[k]; if (!el) return;
      if (el.type === 'checkbox') el.checked = !!S.settings[k]; else el.value = S.settings[k] || '';
    });
    $('#settingsMsg').textContent = '';
    renderSync();
  }
  $('#settingsForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, s = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) { var el = f.elements[k]; if (el) s[k] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
    S.settings = Object.assign({}, S.settings, s); save('pos_settings', S.settings);
    $$('.shop-name').forEach(function (el) { el.textContent = S.settings.shopName; });
    updateSubline();
    $('#settingsMsg').textContent = 'บันทึกแล้ว';
    if (S.session && S.session.role === 'setup') setTimeout(showLogin, 600);
  });
  $('#reloadMenu').addEventListener('click', function () {
    if (!S.session || !S.session.pin) { toast('เข้าสู่ระบบด้วย PIN ก่อนโหลดเมนู'); return; }
    refreshMenu(false);
  });

  function renderAll() { renderChips(); renderGrid(); renderCart(); renderSync(); }

  // ---------- เริ่มต้น ----------
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
  if (S.session && S.session.pin) enterApp(S.session); else showLogin();
})();
