/* Ricette Ciociare e non solo – navigazione, menu a tendina, catalogo, carrello, configuratore 3D */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
  var SITE = 'Ricette Ciociare e non solo';

  var CATALOGO = window.CATALOGO || [];
  var PRODOTTO = CATALOGO[0];
  function prodotto(id) { return CATALOGO.filter(function (p) { return p.id === id; })[0]; }
  function colore(p, id) { return p.colori.filter(function (c) { return c.id === id; })[0] || p.colori[0]; }

  /* ---------------- Toast ---------------- */
  var toastEl = $('[data-toast]'), toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-visible'); }, 2800);
  }

  /* ---------------- Menu a tendina ---------------- */
  var menu = $('[data-menu]'), toggle = $('[data-menu-toggle]'), panel = $('[data-menu-panel]');
  function setMenu(open, focusToggle) {
    menu.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      var first = $('a', panel);
      if (first) setTimeout(function () { first.focus(); }, 60);
    } else if (focusToggle) {
      toggle.focus();
    }
  }
  toggle.addEventListener('click', function () { setMenu(!menu.classList.contains('is-open')); });
  document.addEventListener('click', function (e) {
    if (menu.classList.contains('is-open') && !menu.contains(e.target)) setMenu(false);
  });
  panel.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
  // mantiene il focus da tastiera dentro carrello / configuratore quando sono aperti
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var box = !cartEl.hidden ? cartEl : !cfg.hidden ? cfg : null;
    if (!box) return;
    var items = $$(FOCUSABLE, box).filter(function (el) { return el.offsetParent !== null; });
    if (!items.length) return;
    var first = items[0], lastEl = items[items.length - 1];
    if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (menu.classList.contains('is-open')) { setMenu(false, true); return; }
    if (!cartEl.hidden) { closeCart(); return; }
    if (!cfg.hidden) closeConfigurator();
  });

  /* ---------------- Carrello ---------------- */
  var KEY = 'rcens-carrello-v1';
  var cart = [];
  try { cart = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { cart = []; }
  cart = cart.filter(function (it) { return prodotto(it.prodotto); });

  function saveCart() {
    try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (e) { /* memoria non disponibile */ }
    renderCart();
  }
  function addToCart(pid, cid, taglia, qty) {
    var found = cart.filter(function (it) { return it.prodotto === pid && it.colore === cid && it.taglia === taglia; })[0];
    if (found) found.qty = Math.min(99, found.qty + qty);
    else cart.push({ prodotto: pid, colore: cid, taglia: taglia, qty: qty });
    saveCart();
  }
  function cartCount() { return cart.reduce(function (n, it) { return n + it.qty; }, 0); }
  function cartTotal() { return cart.reduce(function (s, it) { return s + prodotto(it.prodotto).prezzo * it.qty; }, 0); }

  function apronIcon(hex, thread) {
    return '<svg viewBox="0 0 40 48" aria-hidden="true">' +
      '<path d="M13 3h14v9c0 3 2 6 9 7v25a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V19c7-1 9-4 9-7V3Z" fill="' + hex + '" stroke="rgba(0,0,0,.18)"/>' +
      '<rect x="14" y="10" width="12" height="3" rx="1" fill="' + thread + '"/>' +
      '<rect x="13" y="15" width="14" height="4" rx="1" fill="#f0b81c"/>' +
      '<rect x="15" y="21" width="10" height="2" rx="1" fill="' + thread + '"/>' +
      '<rect x="7" y="29" width="11" height="10" rx="1" fill="none" stroke="rgba(0,0,0,.2)"/></svg>';
  }

  var cartEl = $('[data-cart]'), backdrop = $('[data-cart-backdrop]'), lastFocus = null;
  function renderCart() {
    var n = cartCount();
    $$('[data-cart-count]').forEach(function (el) { el.textContent = n; el.hidden = n === 0; });
    $$('[data-open-cart]').forEach(function (b) { b.setAttribute('aria-label', 'Apri il carrello (' + n + (n === 1 ? ' articolo)' : ' articoli)')); });
    var list = $('[data-cart-list]');
    list.innerHTML = cart.map(function (it, i) {
      var p = prodotto(it.prodotto), c = colore(p, it.colore);
      return '<li class="cart-item">' +
        '<span class="cart-thumb" style="--bg:' + c.hex + '">' + apronIcon(c.hex, c.ricamo) + '</span>' +
        '<div class="cart-info"><p class="cart-name">' + p.nome + '</p>' +
        '<p class="cart-meta">Colore: ' + c.nome + ' · Taglia: ' + it.taglia + '</p>' +
        '<div class="qty qty-sm">' +
        '<button type="button" data-cart-dec="' + i + '" aria-label="Diminuisci quantità">−</button>' +
        '<output>' + it.qty + '</output>' +
        '<button type="button" data-cart-inc="' + i + '" aria-label="Aumenta quantità">+</button></div></div>' +
        '<div class="cart-side"><span class="cart-price">' + euro.format(p.prezzo * it.qty) + '</span>' +
        '<button class="link-btn" type="button" data-cart-remove="' + i + '">Rimuovi</button></div></li>';
    }).join('');
    $('[data-cart-empty]').hidden = cart.length > 0;
    $('[data-cart-foot]').hidden = cart.length === 0;
    $('[data-cart-total]').textContent = euro.format(cartTotal());
  }
  $('[data-cart-list]').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var i;
    if (b.hasAttribute('data-cart-inc')) { i = +b.getAttribute('data-cart-inc'); cart[i].qty = Math.min(99, cart[i].qty + 1); }
    else if (b.hasAttribute('data-cart-dec')) { i = +b.getAttribute('data-cart-dec'); cart[i].qty -= 1; if (cart[i].qty < 1) cart.splice(i, 1); }
    else if (b.hasAttribute('data-cart-remove')) { i = +b.getAttribute('data-cart-remove'); cart.splice(i, 1); }
    else return;
    saveCart();
    var again = cart.length ? $('[data-cart-list] button') : $('[data-cart-empty] a');
    if (!document.activeElement || !cartEl.contains(document.activeElement) || document.activeElement === document.body) {
      if (again) again.focus();
    }
  });

  function openCart() {
    lastFocus = document.activeElement;
    setMenu(false);
    cartEl.hidden = false; backdrop.hidden = false;
    requestAnimationFrame(function () { cartEl.classList.add('is-open'); backdrop.classList.add('is-open'); });
    document.body.classList.add('no-scroll');
    setTimeout(function () { $('[data-close-cart]', cartEl).focus(); }, 50);
  }
  function closeCart(skipFocus) {
    cartEl.classList.remove('is-open'); backdrop.classList.remove('is-open');
    setTimeout(function () {
      if (!cartEl.classList.contains('is-open')) { cartEl.hidden = true; backdrop.hidden = true; }
    }, 280);
    if (cfg.hidden) document.body.classList.remove('no-scroll');
    if (!skipFocus && lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }
  $$('[data-open-cart]').forEach(function (b) { b.addEventListener('click', openCart); });
  $$('[data-close-cart]').forEach(function (b) { b.addEventListener('click', function () { closeCart(b.tagName === 'A'); }); });
  backdrop.addEventListener('click', function () { closeCart(); });
  $('[data-checkout]').addEventListener('click', function () {
    toast('Il checkout online arriverà presto: grazie per la pazienza!');
  });

  /* ---------------- Catalogo ---------------- */
  function swatches(p, cls) {
    return p.colori.map(function (c) {
      return '<a class="' + cls + '" href="#' + p.id + '-' + c.id + '" style="--c:' + c.hex + '" title="' + c.nome + '"><span class="sr-only">' + p.nome + ' ' + c.nome + '</span></a>';
    }).join('');
  }
  $('[data-product-grid]').innerHTML = CATALOGO.map(function (p) {
    return '<article class="product-card">' +
      '<a class="product-media" href="#' + p.id + '" aria-label="' + p.nome + ' – vista 3D">' +
      '<img src="' + p.immagine + '" alt="' + p.nome + ' nei colori nero, bianco e rosso" loading="lazy" width="1200" height="1600">' +
      '<span class="badge">Vista 3D</span></a>' +
      '<div class="product-body">' +
      '<h2 class="product-name"><a href="#' + p.id + '">' + p.nome + '</a></h2>' +
      '<p class="product-short">' + p.breve + ' · Taglia ' + p.taglie.join(', ').toLowerCase() + '</p>' +
      '<p class="product-desc">' + p.descrizione + '</p>' +
      '<div class="product-swatches" aria-label="Colori disponibili">' + swatches(p, 'swatch') + '</div>' +
      '<div class="product-foot"><span class="price">' + euro.format(p.prezzo) + '</span>' +
      '<a class="btn btn-brown btn-sm" href="#' + p.id + '">Scegli il colore</a></div>' +
      '</div></article>';
  }).join('');
  var swLinks = $('[data-swatch-links]');
  if (swLinks && PRODOTTO) swLinks.innerHTML = swatches(PRODOTTO, 'swatch swatch-sm') +
    '<span class="swatch-names">' + PRODOTTO.colori.map(function (c) { return c.nome.toLowerCase(); }).join(', ') + '</span>';
  var ph = $('[data-price-home]');
  if (ph && PRODOTTO) ph.textContent = euro.format(PRODOTTO.prezzo);

  /* ---------------- Configuratore 3D ---------------- */
  var cfg = $('[data-configurator]');
  var canvas = $('[data-canvas]');
  var state = { prodotto: PRODOTTO, colore: null, qty: 1 };
  var viewerPromise = null, viewer = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Impossibile caricare ' + src)); };
      document.head.appendChild(s);
    });
  }
  function getViewer() {
    if (viewerPromise) return viewerPromise;
    viewerPromise = Promise.resolve()
      .then(function () { return window.THREE ? null : loadScript('vendor/three.min.js'); })
      .then(function () { return window.LOGO_RICAMO ? null : loadScript('js/logo-data.js'); })
      .then(function () { return window.Apron3D ? null : loadScript('js/apron3d.js'); })
      .then(function () {
        if (!window.Apron3D.supported()) throw new Error('WebGL non disponibile');
        var v = window.Apron3D.create(canvas);
        v.onViewChange = function (name) {
          $$('[data-view-btn]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-view-btn') === name)); });
        };
        if (state.colore) v.setColor(state.colore);
        if (state.manichino) v.setMannequin(true);
        return v.ready;
      })
      .then(function (v) {
        viewer = v;
        $('[data-loading]').hidden = true;
        v.setActive(!cfg.hidden);
        return v;
      })
      .catch(function (err) {
        console.warn(err);
        $('[data-loading]').hidden = true;
        $('[data-fallback]').hidden = false;
        canvas.hidden = true;
        $('.cfg-views').hidden = true;
        $('.cfg-hint').hidden = true;
        $('.cfg-mannequin').hidden = true;
      });
    return viewerPromise;
  }
  // precarica il 3D quando l'utente si avvicina al prodotto
  function warmUp() { if (!viewerPromise && 'requestIdleCallback' in window) requestIdleCallback(getViewer); }

  function renderOptions() {
    var p = state.prodotto;
    $('[data-p-name]').textContent = p.nome;
    $('[data-p-desc]').textContent = p.descrizione;
    $('[data-color-options]').innerHTML = p.colori.map(function (c) {
      return '<label class="opt-pill">' +
        '<input type="radio" name="colore" value="' + c.id + '">' +
        '<span class="opt-body"><span class="opt-dot" style="--c:' + c.hex + '"></span><span class="opt-name">' + c.nome + '</span></span></label>';
    }).join('');
  }
  function selectColor(cid, updateHash) {
    var c = colore(state.prodotto, cid);
    state.colore = c;
    $$('input[name="colore"]').forEach(function (r) { r.checked = r.value === c.id; });
    $('[data-color-name]').textContent = c.nome;
    canvas.setAttribute('aria-label', 'Modello 3D: ' + state.prodotto.nome + ', colore ' + c.nome.toLowerCase() + '. Trascina o usa le frecce per ruotarlo.');
    cfg.style.setProperty('--accent-fabric', c.hex);
    if (viewer) viewer.setColor(c);
    else if (viewerPromise) viewerPromise.then(function (v) { if (v) v.setColor(c); });
    if (updateHash && history.replaceState) history.replaceState(null, '', '#' + state.prodotto.id + '-' + c.id);
  }
  function renderTotal() {
    $('[data-qty-val]').textContent = state.qty;
    $('[data-cfg-total]').textContent = euro.format(state.prodotto.prezzo * state.qty);
  }

  if (PRODOTTO) {
    renderOptions();
    $('[data-color-options]').addEventListener('change', function (e) {
      if (e.target.name === 'colore') selectColor(e.target.value, true);
    });
    $('[data-qty-inc]').addEventListener('click', function () { state.qty = Math.min(99, state.qty + 1); renderTotal(); });
    $('[data-qty-dec]').addEventListener('click', function () { state.qty = Math.max(1, state.qty - 1); renderTotal(); });
    $$('[data-view-btn]').forEach(function (b) {
      b.addEventListener('click', function () { if (viewer) viewer.setView(b.getAttribute('data-view-btn')); });
    });
    // manichino: mostra il grembiule indossato (e lo toglie al secondo clic)
    var manBtn = $('[data-mannequin]'), manLabel = $('[data-mannequin-label]');
    manBtn.addEventListener('click', function () {
      state.manichino = !state.manichino;
      manBtn.setAttribute('aria-pressed', String(state.manichino));
      manLabel.textContent = state.manichino ? 'Clicca l’icona per vederlo senza manichino' : 'Clicca l’icona per vederlo indossato';
      if (viewer) viewer.setMannequin(state.manichino);
    });
    $('[data-add]').addEventListener('click', function () {
      var taglia = ($('input[name="taglia"]:checked') || {}).value || 'Unica';
      addToCart(state.prodotto.id, state.colore.id, taglia, state.qty);
      toast(state.qty + ' × ' + state.prodotto.nome + ' (' + state.colore.nome.toLowerCase() + ') aggiunto al carrello');
      state.qty = 1; renderTotal();
      openCart();
    });
    $('[data-close]').addEventListener('click', function () { closeConfigurator(); });
  }

  function openConfigurator(pid, cid) {
    var p = prodotto(pid) || PRODOTTO;
    if (state.prodotto !== p) { state.prodotto = p; renderOptions(); }
    selectColor(cid || (state.colore && state.colore.id) || p.coloreIniziale, false);
    renderTotal();
    if (cfg.hidden) {
      cfg.hidden = false;
      document.body.classList.add('no-scroll');
      requestAnimationFrame(function () { cfg.classList.add('is-open'); });
      setTimeout(function () { $('[data-p-name]').focus({ preventScroll: true }); }, 30);
    }
    getViewer().then(function (v) { if (v) v.setActive(true); });
    document.title = p.nome + ' · ' + SITE;
  }
  // chiudendo si torna alla pagina che c'era sotto (home o catalogo)
  function closeConfigurator() {
    location.hash = '#' + (currentView || 'catalogo');
  }
  function hideConfigurator() {
    if (cfg.hidden) return;
    cfg.classList.remove('is-open');
    cfg.hidden = true;
    if (cartEl.hidden) document.body.classList.remove('no-scroll');
    if (viewer) viewer.setActive(false);
  }

  /* ---------------- Router (hash) ---------------- */
  var TITLES = { home: SITE, 'chi-siamo': 'Chi siamo', catalogo: 'Catalogo', contatti: 'Contatti' };
  // indirizzi: #home, #chi-siamo, #catalogo, #contatti, #grembiule, #grembiule-verde
  function parseHash() {
    var h = decodeURIComponent(location.hash.replace(/^#\/?/, '')).replace(/\//g, '-');
    if (!h) return { view: 'home' };
    for (var i = 0; i < CATALOGO.length; i++) {
      var id = CATALOGO[i].id;
      if (h === id) return { prodotto: id };
      if (h.indexOf(id + '-') === 0) return { prodotto: id, colore: h.slice(id.length + 1) };
    }
    return TITLES[h] ? { view: h } : null;
  }
  function route() {
    var r = parseHash();
    if (!r) return;                               // ancore interne (es. #contenuto)
    if (r.prodotto) {
      if (!currentView) showView('catalogo', true);
      openConfigurator(r.prodotto, r.colore);
      setActiveNav('grembiule');
    } else {
      var name = r.view;
      hideConfigurator();
      showView(name, false);
      document.title = name === 'home' ? SITE : TITLES[name] + ' · ' + SITE;
      setActiveNav(name);
      if (name === 'catalogo') warmUp();
    }
  }
  var currentView = null;
  function showView(name, keepScroll) {
    if (currentView === name) return;
    $$('[data-view]').forEach(function (v) {
      if (v.classList.contains('view')) v.hidden = v.getAttribute('data-view') !== name;
    });
    if (!keepScroll && currentView !== null) {
      window.scrollTo(0, 0);
      $('#contenuto').focus({ preventScroll: true });
    }
    currentView = name;
  }
  function setActiveNav(name) {
    $$('[data-nav]').forEach(function (a) {
      if (a.getAttribute('data-nav') === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }
  window.addEventListener('hashchange', route);

  $('.skip-link').addEventListener('click', function (e) {
    e.preventDefault();
    $('#contenuto').focus();
  });
  $$('a[href^="#grembiule"]').forEach(function (a) {
    a.addEventListener('pointerenter', warmUp, { once: true });
    a.addEventListener('focus', warmUp, { once: true });
  });
  var y = $('[data-year]');
  if (y) y.textContent = new Date().getFullYear();

  renderCart();
  route();
})();
