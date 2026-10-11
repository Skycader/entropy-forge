/* Pool serialization + hashing: MD5 and SHA-256, both pure JS and synchronous */
(function (EF) {
  "use strict";

  function packPool(pts){
    const buf = new ArrayBuffer(pts.length * (4+4+8));
    const view = new DataView(buf);
    let off = 0;
    for(const p of pts){
      view.setFloat32(off, p.x, true); off += 4;
      view.setFloat32(off, p.y, true); off += 4;
      view.setFloat64(off, p.t, true); off += 8;
    }
    return buf;
  }

  function bytesToHex(arr){
    return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  /* ---------------- MD5 (RFC 1321) ---------------- */

  const MD5_S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
                 5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
                 4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
                 6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const MD5_K = new Int32Array(64);
  for(let i=0;i<64;i++){ MD5_K[i] = (Math.floor(Math.abs(Math.sin(i+1)) * 4294967296)) | 0; }

  function md5rotl(x,c){ return (x<<c)|(x>>>(32-c)); }

  function md5(buf){
    const bytes = new Uint8Array(buf);
    let a0=0x67452301, b0=0xefcdab89, c0=0x98badcfe, d0=0x10325476;
    const origLenBits = bytes.length * 8;
    let msg = Array.from(bytes);
    msg.push(0x80);
    while(msg.length % 64 !== 56) msg.push(0);
    const lenLow = origLenBits >>> 0;
    for(let i=0;i<4;i++) msg.push((lenLow >>> (8*i)) & 0xff);
    for(let i=0;i<4;i++) msg.push(0); // high 32 bits (buffers here never exceed 2^32 bits)

    for(let chunkStart=0; chunkStart<msg.length; chunkStart+=64){
      const chunk = msg.slice(chunkStart, chunkStart+64);
      const M = new Int32Array(16);
      for(let j=0;j<16;j++){
        M[j] = chunk[j*4] | (chunk[j*4+1]<<8) | (chunk[j*4+2]<<16) | (chunk[j*4+3]<<24);
      }
      let A=a0,B=b0,C=c0,D=d0;
      for(let i=0;i<64;i++){
        let F,g;
        if(i<16){ F=(B&C)|((~B)&D); g=i; }
        else if(i<32){ F=(D&B)|((~D)&C); g=(5*i+1)%16; }
        else if(i<48){ F=B^C^D; g=(3*i+5)%16; }
        else { F=C^(B|(~D)); g=(7*i)%16; }
        F = (F + A + MD5_K[i] + M[g]) | 0;
        A = D; D = C; C = B;
        B = (B + md5rotl(F, MD5_S[i])) | 0;
      }
      a0=(a0+A)|0; b0=(b0+B)|0; c0=(c0+C)|0; d0=(d0+D)|0;
    }
    const out = new Uint8Array(16);
    const dv = new DataView(out.buffer);
    dv.setInt32(0, a0, true); dv.setInt32(4, b0, true); dv.setInt32(8, c0, true); dv.setInt32(12, d0, true);
    return out;
  }

  /* ---------------- SHA-256 (FIPS 180-4) ---------------- */

  // constants = fractional parts of square / cube roots of the first primes (same idea as MD5_K)
  const PRIMES = [];
  for(let n=2; PRIMES.length<64; n++) if(PRIMES.every(p => n % p)) PRIMES.push(n);
  const frac32 = x => Math.floor((x - Math.floor(x)) * 4294967296) >>> 0;
  const SHA_K = Uint32Array.from(PRIMES, p => frac32(Math.cbrt(p)));
  const SHA_H0 = Uint32Array.from(PRIMES.slice(0, 8), p => frac32(Math.sqrt(p)));

  function sha256(buf){
    const bytes = new Uint8Array(buf);
    const len = bytes.length;
    const total = Math.ceil((len + 9) / 64) * 64;
    const m = new Uint8Array(total);
    m.set(bytes);
    m[len] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(total - 8, Math.floor(len / 0x20000000)); // bit length, high word
    dv.setUint32(total - 4, (len * 8) >>> 0);              // bit length, low word

    const H = Uint32Array.from(SHA_H0);
    const W = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for(let off=0; off<total; off+=64){
      for(let i=0;i<16;i++) W[i] = dv.getUint32(off + i*4);
      for(let i=16;i<64;i++){
        const s0 = rotr(W[i-15], 7) ^ rotr(W[i-15], 18) ^ (W[i-15] >>> 3);
        const s1 = rotr(W[i-2], 17) ^ rotr(W[i-2], 19) ^ (W[i-2] >>> 10);
        W[i] = (W[i-16] + s0 + W[i-7] + s1) | 0;
      }
      let a=H[0], b=H[1], c=H[2], d=H[3], e=H[4], f=H[5], g=H[6], h=H[7];
      for(let i=0;i<64;i++){
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + SHA_K[i] + W[i]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0]+=a; H[1]+=b; H[2]+=c; H[3]+=d; H[4]+=e; H[5]+=f; H[6]+=g; H[7]+=h; // Uint32Array wraps mod 2^32
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    for(let i=0;i<8;i++) odv.setUint32(i*4, H[i]);
    return out;
  }

  /* ---------------- selectable algorithm ---------------- */

  const ALGS = { md5, sha256 };
  const utf8 = new TextEncoder();

  // digest of raw bytes / of a UTF-8 string with the chosen algorithm ('md5' | 'sha256')
  const digest = (alg, buf) => ALGS[alg](buf);
  const digestText = (alg, str) => ALGS[alg](utf8.encode(str));

  EF.hash = { packPool, md5, sha256, digest, digestText, bytesToHex };
})(window.EF = window.EF || {});
