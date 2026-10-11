/* UI wiring: entropy sources (drawing / text), stats, seed inputs (algorithm + fingerprint + salt),
   generator, log.

   Pipeline, with a user-chosen hash H (md5 | sha256) and generator G (lcg | sfc32):
     fingerprint = H(source)                        — editable field, synced to the drawing / text
     seed        = first N bytes of H(fingerprint:salt), N = G's state size (lcg 8, sfc32 16)
     numbers     = G(seed) */
(function (EF) {
  "use strict";

  const { estimateBits, estimateTextBits, bitsToYears, formatYears } = EF.entropy;
  const { packPool, digest, digestText, bytesToHex } = EF.hash;
  const { makeRng, makeLcg, LCG_A, LCG_C, randDouble, randInt, randomString } = EF.prng;

  const $ = id => document.getElementById(id);

  const padHint = $('padHint');
  const ptCountEl = $('ptCount');
  const bitsValueEl = $('bitsValue');
  const bitsSubEl = $('bitsSub');
  const yearsValueEl = $('yearsValue');
  const yearsSubEl = $('yearsSub');
  const qualityFillEl = $('qualityFill');
  const qualityLabelEl = $('qualityLabel');
  const algValEl = { djb2: $('djb2Val'), md5: $('md5Val'), sha256: $('sha256Val') };
  const genValEl = { lcg: $('lcgVal'), sfc32: $('sfc32Val') };
  const genBtn = $('genBtn');
  const resetBtn = $('resetBtn');

  const fpInput = $('fpInput');
  const fpSync = $('fpSync');
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

  const pad = EF.createPad($('padShell'), $('pad'), () => {
    hideGhost();
    resetBtn.disabled = false;
    onSourceChanged();
  });

  resetBtn.addEventListener('click', () => {
    pad.reset();
    showGhost();
    resetBtn.disabled = true;
    onSourceChanged(true);
  });

  /* ---------------- text source ---------------- */

  const textShell = $('textShell');
  const textInput = $('textInput');
  const textClearBtn = $('textClearBtn');
  const textGhost = $('textGhost');
  const textGhostChars = $('textGhostChars');

  // ghost typist: types a few random characters with human-ish jitter, erases them, repeats
  const GHOST_CHARSET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789#$%&*@?!';
  let ghostTypeTimer = 0;
  function ghostTypeStep(target, typing){
    const len = textGhostChars.textContent.length;
    if(typing && len < target){
      textGhostChars.textContent += GHOST_CHARSET[Math.floor(Math.random() * GHOST_CHARSET.length)];
      ghostTypeTimer = setTimeout(() => ghostTypeStep(target, true), 70 + Math.random() * 140);
    } else if(typing){
      ghostTypeTimer = setTimeout(() => ghostTypeStep(target, false), 1100); // hold the finished "word"
    } else if(len > 0){
      textGhostChars.textContent = textGhostChars.textContent.slice(0, -1);
      ghostTypeTimer = setTimeout(() => ghostTypeStep(target, false), 35);
    } else {
      ghostTypeTimer = setTimeout(() => ghostTypeStep(6 + Math.floor(Math.random() * 6), true), 500);
    }
  }
  function updateTextGhost(){
    // visible only while the field is empty, unfocused and its tab is shown
    const visible = activeSrc === 'text' && textInput.value === '' && document.activeElement !== textInput;
    textGhost.classList.toggle('off', !visible);
    clearTimeout(ghostTypeTimer);
    ghostTypeTimer = 0;
    textGhostChars.textContent = '';
    if(visible && !reducedMotion.matches) ghostTypeStep(8, true); // reduced motion: just the caret
  }

  // line-number gutter: numbers every visual row (wrapped rows too — they line up with the ruled lines)
  // and follows the textarea's scroll
  const textGutter = $('textGutter');
  function updateGutter(){
    const row = parseFloat(getComputedStyle(textInput).lineHeight) || 24;
    const rows = Math.max(1, Math.ceil(textInput.scrollHeight / row));
    if(textGutter.dataset.rows !== String(rows)){
      textGutter.dataset.rows = rows;
      textGutter.textContent = Array.from({ length: rows }, (_, i) => i + 1).join('\n');
    }
    textGutter.scrollTop = textInput.scrollTop;
  }
  textInput.addEventListener('scroll', () => { textGutter.scrollTop = textInput.scrollTop; });
  new ResizeObserver(updateGutter).observe(textInput);

  textInput.addEventListener('input', () => {
    textClearBtn.disabled = textInput.value === '';
    updateTextGhost();
    updateGutter();
    onSourceChanged();
  });
  textInput.addEventListener('focus', updateTextGhost);
  textInput.addEventListener('blur', updateTextGhost);
  textClearBtn.addEventListener('click', () => {
    textInput.value = '';
    textClearBtn.disabled = true;
    updateTextGhost();
    updateGutter();
    onSourceChanged(true);
  });

  /* ---------------- source tabs ---------------- */

  let activeSrc = 'draw';
  const srcTabs = document.querySelectorAll('.src-tab');

  // no auto-focus on the text field: the ghost typist shows until the user clicks in (and phones don't pop the keyboard)
  function setSource(src){
    activeSrc = src;
    srcTabs.forEach(t => {
      const on = t.dataset.src === src;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
    });
    $('padShell').hidden = src !== 'draw';
    textShell.hidden = src !== 'text';
    if(src === 'draw'){ if(pad.points.length === 0) showGhost(); }
    else ghost.pauseAnimations(); // the drawing ghost is off-screen
    updateTextGhost();
    onSourceChanged(true);
  }

  srcTabs.forEach(t => {
    t.addEventListener('click', () => setSource(t.dataset.src));
    // arrow keys move between tabs (WAI-ARIA tabs pattern)
    t.addEventListener('keydown', e => {
      if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const next = activeSrc === 'draw' ? 'text' : 'draw';
      setSource(next);
      document.querySelector('.src-tab[data-src="' + next + '"]').focus();
      e.preventDefault();
    });
  });

  /* ---------------- hash algorithm (radio) ---------------- */

  // reference DJB2 source shown in its tooltip (same algorithm as djb2() in js/hash.js);
  // the expected outputs in the comments are the real ones — verified against that function
  const DJB2_SOURCE =
`function djb2(str) {
    let hash = 5381; // "Магическое" стартовое число (чистый хаос)
    for (let i = 0; i < str.length; i++) {
        // Смешиваем текущий хэш с кодом буквы: hash = hash * 33 + charCode
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash |= 0; // Превращаем в 32-битное целое число (чтобы не росло до бесконечности)
    }
    return hash >>> 0; // Делаем число строго положительным [0, 4294967295]
}

// Тест для твоей игры:
console.log(djb2("олень"));  // ${EF.hash.djb2('олень')}
console.log(djb2("погода")); // ${EF.hash.djb2('погода')}

// Сравниваем в одну строчку:
if (djb2("олень") > djb2("погода")) {
    console.log("Олень победил!");
}`;

  // minimal JS highlighter for that listing: one left-to-right pass, so comments win over the quotes inside them
  function highlightJs(code){
    const esc = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc.replace(/(\/\/.*$)|("(?:[^"\\\n]|\\.)*")|\b(function|let|for|return|if)\b|\b(\d+)\b/gm,
      (m, com, str, kw, num) =>
        com ? '<span class="com">' + com + '</span>' :
        str ? '<span class="str">' + str + '</span>' :
        kw  ? '<span class="kw">' + kw + '</span>' :
              '<span class="num">' + num + '</span>');
  }

  const ALG_INFO = {
    djb2: {
      name: 'DJB2', bits: 32,
      tipHtml:
        '<p>DJB2 — простейшая хеш-функция Дэна Бернштейна: каждый символ умножает хеш на 33 и прибавляется. ' +
        'Результат — одно 32-битное число (его и видно в поле). Очень быстрая, но не криптографическая: ' +
        'коллизии подбираются легко, а энтропия ограничена 32 битами. Рисунок хешируется по байтам. ' +
        'Через двоеточие приписана соль.</p>' +
        '<pre class="code">' + highlightJs(DJB2_SOURCE) + '</pre>',
    },
    md5: {
      name: 'MD5', bits: 128,
      tip: 'MD5 — хеш-функция: превращает рисунок или текст любого размера в отпечаток из 32 hex-символов (128 бит). ' +
           'Изменишь одну точку или букву — отпечаток поменяется целиком. Криптографически сломан (можно подобрать два ' +
           'разных входа с одинаковым хешем), но как отпечаток для игрушки годится. Через двоеточие приписана соль.',
    },
    sha256: {
      name: 'SHA256', bits: 256,
      tip: 'SHA-256 — хеш-функция: превращает рисунок или текст любого размера в отпечаток из 64 hex-символов (256 бит). ' +
           'Изменишь одну точку или букву — отпечаток поменяется целиком. Современный стандарт, коллизий не найдено. ' +
           'Через двоеточие приписана соль.',
    },
  };
  let alg = document.querySelector('input[name=alg]:checked').value;

  $('djb2Label').dataset.tipHtml = ALG_INFO.djb2.tipHtml;
  $('djb2Label').dataset.tipWide = '';
  $('md5Label').dataset.tip = ALG_INFO.md5.tip;
  $('sha256Label').dataset.tip = ALG_INFO.sha256.tip;

  // where a generator's seed comes from, as shown in its tooltip
  const seedOrigin = n => alg === 'djb2'
    ? 'первые ' + n + ' байт djb2(отпечаток:соль:0) ‖ djb2(…:1) ‖ … (djb2 даёт по 4 байта, поэтому seed набирается счётчиком)'
    : 'первые ' + n + ' байт ' + alg + '(отпечаток:соль)';

  /* ---------------- generator (radio) ---------------- */

  // seedBytes = state size: the first that many bytes of H(fingerprint:salt) become the starting state
  const GEN_INFO = {
    lcg:   { bits: 64,  seedBytes: 8,  make: makeLcg },
    sfc32: { bits: 128, seedBytes: 16, make: makeRng },
  };
  let gen = document.querySelector('input[name=gen]:checked').value;

  // tooltips mention the chosen hash, so they're rebuilt when it changes. LCG gets its formula
  // (data-tip-html → rendered as markup by tooltip.js); SFC32 only a description — dig in if curious
  function updateAlgLabels(){
    $('fpFieldLabel').textContent = alg;
    $('lcgLabel').dataset.tipHtml =
      '<p>LCG — линейный конгруэнтный генератор, один из старейших (Лемер, 1949). ' +
      'Каждое следующее число получается из предыдущего одной формулой:</p>' +
      '<div class="formula">' +
        'Xₙ₊₁ = (a · Xₙ + c) mod 2⁶⁴\n' +
        '<span class="dim">a  =</span> ' + LCG_A + '\n' +
        '<span class="dim">c  =</span> ' + LCG_C + '\n' +
        '<span class="dim">X₀ =</span> первые 8 байт ' + (alg === 'djb2' ? 'djb2(…:0) ‖ djb2(…:1)' : alg + '(отпечаток:соль)') + '\n' +
        '<span class="dim">→</span>  число = старшие 32 бита Xₙ' +
      '</div>' +
      '<p>Константы — Кнута (MMIX). Младшие биты у LCG слабые, поэтому берутся старшие. ' +
      'Состояние всего 64 бита — энтропия ограничена 64 битами, а по нескольким выходам ' +
      'состояние можно восстановить. Быстрый, простой и предсказуемый.</p>';
    $('sfc32Label').dataset.tip =
      'SFC32 (Small Fast Counter) — быстрый генератор псевдослучайных чисел из набора тестов PractRand ' +
      '(Chris Doty-Humphrey). Состояние — 128 бит: четыре 32-битных числа, это ' + seedOrigin(16) +
      (alg === 'md5' ? ', то есть весь md5' : '') + '. Проходит строгие ' +
      'статистические тесты, которые LCG валит. Как он устроен внутри — найди «sfc32 PractRand», если интересно.';
  }

  document.querySelectorAll('input[name=alg]').forEach(r => r.addEventListener('change', () => {
    alg = r.value;
    updateAlgLabels();
    onSourceChanged(true);  // re-hash the source → new fingerprint (if synced)
    onSeedInputsChanged();  // and a new seed even if the fingerprint was typed by hand
  }));

  document.querySelectorAll('input[name=gen]').forEach(r => r.addEventListener('change', () => {
    gen = r.value;
    updateStats();          // the entropy cap depends on the generator's state size
    onSeedInputsChanged();
  }));

  /* ---------------- active source: bits, emptiness, fingerprint ---------------- */

  // entropy is capped by the narrowest step: the fingerprint (hash size) and the generator's state
  const maxBits = () => Math.min(ALG_INFO[alg].bits, GEN_INFO[gen].bits);
  function sourceBits(){
    const raw = activeSrc === 'draw' ? estimateBits(pad.points) : estimateTextBits(textInput.value);
    return Math.min(raw, maxBits());
  }
  function sourceEmpty(){
    return activeSrc === 'draw' ? pad.points.length < 3 : textInput.value === '';
  }
  // text is hashed exactly as typed (UTF-8 bytes), so it matches any external md5 / sha256 tool
  // djb2 is a single 32-bit number, shown in decimal like console.log(djb2(...)); the others in hex
  function computeFingerprint(h){
    if(sourceEmpty()) return '';
    const bytes = activeSrc === 'draw' ? digest(h, packPool(pad.points)) : digestText(h, textInput.value);
    return h === 'djb2' ? String(new DataView(bytes.buffer).getUint32(0)) : bytesToHex(bytes);
  }

  function updateCount(){
    ptCountEl.textContent = activeSrc === 'draw'
      ? pad.points.length + ' pts'
      : Array.from(textInput.value).length + ' симв';
  }

  // immediate = recompute the fingerprint now (tab switch, clear, algorithm) instead of debouncing it
  function onSourceChanged(immediate){
    updateCount();
    updateStats();
    if(immediate){ clearTimeout(fpTimer); refreshFingerprint(); }
    else scheduleFingerprint();
  }

  /* ---------------- Stats ---------------- */

  // strength label under the bar, by estimated bits (upper bounds are exclusive)
  const STRENGTH_LEVELS = [
    { below: 40,       label: 'Слабая — подбирается за секунды',                                    color: 'var(--amber)' },
    { below: 64,       label: 'Низкая — по силам обычному компьютеру',                              color: 'var(--amber)' },
    { below: 80,       label: 'Средняя — нужны большие дата-центры для перебора',                   color: 'var(--cyan)' },
    { below: 128,      label: 'Высокая — перебор возможен вычислительными силами всей планеты',     color: 'var(--cyan)' },
    { below: Infinity, label: 'Максимальная — перебор невозможен в обозримом будущем',              color: 'var(--magenta)' },
  ];

  function updateStats(){
    const bits = sourceBits();
    bitsValueEl.textContent = bits.toFixed(1) + ' бит';

    bitsSubEl.textContent = 'максимум ' + maxBits();

    if(sourceEmpty()){
      yearsValueEl.textContent = '—';
      yearsSubEl.innerHTML = '&nbsp;';
      qualityFillEl.style.width = '0%';
      qualityLabelEl.textContent = activeSrc === 'draw' ? 'пул пуст — начни рисовать' : 'пусто — напиши что-нибудь';
      qualityLabelEl.style.color = 'var(--fg-dim)';
    } else {
      const years = formatYears(bitsToYears(bits));
      yearsValueEl.textContent = years.value;
      yearsSubEl.textContent = years.note || ' ';
      yearsValueEl.title = years.note ? years.value + ' — ' + years.note : years.value;

      const pct = Math.min(100, (bits/maxBits())*100);
      qualityFillEl.style.width = pct + '%';

      const level = STRENGTH_LEVELS.find(l => bits < l.below);
      qualityLabelEl.textContent = level.label;
      qualityLabelEl.style.color = level.color;
    }
  }

  /* ---------------- fingerprint of the active source (synced into the field) ---------------- */

  // both algorithms' fingerprints of the active source, recomputed only when the source changes
  // (not on every salt tick); the hash table previews the one that isn't chosen
  let srcFps = { djb2: '', md5: '', sha256: '' };
  let srcFp = '';      // srcFps[alg], '' while the source is empty
  let fpTimer = null;

  function scheduleFingerprint(){
    clearTimeout(fpTimer);
    fpTimer = setTimeout(refreshFingerprint, 60);
  }

  function refreshFingerprint(){
    srcFps = { djb2: computeFingerprint('djb2'), md5: computeFingerprint('md5'), sha256: computeFingerprint('sha256') };
    srcFp = srcFps[alg];
    if(fpSync.checked && fpInput.value !== srcFp) fpInput.value = srcFp;
    onSeedInputsChanged();
  }

  // typing into a synced field takes it over manually
  fpInput.addEventListener('input', () => {
    fpSync.checked = false;
    onSeedInputsChanged();
  });
  fpSync.addEventListener('change', () => {
    if(fpSync.checked){
      fpInput.value = srcFp;
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

  // seed for generator g = first GEN_INFO[g].seedBytes bytes of H(fingerprint:salt) = g's whole state
  const seedSource = () => fpInput.value + ':' + saltInput.value;
  const seedFor = (mix, g) => mix.slice(0, GEN_INFO[g].seedBytes);
  // bytes the seeds are cut from: H(fingerprint:salt) — for djb2 (only 4 bytes) stretched with a counter,
  // djb2(x:0) ‖ djb2(x:1) ‖ … up to the largest seed (16 bytes); still only 32 bits of entropy
  const MAX_SEED_BYTES = 16;
  function mixFor(h, src){
    if(h !== 'djb2') return digestText(h, src);
    const out = new Uint8Array(MAX_SEED_BYTES);
    for(let i = 0; i < MAX_SEED_BYTES / 4; i++) out.set(digestText('djb2', src + ':' + i), i * 4);
    return out;
  }

  function updateGenState(){
    genBtn.disabled = fpInput.value.trim() === '';
  }

  // everything is synchronous (pure-JS hashes), so the panel always matches the fields
  function onSeedInputsChanged(){
    updateGenState();
    showAlgRows();
    const mix = fpInput.value.trim() === '' ? null : mixFor(alg, seedSource());
    for(const g of ['lcg', 'sfc32']) setVal(genValEl[g], mix && bytesToHex(seedFor(mix, g)));
  }

  // values are ellipsized in the UI, so the full text also goes into the title
  function setVal(el, v){
    el.textContent = v || '—';
    el.title = v ? v + ' — клик, чтобы скопировать' : '';
  }

  // chosen row = exactly what goes into SEED: the fingerprint field + dimmed ":salt";
  // other row = that algorithm's fingerprint of the same source, as a preview
  function showAlgRows(){
    for(const h of ['djb2', 'md5', 'sha256']){
      const el = algValEl[h];
      if(h !== alg){ setVal(el, srcFps[h]); continue; }
      const fp = fpInput.value;
      setVal(el, fp.trim() === '' ? '' : seedSource());
      if(fp.trim() === '') continue;
      const salt = document.createElement('span');
      salt.className = 'salt-part';
      salt.textContent = ':' + saltInput.value;
      el.textContent = fp;
      el.appendChild(salt);
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

  genBtn.addEventListener('click', () => {
    // snapshot exactly what the fields show at the moment of the click
    const src = seedSource();
    const fromSource = srcFp !== '' && fpInput.value === srcFp;
    const meta = alg + '/' + gen + ' ' + (fromSource
      ? (activeSrc === 'draw' ? '✎ ' : '⌨ ') + sourceBits().toFixed(1) + 'b'
      : 'ручной');
    genBtn.disabled = true;
    try {
      // a fresh generator per click: the output depends on algorithm + fingerprint + salt only
      const rng = GEN_INFO[gen].make(seedFor(mixFor(alg, src), gen));
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

      pushLog(tag, cls, value, meta, gen + ' ← ' + alg + '(' + src + ')');
    } finally {
      updateGenState();
    }
  });

  // Enter in any generator field = generate
  document.querySelector('.gen-panel').addEventListener('keydown', e => {
    if(e.key === 'Enter' && e.target.matches('input') && !genBtn.disabled) genBtn.click();
  });

  updateAlgLabels();
  updateStats();
  showGhost();
  updateTextGhost();
  updateRateLabel();
  startTicker();
  onSeedInputsChanged();
})(window.EF = window.EF || {});
