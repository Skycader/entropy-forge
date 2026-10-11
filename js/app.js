/* UI wiring: stats, hash display, generator, log */
(function (EF) {
  "use strict";

  const { estimateBits, bitsToYears, formatYears, MAX_BITS } = EF.entropy;
  const { packPool, sha256, md5, bytesToHex } = EF.hash;
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
  const md5ValEl = $('md5Val');
  const sha256ValEl = $('sha256Val');
  const seedValEl = $('seedVal');
  const genBtn = $('genBtn');
  const resetBtn = $('resetBtn');

  const pad = EF.createPad($('padShell'), $('pad'), pts => {
    padHint.style.opacity = '0';
    resetBtn.disabled = false;
    ptCountEl.textContent = pts.length + ' pts';
    updateStats();
    scheduleHashUpdate();
  });

  // bumped on every reset so in-flight async work from the old pool is discarded
  let poolEpoch = 0;
  let rngState = null;   // sfc32 generator function, seeded from current pool
  let seededKey = null;  // `${epoch}:${pointCount}` of the pool rngState was seeded from

  resetBtn.addEventListener('click', () => {
    pad.reset();
    poolEpoch++;
    rngState = null;
    seededKey = null;
    clearTimeout(hashUpdateTimer);
    ptCountEl.textContent = '0 pts';
    padHint.style.opacity = '1';
    resetBtn.disabled = true;
    showHashes(null);
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

    // require a small minimum before allowing generation
    genBtn.disabled = bits < 4;
  }

  /* ---------------- Hash display ---------------- */

  // values are ellipsized in the UI, so the full hex also goes into the tooltip
  function showHashes(h){
    for(const [el, v] of [[md5ValEl, h && h.md5], [sha256ValEl, h && h.sha256], [seedValEl, h && h.seed]]){
      el.textContent = v || '—';
      el.title = v ? v + ' — клик, чтобы скопировать' : '';
    }
  }

  /* ---------------- Compact (phone) layout ---------------- */

  // must match the phone media query in styles.css
  const compact = matchMedia('(max-width: 879px) and (orientation: portrait), (max-width: 639px), (max-height: 500px) and (orientation: landscape)');
  const logPanel = $('logPanel');

  // secondary panels start collapsed where height is scarce, leaving room for the pad
  if(compact.matches || matchMedia('(max-height: 560px)').matches) $('hashPanel').open = false;
  if(compact.matches) logPanel.classList.add('collapsed');

  $('logHead').addEventListener('click', e => {
    if(!compact.matches || e.target.closest('button')) return;
    logPanel.classList.toggle('collapsed');
  });

  let hashUpdateTimer = null;
  function scheduleHashUpdate(){
    clearTimeout(hashUpdateTimer);
    hashUpdateTimer = setTimeout(refreshHashDisplay, 120);
  }

  let hashRequest = 0;
  async function refreshHashDisplay(){
    const req = ++hashRequest;
    const points = pad.points;
    if(points.length < 3){ showHashes(null); return; }
    const buf = packPool(points);
    const md5Hex = bytesToHex(md5(buf));
    const sha256Bytes = await sha256(buf);
    if(req !== hashRequest || pad.points !== points) return; // superseded or pool reset meanwhile
    showHashes({
      md5: md5Hex,
      sha256: bytesToHex(sha256Bytes),
      seed: bytesToHex(sha256Bytes.slice(0,16)), // the 16 bytes actually fed to sfc32
    });
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

  /* ---------------- Seeding ---------------- */

  async function ensureSeeded(){
    const epoch = poolEpoch;
    const key = epoch + ':' + pad.points.length;
    if(rngState && seededKey === key) return rngState;
    const rng = makeRng(await sha256(packPool(pad.points)));
    // keep the generator only if the pool wasn't reset while hashing
    if(epoch === poolEpoch){
      rngState = rng;
      seededKey = key;
    }
    return rng;
  }

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

  function pushLog(typeTag, cls, value, bits){
    if(logEmpty){
      logList.innerHTML = '';
      logEmpty = false;
    }
    const row = document.createElement('div');
    row.className = 'log-row';
    const time = new Date().toLocaleTimeString();
    row.innerHTML =
      '<span class="tag ' + cls + '">' + typeTag + '</span>' +
      '<span class="val"></span>' +
      '<span class="meta">' + bits.toFixed(1) + 'b · ' + time + '</span>';
    row.querySelector('.val').textContent = value;
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
    genBtn.disabled = true;
    const bitsAtGen = estimateBits(pad.points);
    try {
      const rng = await ensureSeeded();
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

      pushLog(tag, cls, value, bitsAtGen);
    } finally {
      updateStats();
    }
  });

  updateStats();
})(window.EF = window.EF || {});
