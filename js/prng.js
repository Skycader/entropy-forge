/* sfc32 PRNG seeded from the pool hash + unbiased random primitives */
(function (EF) {
  "use strict";

  function sfc32(a,b,c,d){
    return function(){
      a|=0; b|=0; c|=0; d|=0;
      let t = (a + b | 0) + d | 0;
      d = d + 1 | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21 | c >>> 11);
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }

  // uses the first 16 bytes of the hash = full 128-bit sfc32 state
  function makeRng(hashBytes){
    const dv = new DataView(hashBytes.buffer, hashBytes.byteOffset, 16);
    const rng = sfc32(dv.getUint32(0, true), dv.getUint32(4, true), dv.getUint32(8, true), dv.getUint32(12, true));
    for(let i=0;i<20;i++) rng(); // warm up
    return rng;
  }

  function randUint32(rng){
    return Math.floor(rng() * 4294967296);
  }

  // 53 random bits -> uniform double in [0,1), never rounds up to 1
  function randDouble(rng){
    const hi = randUint32(rng) >>> 5; // 27 bits
    const lo = randUint32(rng) >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  // uniform BigInt in [0, n), n > 0n — rejection sampling over the minimal bit width
  function randBigBelow(rng, n){
    const bits = n.toString(2).length;
    const words = Math.ceil(bits / 32);
    const excess = BigInt(words * 32 - bits);
    let x;
    do {
      x = 0n;
      for(let i=0;i<words;i++) x = (x << 32n) | BigInt(randUint32(rng));
      x >>= excess;
    } while(x >= n);
    return x;
  }

  function clampSafe(v){
    return Math.max(Number.MIN_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(v)));
  }

  function randInt(rng, a, b){
    a = clampSafe(a); b = clampSafe(b);
    if(b < a) [a,b] = [b,a];
    const range = b - a + 1; // may be inexact above 2^53, only used for the fast-path check
    if(range <= 1) return a;
    if(range <= 4294967296){
      const limit = Math.floor(4294967296 / range) * range;
      let x;
      do { x = randUint32(rng); } while(x >= limit);
      return a + (x % range);
    }
    // wide ranges: exact arithmetic in BigInt (Number-based rejection would loop forever)
    const bigRange = BigInt(b) - BigInt(a) + 1n;
    return Number(BigInt(a) + randBigBelow(rng, bigRange));
  }

  const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  function randomString(rng, length){
    const n = CHARSET.length; // 62
    const limit = Math.floor(256/n) * n; // 248
    let out = '';
    for(let i=0;i<length;i++){
      let byte;
      do { byte = Math.floor(rng()*256); } while(byte >= limit);
      out += CHARSET[byte % n];
    }
    return out;
  }

  EF.prng = { makeRng, randDouble, randInt, randomString };
})(window.EF = window.EF || {});
