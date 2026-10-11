/* Cookbook: a static, hash-routed recipe app. No dependencies.
   Data comes from ./data.json, built from cookbook/recipes and cookbook/meals. */
(function () {
  'use strict';

  var DATA = null;
  var byId = {};
  var mealById = {};
  var app = document.getElementById('app');
  var wakeLock = null;
  var timers = {};  // stepKey -> {end, interval}

  // ---------- storage (per-device conveniences only) ----------
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode etc. */ }
  }
  var state = {
    query: load('cb.query', ''),
    filters: load('cb.filters', {}),
    tonight: load('cb.tonight', []),
    scale: load('cb.scale', {}),      // recipeId -> servings
    checks: load('cb.checks', {}),    // key -> true
    cookStep: load('cb.cookStep', {}) // recipeId -> step index
  };
  var EMPTY_FILTERS = { effort: null, protein: null, genre: null, role: null, tags: [] };
  function normalizeFilters() {
    var f = state.filters || {};
    state.filters = {
      effort: f.effort || null, protein: f.protein || null, genre: f.genre || null, role: f.role || null,
      tags: Array.isArray(f.tags) ? f.tags.slice() : []
    };
  }
  normalizeFilters();
  function anyFilterActive() {
    var f = state.filters;
    return !!(state.query || f.effort || f.protein || f.genre || f.role || f.tags.length);
  }
  function persist() {
    save('cb.query', state.query); save('cb.filters', state.filters); save('cb.tonight', state.tonight);
    save('cb.scale', state.scale); save('cb.checks', state.checks); save('cb.cookStep', state.cookStep);
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function h(strings) {
    var out = strings[0];
    for (var i = 1; i < arguments.length; i++) out += arguments[i] + strings[i];
    return out;
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  var FRACTIONS = [[0, ''], [0.125, '⅛'], [0.25, '¼'], [0.333, '⅓'], [0.375, '⅜'], [0.5, '½'], [0.625, '⅝'], [0.667, '⅔'], [0.75, '¾'], [0.875, '⅞'], [1, '']];
  function fmtQty(n) {
    if (n == null) return '';
    if (n >= 10) return String(Math.round(n * 2) / 2).replace(/\.5$/, '½').replace(/\.0$/, '');
    var whole = Math.floor(n), frac = n - whole;
    var best = FRACTIONS[0], bestD = 1;
    for (var i = 0; i < FRACTIONS.length; i++) {
      var d = Math.abs(FRACTIONS[i][0] - frac);
      if (d < bestD) { bestD = d; best = FRACTIONS[i]; }
    }
    if (best[0] === 1) { whole += 1; best = FRACTIONS[0]; }
    if (whole === 0 && !best[1]) return (Math.round(n * 100) / 100).toString();
    return (whole ? whole : '') + (whole && best[1] ? ' ' : '') + best[1];
  }
  function mult(recipe) {
    var s = state.scale[recipe.id];
    return s ? s / recipe.serves : 1;
  }
  function servings(recipe) { return state.scale[recipe.id] || recipe.serves; }
  function amount(ing, m) {
    if (ing.qty == null) return '';
    var a = fmtQty(ing.qty * m);
    if (ing.qty_max != null) a += '–' + fmtQty(ing.qty_max * m);
    return a + (ing.unit ? ' ' + ing.unit : '');
  }
  function ingLine(ing, m) {
    var parts = [];
    var a = amount(ing, m);
    parts.push(h`<span class="qty">${esc(a)}</span>`);
    var txt = esc(ing.item) + (ing.prep ? ', ' + esc(ing.prep) : '');
    if (ing.optional) txt += ' <span class="optional">(optional)</span>';
    if (ing.note) txt += ' <span class="muted small">— ' + esc(ing.note) + '</span>';
    parts.push('<span class="txt">' + txt + '</span>');
    return parts.join(' ');
  }
  function badges(r) {
    var out = [
      h`<span class="badge effort-${esc(r.effort)}">${esc(r.effort)}</span>`,
      h`<span class="badge">${esc(r.role)}</span>`
    ];
    if (r.protein && r.protein !== 'none') out.push(h`<span class="badge">${esc(r.protein)}</span>`);
    if (r.genre && r.genre !== 'any') out.push(h`<span class="badge">${esc(r.genre)}</span>`);
    if (r.status === 'draft') out.push('<span class="badge draft">draft</span>');
    return '<div class="badges">' + out.join('') + '</div>';
  }
  function timeText(r) {
    if (!r.time) return '';
    var bits = [];
    if (r.time.active_min != null) bits.push(r.time.active_min + ' min active');
    if (r.time.total_min != null) bits.push(r.time.total_min + ' min total');
    return bits.join(' · ');
  }
  function recipeCard(r) {
    return h`<a class="card" href="#/recipe/${esc(r.id)}">
      <h3>${esc(r.title)}</h3>
      ${badges(r)}
      ${r.summary ? '<p class="summary">' + esc(r.summary) + '</p>' : ''}
      <div class="muted small">${esc(timeText(r))}</div>
    </a>`;
  }
  function mealCard(m) {
    var names = m.recipes.map(function (id) { return byId[id] ? byId[id].title : id; });
    return h`<a class="card" href="#/meal/${esc(m.id)}">
      <h3>${esc(m.title)}</h3>
      ${m.effort ? '<div class="badges"><span class="badge effort-' + esc(m.effort) + '">' + esc(m.effort) + '</span></div>' : ''}
      <p class="summary">${esc(names.join(' · '))}</p>
    </a>`;
  }
  function setNav(name) {
    var links = document.querySelectorAll('[data-nav]');
    for (var i = 0; i < links.length; i++) links[i].classList.toggle('active', links[i].getAttribute('data-nav') === name);
    var c = document.getElementById('tonight-count');
    c.textContent = state.tonight.length;
    c.hidden = state.tonight.length === 0;
  }
  function inTonight(id) { return state.tonight.indexOf(id) !== -1; }
  function toggleTonight(id) {
    var i = state.tonight.indexOf(id);
    if (i === -1) state.tonight.push(id); else state.tonight.splice(i, 1);
    persist();
  }

  // ---------- search ----------
  function matches(r, q) {
    if (!q) return true;
    var hay = [r.title, r.summary, r.genre, r.protein, r.role, r.notes].concat(r.tags || [])
      .concat(r.ingredients.map(function (i) { return i.item; })).join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).every(function (tok) { return !tok || hay.indexOf(tok) !== -1; });
  }
  function filtered() {
    var f = state.filters;
    return DATA.recipes.filter(function (r) {
      if (f.effort && r.effort !== f.effort) return false;
      if (f.protein && r.protein !== f.protein) return false;
      if (f.genre && r.genre !== f.genre) return false;
      if (f.role && r.role !== f.role) return false;
      for (var i = 0; i < f.tags.length; i++) if ((r.tags || []).indexOf(f.tags[i]) === -1) return false;
      return matches(r, state.query);
    });
  }
  function chipOn(key, v) {
    var cur = state.filters[key];
    return Array.isArray(cur) ? cur.indexOf(v) !== -1 : cur === v;
  }
  function chipRow(label, key, values, opts) {
    if (!values.length) return '';
    opts = opts || {};
    var chips = values.map(function (v) {
      return h`<button class="chip${chipOn(key, v) ? ' on' : ''}" data-filter="${esc(key)}" data-value="${esc(v)}" aria-pressed="${chipOn(key, v)}">${esc(cap(v))}</button>`;
    });
    return h`<div class="chiprow${opts.hidden ? ' collapsed' : ''}" data-row="${esc(key)}"><span class="label">${esc(label)}</span><div class="chips">${chips.join('')}</div></div>`;
  }
  function toggleChip(key, v) {
    var cur = state.filters[key];
    if (Array.isArray(cur)) {
      var i = cur.indexOf(v);
      if (i === -1) cur.push(v); else cur.splice(i, 1);
    } else {
      state.filters[key] = cur === v ? null : v;
    }
    persist();
  }

  // ---------- views ----------
  function viewHome() {
    setNav('recipes');
    var showTags = load('cb.showTags', false) || state.filters.tags.length > 0;
    app.innerHTML = h`
      <input class="search" id="q" type="search" placeholder="Search recipes, ingredients or tags" value="${esc(state.query)}" autocomplete="off" autocorrect="off" autocapitalize="none">
      <div class="filters" id="filters">
        ${chipRow('When', 'effort', DATA.facets.effort)}
        ${chipRow('Protein', 'protein', DATA.facets.protein)}
        ${chipRow('Genre', 'genre', DATA.facets.genre)}
        ${chipRow('Course', 'role', DATA.facets.role)}
        ${DATA.facets.tags && DATA.facets.tags.length ? '<button class="chip ghost" id="toggle-tags" aria-expanded="' + showTags + '">' + (showTags ? 'Hide tags' : 'Tags ▾') + '</button>' + chipRow('Tags', 'tags', DATA.facets.tags, { hidden: !showTags }) : ''}
        <div><button class="chip ghost" id="clear" ${anyFilterActive() ? '' : 'hidden'}>Clear search and filters</button></div>
      </div>
      <div class="section"><h2 id="count"></h2></div>
      <div id="results"></div>
      ${DATA.meals.length ? '<div class="section"><h2>Meals</h2><a href="#/meals">All meals</a></div><div class="grid">' + DATA.meals.slice(0, 4).map(mealCard).join('') + '</div>' : ''}
    `;
    renderResults();
    var q = document.getElementById('q');
    q.addEventListener('input', function () { state.query = q.value; persist(); syncChips(); renderResults(); });
    app.querySelectorAll('[data-filter]').forEach(function (b) {
      b.addEventListener('click', function () {
        toggleChip(b.getAttribute('data-filter'), b.getAttribute('data-value'));
        syncChips(); renderResults();
      });
    });
    document.getElementById('clear').addEventListener('click', function () {
      state.query = ''; state.filters = JSON.parse(JSON.stringify(EMPTY_FILTERS)); persist();
      document.getElementById('q').value = '';
      syncChips(); renderResults();
    });
    var tt = document.getElementById('toggle-tags');
    if (tt) tt.addEventListener('click', function () {
      var row = app.querySelector('[data-row="tags"]');
      var open = row.classList.toggle('collapsed') === false;
      save('cb.showTags', open);
      tt.textContent = open ? 'Hide tags' : 'Tags ▾';
      tt.setAttribute('aria-expanded', String(open));
    });
  }
  function syncChips() {
    app.querySelectorAll('[data-filter]').forEach(function (b) {
      var on = chipOn(b.getAttribute('data-filter'), b.getAttribute('data-value'));
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
    document.getElementById('clear').hidden = !anyFilterActive();
  }
  function renderResults() {
    var list = filtered();
    document.getElementById('count').textContent = list.length === DATA.recipes.length ? 'All recipes' : list.length + ' of ' + DATA.recipes.length + ' recipes';
    document.getElementById('results').innerHTML = list.length
      ? '<div class="grid">' + list.map(recipeCard).join('') + '</div>'
      : '<div class="empty">Nothing matches. Clear a filter or try an ingredient.</div>';
  }

  function viewMeals() {
    setNav('meals');
    app.innerHTML = h`
      <div class="hero"><h1>Meals</h1><p class="muted">Saved combinations. Open one for a merged shopping list and the cook order.</p></div>
      ${DATA.meals.length ? '<div class="grid">' + DATA.meals.map(mealCard).join('') + '</div>' : '<div class="empty">No saved meals yet.</div>'}
    `;
  }

  function checkKey(scope, id) { return scope + ':' + id; }
  function renderChecklist(scope, items) {
    // items: [{key, html}] ; grouped by items[i].group
    var out = '', lastGroup = null, open = false;
    items.forEach(function (it) {
      if (it.group !== lastGroup) {
        if (open) out += '</ul>';
        if (it.group) out += h`<div class="group-title">${esc(it.group)}</div>`;
        out += '<ul class="checklist">'; open = true; lastGroup = it.group;
      }
      var done = !!state.checks[checkKey(scope, it.key)];
      out += h`<li class="${done ? 'done' : ''}" data-check="${esc(checkKey(scope, it.key))}"><span class="box">${done ? '✓' : ''}</span><span class="txt">${it.html}</span></li>`;
    });
    if (open) out += '</ul>';
    return out;
  }
  function bindChecklist(root) {
    root.querySelectorAll('[data-check]').forEach(function (li) {
      li.addEventListener('click', function () {
        var k = li.getAttribute('data-check');
        if (state.checks[k]) delete state.checks[k]; else state.checks[k] = true;
        persist();
        li.classList.toggle('done', !!state.checks[k]);
        li.querySelector('.box').textContent = state.checks[k] ? '✓' : '';
      });
    });
  }
  function clearChecks(prefix) {
    Object.keys(state.checks).forEach(function (k) { if (k.indexOf(prefix) === 0) delete state.checks[k]; });
    persist();
  }

  function viewRecipe(id) {
    var r = byId[id];
    if (!r) return notFound('recipe', id);
    setNav('recipes');
    var m = mult(r);
    var ingItems = r.ingredients.map(function (ing) { return { key: ing.id, group: ing.group || '', html: ingLine(ing, m) }; });
    var pairs = (r.pairs_with || []).map(function (pid) {
      var p = byId[pid]; if (!p) return '';
      return h`<a class="pill" href="#/recipe/${esc(p.id)}">${esc(p.title)}<span class="role">${esc(p.role)}</span></a>`;
    }).join('');
    var mealsWith = DATA.meals.filter(function (ml) { return ml.recipes.indexOf(r.id) !== -1; });
    app.innerHTML = h`
      <div class="hero">
        <h1>${esc(r.title)}</h1>
        ${badges(r)}
        ${r.summary ? '<p>' + esc(r.summary) + '</p>' : ''}
        ${(r.tags || []).length ? '<div class="taglist">' + r.tags.map(function (t) { return '<a class="tag" href="#/" data-tag="' + esc(t) + '">#' + esc(t) + '</a>'; }).join('') + '</div>' : ''}
        <div class="meta">
          ${r.time ? '<span>' + esc(timeText(r)) + '</span>' : ''}
          ${r.source && r.source.name ? '<span>From ' + (r.source.url ? '<a href="' + esc(r.source.url) + '" rel="noopener" target="_blank">' + esc(r.source.name) + '</a>' : esc(r.source.name)) + '</span>' : ''}
        </div>
      </div>
      <div class="actions">
        <a class="btn primary" href="#/cook/${esc(r.id)}">Start cooking</a>
        <span class="scaler" aria-label="Servings">
          <button id="less" aria-label="Fewer servings">−</button>
          <span class="val">Serves ${esc(fmtQty(servings(r)))}</span>
          <button id="more" aria-label="More servings">+</button>
        </span>
        <button class="btn ${inTonight(r.id) ? 'on' : ''}" id="tonight">${inTonight(r.id) ? '✓ In tonight' : '+ Tonight'}</button>
      </div>
      ${pairs ? '<div class="panel"><h2>Goes with</h2><div class="linkrow">' + pairs + '</div></div>' : ''}
      <div class="panel">
        <div class="section" style="margin-top:0"><h2>Ingredients</h2><button class="btn quiet small" id="reset-ings">Reset</button></div>
        <div id="ings">${renderChecklist('ing:' + r.id, ingItems)}</div>
      </div>
      <div class="panel">
        <h2>Steps</h2>
        <ol class="steps-overview">
          ${r.steps.map(function (s, i) {
            var uses = (s.uses || []).map(function (uid) { var ing = r.ingredients.find(function (x) { return x.id === uid; }); return ing ? (amount(ing, m) + ' ' + ing.item).trim() : uid; });
            return '<li><a href="#/cook/' + esc(r.id) + '/' + i + '">' + (s.title ? '<strong>' + esc(s.title) + '.</strong> ' : '') + esc(s.text) + '</a>' + (uses.length ? '<div class="uses">' + esc(uses.join(' · ')) + '</div>' : '') + '</li>';
          }).join('')}
        </ol>
      </div>
      ${r.notes ? '<div class="panel"><h2>Notes</h2><p>' + esc(r.notes) + '</p></div>' : ''}
      ${mealsWith.length ? '<div class="panel"><h2>Part of</h2><div class="linkrow">' + mealsWith.map(function (ml) { return '<a class="pill" href="#/meal/' + esc(ml.id) + '">' + esc(ml.title) + '</a>'; }).join('') + '</div></div>' : ''}
    `;
    bindChecklist(app);
    app.querySelectorAll('[data-tag]').forEach(function (a) {
      a.addEventListener('click', function () {
        state.query = ''; state.filters = JSON.parse(JSON.stringify(EMPTY_FILTERS));
        state.filters.tags = [a.getAttribute('data-tag')]; persist();
      });
    });
    document.getElementById('less').addEventListener('click', function () { bump(r, -1); });
    document.getElementById('more').addEventListener('click', function () { bump(r, +1); });
    document.getElementById('tonight').addEventListener('click', function () { toggleTonight(r.id); viewRecipe(id); });
    document.getElementById('reset-ings').addEventListener('click', function () { clearChecks('ing:' + r.id); viewRecipe(id); });
  }
  function bump(r, dir) {
    var cur = servings(r);
    var step = cur >= 8 ? 2 : 1;
    var next = Math.max(1, cur + dir * step);
    if (next === r.serves) delete state.scale[r.id]; else state.scale[r.id] = next;
    persist(); route();
  }

  // ---------- cook mode ----------
  function viewCook(id, stepIdx) {
    var r = byId[id];
    if (!r) return notFound('recipe', id);
    var n = r.steps.length;
    var i = stepIdx == null ? (state.cookStep[r.id] || 0) : stepIdx;
    i = Math.max(0, Math.min(n - 1, i));
    state.cookStep[r.id] = i; persist();
    var s = r.steps[i];
    var m = mult(r);
    var uses = (s.uses || []).map(function (uid) {
      var ing = r.ingredients.find(function (x) { return x.id === uid; });
      if (!ing) return '';
      return h`<li><span class="qty">${esc(amount(ing, m))}</span><span>${esc(ing.item)}${ing.prep ? ', ' + esc(ing.prep) : ''}${ing.optional ? ' <span class="optional">(optional)</span>' : ''}${ing.note ? ' <span class="note">— ' + esc(ing.note) + '</span>' : ''}</span></li>`;
    }).join('');
    var doneKey = checkKey('step:' + r.id, i);
    var done = !!state.checks[doneKey];
    var tkey = r.id + ':' + i;
    document.body.classList.add('cooking');
    app.innerHTML = h`
      <div class="cook">
        <div class="cook-top">
          <a class="btn quiet" href="#/recipe/${esc(r.id)}">‹ Recipe</a>
          <span class="title">${esc(r.title)}${state.scale[r.id] ? ' · serves ' + esc(fmtQty(servings(r))) : ''}</span>
          <a class="btn quiet" href="#/" aria-label="Exit">✕</a>
        </div>
        <div class="progress">${r.steps.map(function (_, k) { return '<span class="' + (k < i ? 'done' : k === i ? 'cur' : '') + '"></span>'; }).join('')}</div>
        <div class="cook-card" id="card">
          <div class="stepnum">Step ${i + 1} of ${n}</div>
          ${s.title ? '<h2 class="steptitle">' + esc(s.title) + '</h2>' : ''}
          <p class="steptext">${esc(s.text)}</p>
          ${uses ? '<ul class="uses-list">' + uses + '</ul>' : ''}
          ${s.timer_min ? '<div class="timer" id="timer"><span class="clock" id="clock"></span><button class="btn" id="timer-btn"></button></div>' : ''}
        </div>
        <div class="cook-nav">
          <button class="btn" id="prev" ${i === 0 ? 'disabled' : ''}>‹ Back</button>
          ${i < n - 1 ? '<button class="btn primary" id="next">Next ›</button>' : '<a class="btn primary" id="finish" href="#/recipe/' + esc(r.id) + '">Done — back to recipe</a>'}
          <button class="btn cook-done ${done ? 'on' : ''}" id="mark">${done ? '✓ Step done' : 'Mark step done'}</button>
        </div>
        <div class="wake" id="wake"></div>
      </div>
    `;
    var go = function (k) { location.hash = '#/cook/' + r.id + '/' + k; };
    var prev = document.getElementById('prev'); if (prev) prev.addEventListener('click', function () { go(i - 1); });
    var next = document.getElementById('next'); if (next) next.addEventListener('click', function () { markDone(doneKey, true); go(i + 1); });
    var finish = document.getElementById('finish'); if (finish) finish.addEventListener('click', function () { markDone(doneKey, true); clearChecks('step:' + r.id); delete state.cookStep[r.id]; persist(); });
    document.getElementById('mark').addEventListener('click', function () { markDone(doneKey, !state.checks[doneKey]); viewCook(id, i); });
    // swipe
    var card = document.getElementById('card'), x0 = null;
    card.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    card.addEventListener('touchend', function (e) {
      if (x0 == null) return;
      var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (dx < -60 && i < n - 1) go(i + 1);
      if (dx > 60 && i > 0) go(i - 1);
    }, { passive: true });
    if (s.timer_min) bindTimer(tkey, s.timer_min);
    requestWake();
  }
  function markDone(key, val) { if (val) state.checks[key] = true; else delete state.checks[key]; persist(); }

  function bindTimer(key, minutes) {
    var clock = document.getElementById('clock'), btn = document.getElementById('timer-btn'), box = document.getElementById('timer');
    function paint() {
      var t = timers[key];
      var left = t ? Math.max(0, Math.round((t.end - Date.now()) / 1000)) : minutes * 60;
      var mm = Math.floor(left / 60), ss = left % 60;
      clock.textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
      btn.textContent = t ? (left === 0 ? 'Dismiss' : 'Cancel') : 'Start ' + minutes + ' min';
      box.classList.toggle('ringing', !!t && left === 0);
      if (t && left === 0 && !t.rang) { t.rang = true; ring(); }
    }
    btn.addEventListener('click', function () {
      if (timers[key]) { clearInterval(timers[key].interval); delete timers[key]; }
      else { timers[key] = { end: Date.now() + minutes * 60000, interval: setInterval(paint, 500) }; }
      paint();
    });
    if (timers[key]) { clearInterval(timers[key].interval); timers[key].interval = setInterval(paint, 500); }
    paint();
  }
  function ring() {
    try { if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 600]); } catch (e) { /* ignore */ }
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.35, 0.7].forEach(function (at) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
        g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.3);
        o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.32);
      });
    } catch (e) { /* no audio */ }
  }
  function requestWake() {
    var el = document.getElementById('wake');
    if (!('wakeLock' in navigator)) { if (el) el.textContent = 'Screen may dim: this browser has no wake lock. Add to Home Screen helps on iOS.'; return; }
    if (wakeLock) { if (el) el.textContent = 'Screen will stay on'; return; }
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
      if (el) el.textContent = 'Screen will stay on';
    }).catch(function () { if (el) el.textContent = 'Could not keep the screen on'; });
  }
  function releaseWake() { if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; } }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && document.body.classList.contains('cooking')) requestWake();
  });

  // ---------- meals ----------
  function shoppingList(recipes) {
    // Merge by (item, unit). Same item in different units stays separate.
    var rows = {}, order = [];
    recipes.forEach(function (r) {
      var m = mult(r);
      r.ingredients.forEach(function (ing) {
        var k = ing.item.toLowerCase() + '|' + (ing.unit || '').toLowerCase() + '|' + (ing.qty == null ? 'na' : 'n');
        if (!rows[k]) { rows[k] = { item: ing.item, unit: ing.unit, qty: null, from: [], optional: !!ing.optional }; order.push(k); }
        if (ing.qty != null) rows[k].qty = (rows[k].qty || 0) + ing.qty * m;
        if (rows[k].from.indexOf(r.title) === -1) rows[k].from.push(r.title);
        if (!ing.optional) rows[k].optional = false;
      });
    });
    return order.map(function (k) {
      var row = rows[k];
      var a = row.qty == null ? '' : fmtQty(row.qty) + (row.unit ? ' ' + row.unit : '');
      return {
        key: k, group: '',
        html: h`<span class="qty">${esc(a)}</span> <span class="txt">${esc(row.item)}${row.optional ? ' <span class="optional">(optional)</span>' : ''}${row.from.length > 1 ? ' <span class="muted small">— ' + esc(row.from.join(', ')) + '</span>' : ''}</span>`
      };
    });
  }
  function renderMealLike(opts) {
    var recipes = opts.recipes;
    var ordered = recipes.slice().sort(function (a, b) {
      var ta = a.time && a.time.total_min || 0, tb = b.time && b.time.total_min || 0; return tb - ta;
    });
    app.innerHTML = h`
      <div class="hero">
        <h1>${esc(opts.title)}</h1>
        ${opts.badges || ''}
        ${opts.notes ? '<p>' + esc(opts.notes) + '</p>' : ''}
      </div>
      ${opts.actions || ''}
      ${recipes.length ? '' : '<div class="empty">' + esc(opts.emptyText) + '</div>'}
      ${recipes.length ? '<div class="section" style="margin-top:0"><h2>On the menu</h2></div><div class="grid">' + recipes.map(function (r) {
        return recipeCard(r).replace('</a>', (opts.removable ? '<div style="margin-top:10px"><button class="btn quiet small" data-remove="' + esc(r.id) + '">Remove</button></div>' : '') + '</a>');
      }).join('') + '</div>' : ''}
      ${recipes.length > 1 ? '<div class="panel" style="margin-top:16px"><h2>Suggested order</h2><p class="muted small">Longest total time first. Start each one, then begin the next while it rests, soaks or roasts.</p><ol class="steps-overview">' + ordered.map(function (r) {
        return '<li><a href="#/cook/' + esc(r.id) + '">' + esc(r.title) + '</a>' + (r.time && r.time.total_min ? ' <span class="muted">· ' + r.time.total_min + ' min</span>' : '') + '</li>';
      }).join('') + '</ol></div>' : ''}
      ${recipes.length ? '<div class="panel"><div class="section" style="margin-top:0"><h2>Shopping list</h2><button class="btn quiet small" id="reset-shop">Reset</button></div>' + renderChecklist('shop:' + opts.scope, shoppingList(recipes)) + '</div>' : ''}
    `;
    bindChecklist(app);
    var reset = document.getElementById('reset-shop');
    if (reset) reset.addEventListener('click', function () { clearChecks('shop:' + opts.scope); route(); });
    app.querySelectorAll('[data-remove]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleTonight(b.getAttribute('data-remove')); route(); });
    });
  }
  function viewMeal(id) {
    var ml = mealById[id];
    if (!ml) return notFound('meal', id);
    setNav('meals');
    var recipes = ml.recipes.map(function (rid) { return byId[rid]; }).filter(Boolean);
    renderMealLike({
      scope: ml.id, title: ml.title, notes: ml.notes, recipes: recipes,
      badges: ml.effort ? '<div class="badges"><span class="badge effort-' + esc(ml.effort) + '">' + esc(ml.effort) + '</span></div>' : '',
      actions: '<div class="actions"><button class="btn" id="load-tonight">Load into Tonight</button></div>',
      emptyText: 'This meal has no recipes.'
    });
    document.getElementById('load-tonight').addEventListener('click', function () {
      state.tonight = ml.recipes.slice(); persist(); location.hash = '#/tonight';
    });
  }
  function viewTonight() {
    setNav('tonight');
    var recipes = state.tonight.map(function (rid) { return byId[rid]; }).filter(Boolean);
    renderMealLike({
      scope: 'tonight', title: 'Tonight', recipes: recipes, removable: true,
      notes: recipes.length ? '' : '',
      actions: recipes.length ? '<div class="actions"><button class="btn quiet" id="clear-tonight">Clear</button></div>' : '',
      emptyText: 'Nothing picked yet. Open a recipe and tap “+ Tonight”, or load a saved meal.'
    });
    var c = document.getElementById('clear-tonight');
    if (c) c.addEventListener('click', function () { state.tonight = []; clearChecks('shop:tonight'); persist(); viewTonight(); });
  }

  function notFound(kind, id) {
    setNav('recipes');
    app.innerHTML = h`<div class="empty">No ${esc(kind)} called “${esc(id)}”. <a href="#/">Back to recipes</a></div>`;
  }

  // ---------- routing ----------
  function route() {
    if (!DATA) return;
    var parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    var wasCooking = document.body.classList.contains('cooking');
    document.body.classList.remove('cooking');
    if (parts[0] === 'cook' && parts[1]) {
      viewCook(parts[1], parts[2] != null ? parseInt(parts[2], 10) : null);
    } else {
      if (wasCooking) releaseWake();
      if (parts[0] === 'recipe' && parts[1]) viewRecipe(parts[1]);
      else if (parts[0] === 'meal' && parts[1]) viewMeal(parts[1]);
      else if (parts[0] === 'meals') viewMeals();
      else if (parts[0] === 'tonight') viewTonight();
      else viewHome();
      window.scrollTo(0, 0);
    }
  }
  window.addEventListener('hashchange', route);

  fetch('./data.json', { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function (d) {
    DATA = d;
    d.recipes.forEach(function (r) { byId[r.id] = r; });
    d.meals.forEach(function (m) { mealById[m.id] = m; });
    route();
  }).catch(function (e) {
    app.innerHTML = '<div class="empty">Could not load the cookbook data (' + esc(e.message) + '). If you opened index.html from disk, serve the built dist/ folder over HTTP instead.</div>';
  });
})();
