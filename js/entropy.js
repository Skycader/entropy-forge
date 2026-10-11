/* Entropy estimation (drawing / text) + brute-force time estimate.
   Estimates are uncapped here; the caller caps them at the chosen hash's output size. */
(function (EF) {
  "use strict";

  const GUESSES_PER_SECOND = 1e12; // conservative modern brute-force assumption
  const SECONDS_PER_YEAR = 365.25 * 24 * 3600;

  function shannonEntropy(counts){
    const total = counts.reduce((a,b)=>a+b,0);
    if(total <= 0) return 0;
    let h = 0;
    for(const c of counts){
      if(c > 0){
        const p = c/total;
        h -= p * Math.log2(p);
      }
    }
    return h;
  }

  function estimateBits(pts){
    if(pts.length < 3) return 0;

    const DIR_BINS = 16;
    const TIME_BINS = 16;
    const dirCounts = new Array(DIR_BINS).fill(0);
    const timeCounts = new Array(TIME_BINS).fill(0);
    let dirSamples = 0;
    let timeSamples = 0;

    for(let i=1;i<pts.length;i++){
      if(pts[i].newStroke) continue;
      const dx = pts[i].x - pts[i-1].x;
      const dy = pts[i].y - pts[i-1].y;
      const dist = Math.hypot(dx,dy);
      if(dist > 0.4){
        const angle = Math.atan2(dy,dx); // -PI..PI
        const bin = Math.min(DIR_BINS-1, Math.floor(((angle+Math.PI)/(2*Math.PI)) * DIR_BINS));
        dirCounts[bin]++;
        dirSamples++;
      }
      const dt = pts[i].t - pts[i-1].t;
      const frac = dt - Math.floor(dt); // sub-millisecond jitter, hard to control
      const tbin = Math.min(TIME_BINS-1, Math.floor(frac * TIME_BINS));
      timeCounts[tbin]++;
      timeSamples++;
    }

    const Hdir = shannonEntropy(dirCounts);   // 0..4 bits
    const Htime = shannonEntropy(timeCounts); // 0..4 bits

    const rawBits = (dirSamples * Hdir) + (timeSamples * Htime * 0.5);

    // consecutive samples are correlated (not iid) -> discount factor
    const CORRELATION_DISCOUNT = 5;
    const bits = rawBits / CORRELATION_DISCOUNT;

    return bits;
  }

  /* Text entropy — a deliberately simple, conservative heuristic:
       bits/char  = log2(size of the character classes used)  (brute-force alphabet)
       characters = unique chars + ¼ per repeat, with runs ("aaaa") collapsed to one
       language   = ×0.4 when it reads like words (mostly letters/spaces) — prose is predictable */
  const TEXT_CLASSES = [
    [/[a-z]/, 26], [/[A-Z]/, 26], [/[0-9]/, 10], [/[а-яё]/, 33], [/[А-ЯЁ]/, 33],
    [/\s/, 1], [/[!-/:-@[-`{-~]/, 32],
  ];
  const OTHER_CLASS = 100; // any other unicode (emoji, other scripts, typographic symbols)

  function estimateTextBits(text){
    const chars = Array.from(text); // by code point, so emoji count once
    if(chars.length === 0) return 0;

    let pool = 0, hasOther = false;
    for(const [re, size] of TEXT_CLASSES) if(chars.some(c => re.test(c))) pool += size;
    for(const c of chars){
      if(!TEXT_CLASSES.some(([re]) => re.test(c))){ hasOther = true; break; }
    }
    if(hasOther) pool += OTHER_CLASS;

    let runs = 0;
    for(let i=0;i<chars.length;i++) if(i === 0 || chars[i] !== chars[i-1]) runs++;
    const unique = new Set(chars).size;
    const effectiveChars = unique + 0.25 * (runs - unique);

    // punctuation is normal in prose, so ¾ letters/spaces is enough; needs ≥3 distinct letters to be "words"
    const letters = chars.filter(c => /[\p{L}\s]/u.test(c)).length;
    const distinctLetters = new Set(chars.filter(c => /\p{L}/u.test(c))).size;
    const looksLikeWords = letters / chars.length >= 0.75 && distinctLetters >= 3;
    const LANGUAGE_FACTOR = looksLikeWords ? 0.4 : 1;

    return Math.log2(Math.max(pool, 2)) * effectiveChars * LANGUAGE_FACTOR;
  }

  function bitsToYears(bits){
    if(bits <= 0) return 0;
    // average-case brute force = half the keyspace
    const exponent = bits - 1; // log2(space/2) = bits - 1
    // years = 2^exponent / guesses_per_sec / seconds_per_year, computed in log-space to avoid overflow
    const log10Years = exponent * Math.log10(2) - Math.log10(GUESSES_PER_SECOND) - Math.log10(SECONDS_PER_YEAR);
    return log10Years; // returned as log10(years)
  }

  // -> {value, note}: short readout + an optional human-scale comparison
  function formatYears(log10Years){
    if(log10Years < 0){
      const seconds = Math.pow(10, log10Years) * SECONDS_PER_YEAR;
      if(seconds < 1e-6) return { value: '< 1 мкс', note: 'мгновенно' };
      let value;
      if(seconds < 1e-3) value = (seconds*1e6).toFixed(1) + ' мкс';
      else if(seconds < 1) value = (seconds*1000).toFixed(1) + ' мс';
      else if(seconds < 60) value = seconds.toFixed(1) + ' сек';
      else if(seconds < 3600) value = (seconds/60).toFixed(1) + ' мин';
      else if(seconds < 86400) value = (seconds/3600).toFixed(1) + ' ч';
      else value = (seconds/86400).toFixed(1) + ' дн';
      return { value, note: '' };
    }
    if(log10Years < 3){
      return { value: Math.pow(10, log10Years).toFixed(1) + ' лет', note: '' };
    }
    // scientific notation for big numbers, with cheeky milestones
    const exp = Math.floor(log10Years);
    const mant = Math.pow(10, log10Years - exp);
    let note = '';
    if(exp >= 10 && exp < 17) note = 'дольше существования Земли';
    else if(exp >= 17 && exp < 100) note = 'дольше жизни Вселенной';
    else if(exp >= 100) note = 'числа без физического смысла';
    return { value: mant.toFixed(2) + '×10^' + exp + ' лет', note };
  }

  EF.entropy = { estimateBits, estimateTextBits, bitsToYears, formatYears };
})(window.EF = window.EF || {});
