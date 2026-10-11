/* Tooltips for [data-tip] elements: on hover, keyboard focus or tap.
   One fixed-position bubble on <body>, so scrolling/overflow containers can't clip it. */
(function () {
  "use strict";

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.id = 'tip';
  document.body.appendChild(tip);

  let current = null;

  function show(el){
    current = el;
    tip.textContent = el.dataset.tip;
    el.setAttribute('aria-describedby', 'tip');
    tip.classList.add('on');

    // below the element, flipped above if there's no room; clamped to the viewport
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const M = 8;
    let left = Math.min(Math.max(M, r.left), innerWidth - t.width - M);
    let top = r.bottom + 6;
    if(top + t.height > innerHeight - M) top = Math.max(M, r.top - t.height - 6);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function hide(){
    if(!current) return;
    current.removeAttribute('aria-describedby');
    current = null;
    tip.classList.remove('on');
  }

  document.addEventListener('pointerover', e => {
    if(e.pointerType !== 'mouse') return; // touch uses focus (tap) instead
    const el = e.target.closest('[data-tip]');
    if(el && el !== current) show(el);
    else if(!el) hide();
  });
  document.addEventListener('focusin', e => {
    const el = e.target.closest('[data-tip]');
    if(el) show(el);
  });
  document.addEventListener('focusout', e => {
    if(e.target === current) hide();
  });
  document.addEventListener('keydown', e => { if(e.key === 'Escape') hide(); });
  addEventListener('scroll', hide, true);
  addEventListener('resize', hide);
})();
