/* Entropy estimation of the drawn pool + brute-force time estimate */
(function (EF) {
  "use strict";

  // sfc32 state is 128 bits — pool entropy above that can't reach the output
  const MAX_BITS = 128;

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

    return Math.min(bits, MAX_BITS);
  }

  function bitsToYears(bits){
    if(bits <= 0) return 0;
    // average-case brute force = half the keyspace
    const exponent = bits - 1; // log2(space/2) = bits - 1
    // years = 2^exponent / guesses_per_sec / seconds_per_year, computed in log-space to avoid overflow
    const log10Years = exponent * Math.log10(2) - Math.log10(GUESSES_PER_SECOND) - Math.log10(SECONDS_PER_YEAR);
    return log10Years; // returned as log10(years)
  }

  function formatYears(log10Years){
    if(log10Years < -6) return '< 1 мкс здравого смысла';
    if(log10Years < 0){
      const years = Math.pow(10, log10Years);
      const seconds = years * SECONDS_PER_YEAR;
      if(seconds < 1) return (seconds*1000).toFixed(1) + ' мс';
      if(seconds < 60) return seconds.toFixed(1) + ' сек';
      if(seconds < 3600) return (seconds/60).toFixed(1) + ' мин';
      if(seconds < 86400) return (seconds/3600).toFixed(1) + ' ч';
      return (seconds/86400).toFixed(1) + ' дн';
    }
    if(log10Years < 3){
      return Math.pow(10, log10Years).toFixed(1) + ' лет';
    }
    // scientific notation for big numbers, with cheeky milestones
    const exp = Math.floor(log10Years);
    const mant = Math.pow(10, log10Years - exp);
    let note = '';
    if(exp >= 10 && exp < 17) note = ' (дольше существования Земли)';
    else if(exp >= 17 && exp < 100) note = ' (дольше жизни Вселенной)';
    else if(exp >= 100) note = ' (числа без физического смысла)';
    return mant.toFixed(2) + '×10^' + exp + ' лет' + note;
  }

  EF.entropy = { MAX_BITS, estimateBits, bitsToYears, formatYears };
})(window.EF = window.EF || {});
