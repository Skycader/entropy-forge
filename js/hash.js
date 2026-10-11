/* Pool serialization + hashing (SHA-256 via WebCrypto, MD5 in pure JS for reference) */
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

  async function sha256(buf){
    return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  }

  function bytesToHex(arr){
    return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  /* pure-JS MD5 (RFC 1321) — shown for reference only, never used as the actual PRNG seed */
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

  EF.hash = { packPool, sha256, md5, bytesToHex };
})(window.EF = window.EF || {});
