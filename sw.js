// แคชไฟล์ของแอปไว้ในเครื่อง เปิดแอปได้แม้ไม่มีเน็ต (ข้อมูลบิลเก็บใน localStorage แยกต่างหาก)
var CACHE = 'pos-v1';
var FILES = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'img/icon.svg',
  'img/espresso.svg', 'img/americano.svg', 'img/latte.svg', 'img/cappuccino.svg', 'img/mocha.svg', 'img/caramel.svg',
  'img/thaitea.svg', 'img/matcha.svg', 'img/lemontea.svg', 'img/cocoa.svg', 'img/caramelmilk.svg',
  'img/croissant.svg', 'img/brownie.svg', 'img/cheesecake.svg', 'img/toast.svg'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); })); self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }));
  self.clients.claim();
});
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // ไม่แคชการเรียก API
  // เครือข่ายก่อน ถ้าไม่มีเน็ตใช้ไฟล์ที่แคชไว้
  e.respondWith(fetch(e.request).then(function (r) {
    var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); return r;
  }).catch(function () { return caches.match(e.request); }));
});
