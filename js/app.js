/* UI wiring: stats, seed inputs (md5 + salt), generator, log */
(function (EF) {
  "use strict";

  const { estimateBits, bitsToYears, formatYears, MAX_BITS } = EF.entropy;
  const { packPool, sha256Text, md5, bytesToHex } = EF.hash;
  const { makeRng, randDouble, randInt, randomString } = EF.prng;

  const $ = id => document.getElementById(id);

  const padHint = $('padHint');
  const ptCountEl = $('ptCount');
  const bitsValueEl = $('bitsValue');
  const bitsSubEl = $('bitsSub');
  const yearsValueEl = $('yearsValue');
  const yearsSubEl = $('yearsSub');
  const qualityFillEl = $('qualityFill');
  const qualityLabelEl = $('qualityLabel');
  const seedSrcValEl = $('seedSrcVal');
  const sha256ValEl = $('sha256Val');
  const seedValEl = $('seedVal');
  const genBtn = $('genBtn');
  const resetBtn = $('resetBtn');

  const md5Input = $('md5Input');
  const md5Sync = $('md5Sync');
  const saltInput = $('saltInput');
  const saltSync = $('saltSync');
  const saltRate = $('saltRate');
  const saltRateLabel = $('saltRateLabel');

  /* ghost scribble hint: runs only while the pad is empty; static (fully drawn) for reduced motion */
  const ghost = $('ghost');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function showGhost(){
    padHint.style.opacity = '1';
    if(reducedMotion.matches){ ghost.pauseAnimations(); ghost.setCurrentTime(2.3); }
    else { ghost.setCurrentTime(0); ghost.unpauseAnimations(); }
  }
  function hideGhost(){
    padHint.style.opacity = '0';
    ghost.pauseAnimations(); // no point animating under the user's drawing
  }

  const pad = EF.createPad($('padShell'), $('pad'), pts => {
    hideGhost();
    resetBtn.disabled = false;
    ptCountEl.textContent = pts.length + ' pts';
    updateStats();
    scheduleDrawMd5();
  });

  resetBtn.addEventListener('click', () => {
    pad.reset();
    ptCountEl.textContent = '0 pts';
    showGhost();
    resetBtn.disabled = true;
    clearTimeout(drawMd5Timer);
    refreshDrawMd5();
    updateStats();
  });

  /* ---------------- Stats ---------------- */

  function updateStats(){
    const points = pad.points;
    const bits = estimateBits(points);
    bitsValueEl.textContent = bits.toFixed(1) + ' бит';

    bitsSubEl.textContent = 'максимум ' + MAX_BITS;

    if(points.length < 3){
      yearsValueEl.textContent = '—';
      yearsSubEl.innerHTML = '&nbsp;';
      qualityFillEl.style.width = '0%';
      qualityLabelEl.textContent = 'пул пуст — начни рисовать';
      qualityLabelEl.style.color = 'var(--fg-dim)';
    } else {
      const years = formatYears(bitsToYears(bits));
      yearsValueEl.textContent = years.value;
      yearsSubEl.textContent = years.note || ' ';
      yearsValueEl.title = years.note ? years.value + ' — ' + years.note : years.value;

      const pct = Math.min(100, (bits/MAX_BITS)*100);
      qualityFillEl.style.width = pct + '%';

      let label, color;
      if(bits < 20){ label='слабо — почти case для взлома за кофе-брейк'; color='var(--amber)'; }
      else if(bits < 48){ label='средне — сгодится для игры в кости'; color='var(--cyan)'; }
      else if(bits < 90){ label='неплохо — уже не тривиально'; color='var(--cyan)'; }
      else { label='параноидально — вселенная не успеет остыть'; color='var(--magenta)'; }
      qualityLabelEl.textContent = label;
      qualityLabelEl.style.color = color;
    }
  }

  /* ---------------- md5 of the drawing (synced into the md5 field) ---------------- */

  let drawMd5 = '';      // md5 of the current pool, '' while the pool is too small
  let drawMd5Timer = null;

  function scheduleDrawMd5(){
    clearTimeout(drawMd5Timer);
    drawMd5Timer = setTimeout(refreshDrawMd5, 60);
  }

  function refreshDrawMd5(){
    const points = pad.points;
    drawMd5 = points.length < 3 ? '' : bytesToHex(md5(packPool(points)));
    if(md5Sync.checked && md5Input.value !== drawMd5){
      md5Input.value = drawMd5;
      onSeedInputsChanged();
    }
  }

  // typing into a synced field takes it over manually
  md5Input.addEventListener('input', () => {
    md5Sync.checked = false;
    onSeedInputsChanged();
  });
  md5Sync.addEventListener('change', () => {
    if(md5Sync.checked){
      md5Input.value = drawMd5;
      onSeedInputsChanged();
    }
  });

  /* ---------------- salt: live unix timestamp (ms), snapped to the chosen step ---------------- */

  // slider 0..max maps logarithmically onto a 1 ms … 60 s step, so it feels smooth across the whole range
  const MAX_STEP_MS = 60000;
  function stepMs(){
    return Math.max(1, Math.round(Math.pow(MAX_STEP_MS, saltRate.value / saltRate.max)));
  }
  function formatStep(ms){
    if(ms < 1000) return ms + ' мс';
    if(ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' с';
    return '1 мин';
  }

  let tickRaf = 0, tickTimer = 0;

  function stopTicker(){
    cancelAnimationFrame(tickRaf);
    clearTimeout(tickTimer);
    tickRaf = tickTimer = 0;
  }

  function tick(){
    const step = stepMs();
    const now = Date.now();
    const ts = String(Math.floor(now / step) * step);
    if(saltInput.value !== ts){
      saltInput.value = ts;
      onSeedInputsChanged();
    }
    // sub-frame steps can't be shown faster than the screen refreshes anyway
    if(step < 16) tickRaf = requestAnimationFrame(tick);
    else tickTimer = setTimeout(tick, step - (now % step) + 1);
  }

  function startTicker(){
    stopTicker();
    tick();
  }

  function updateRateLabel(){
    const p = saltRate.value / saltRate.max;
    saltRateLabel.textContent = formatStep(stepMs());
    saltRateLabel.parentElement.style.setProperty('--p', p);
    saltRateLabel.classList.toggle('flip', p > 0.6); // keep the label inside the field near the right end
  }

  saltInput.addEventListener('input', () => {
    saltSync.checked = false;
    stopTicker();
    onSeedInputsChanged();
  });
  saltSync.addEventListener('change', () => {
    if(saltSync.checked) startTicker();
    else stopTicker();
  });
  // the rate only means something for the live timestamp, so touching it turns the sync on
  saltRate.addEventListener('input', () => {
    updateRateLabel();
    saltSync.checked = true;
    startTicker();
  });

  // the step label shows only while the pointer is on the diamond thumb, while dragging, or on keyboard focus
  const rateBox = saltRate.parentElement;
  let rateDragging = false;
  function nearThumb(e){
    const r = saltRate.getBoundingClientRect();
    const thumbX = r.left + 5 + (saltRate.value / saltRate.max) * (r.width - 10);
    return Math.abs(e.clientX - thumbX) <= 10;
  }
  function setLabelVisible(on){ rateBox.classList.toggle('show-label', on); }
  saltRate.addEventListener('pointermove', e => setLabelVisible(rateDragging || nearThumb(e)));
  saltRate.addEventListener('pointerleave', () => { if(!rateDragging) setLabelVisible(false); });
  saltRate.addEventListener('pointerdown', () => { rateDragging = true; setLabelVisible(true); });
  window.addEventListener('pointerup', () => {
    if(!rateDragging) return;
    rateDragging = false;
    setLabelVisible(false); // the next pointermove brings it back if the pointer is still on the thumb
  });
  saltRate.addEventListener('focus', () => { if(saltRate.matches(':focus-visible')) setLabelVisible(true); });
  saltRate.addEventListener('blur', () => setLabelVisible(false));

  /* ---------------- Seed preview (hash panel) ---------------- */

  const seedSource = () => md5Input.value + ':' + saltInput.value;

  function updateGenState(){
    genBtn.disabled = md5Input.value.trim() === '';
  }

  let seedRequest = 0;
  async function onSeedInputsChanged(){
    updateGenState();
    const req = ++seedRequest;
    if(md5Input.value.trim() === ''){ showSeed(null); return; }
    const src = seedSource();
    const digest = await sha256Text(src);
    if(req !== seedRequest) return; // a newer input already superseded this one
    showSeed({ src, sha256: bytesToHex(digest), seed: bytesToHex(digest.slice(0,16)) });
  }

  // values are ellipsized in the UI, so the full text also goes into the tooltip
  function showSeed(h){
    for(const [el, v] of [[seedSrcValEl, h && h.src], [sha256ValEl, h && h.sha256], [seedValEl, h && h.seed]]){
      el.textContent = v || '—';
      el.title = v ? v + ' — клик, чтобы скопировать' : '';
    }
  }

  document.querySelectorAll('.hash-val').forEach(el => {
    el.addEventListener('click', () => {
      const text = el.textContent;
      if(!text || text === '—') return;
      navigator.clipboard.writeText(text).then(() => {
        el.classList.add('copied');
        setTimeout(() => el.classList.remove('copied'), 700);
      }).catch(()=>{});
    });
  });

  /* ---------------- Compact (phone) layout ---------------- */

  // must match the phone media query in styles.css
  const compact = matchMedia('(max-width: 879px) and (orientation: portrait), (max-width: 639px), (max-height: 500px) and (orientation: landscape)');
  const logPanel = $('logPanel');

  // secondary panels start collapsed where height is scarce, leaving room for the pad
  if(compact.matches || matchMedia('(max-height: 700px)').matches) $('hashPanel').open = false;
  if(compact.matches) logPanel.classList.add('collapsed');

  $('logHead').addEventListener('click', e => {
    if(!compact.matches || e.target.closest('button')) return;
    logPanel.classList.toggle('collapsed');
  });

  /* ---------------- Type tabs ---------------- */

  let currentType = 'int';
  const typeBtns = document.querySelectorAll('.typeBtn');
  const paramsInt = $('paramsInt');
  const paramsDouble = $('paramsDouble');
  const paramsString = $('paramsString');

  typeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      typeBtns.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      currentType = btn.dataset.type;
      paramsInt.style.display = currentType === 'int' ? 'flex' : 'none';
      paramsDouble.style.display = currentType === 'double' ? 'flex' : 'none';
      paramsString.style.display = currentType === 'string' ? 'flex' : 'none';
    });
  });

  /* ---------------- Generate + log ---------------- */

  const resultPlaceholder = $('resultPlaceholder');
  const resultValue = $('resultValue');
  const copyBtn = $('copyBtn');
  const logList = $('logList');
  const clearLogBtn = $('clearLogBtn');

  let logEmpty = true;

  function pushLog(typeTag, cls, value, meta, src){
    if(logEmpty){
      logList.innerHTML = '';
      logEmpty = false;
    }
    const row = document.createElement('div');
    row.className = 'log-row';
    row.title = 'вход: ' + src; // enough to reproduce this value
    const time = new Date().toLocaleTimeString();
    row.innerHTML =
      '<span class="tag ' + cls + '">' + typeTag + '</span>' +
      '<span class="val"></span>' +
      '<span class="meta"></span>';
    row.querySelector('.val').textContent = value;
    row.querySelector('.meta').textContent = meta + ' · ' + time;
    logList.insertBefore(row, logList.firstChild);
  }

  clearLogBtn.addEventListener('click', () => {
    logList.innerHTML = '<div class="log-empty">записей пока нет</div>';
    logEmpty = true;
  });

  copyBtn.addEventListener('click', () => {
    const text = resultValue.textContent;
    if(!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const old = copyBtn.textContent;
      copyBtn.textContent = 'copied';
      setTimeout(()=>{ copyBtn.textContent = old; }, 1000);
    }).catch(()=>{});
  });

  // Number() instead of parseInt so "1e10" isn't read as 1
  function readNumber(id, fallback){
    const v = Number($(id).value);
    return Number.isFinite(v) ? v : fallback;
  }

  genBtn.addEventListener('click', async () => {
    // snapshot exactly what the fields show at the moment of the click
    const src = seedSource();
    const fromDrawing = md5Input.value === drawMd5;
    const meta = fromDrawing ? estimateBits(pad.points).toFixed(1) + 'b' : 'ручной md5';
    genBtn.disabled = true;
    try {
      // a fresh generator per click: the output depends on md5 + salt only
      const rng = makeRng(await sha256Text(src));
      let value, tag, cls;

      if(currentType === 'int'){
        value = String(randInt(rng, readNumber('paramA', 0), readNumber('paramB', 0)));
        tag = 'INT'; cls = 'int';
      } else if(currentType === 'double'){
        value = randDouble(rng).toFixed(10);
        tag = 'DBL'; cls = 'dbl';
      } else {
        const len = Math.max(1, Math.min(512, Math.trunc(readNumber('paramLen', 16)) || 16));
        value = randomString(rng, len);
        tag = 'STR'; cls = 'str';
      }

      resultPlaceholder.style.display = 'none';
      resultValue.style.display = 'inline';
      resultValue.textContent = value;
      copyBtn.style.display = 'inline-block';

      pushLog(tag, cls, value, meta, src);
    } finally {
      updateGenState();
    }
  });

  // Enter in any generator field = generate
  document.querySelector('.gen-panel').addEventListener('keydown', e => {
    if(e.key === 'Enter' && e.target.matches('input') && !genBtn.disabled) genBtn.click();
  });

  updateStats();
  showGhost();
  updateRateLabel();
  startTicker();
  onSeedInputsChanged();
})(window.EF = window.EF || {});
