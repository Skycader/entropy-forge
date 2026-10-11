/* Tooltips for [data-tip] (plain text) and [data-tip-html] (markup, e.g. a formula block) elements:
   on hover, keyboard focus or tap. data-tip-html is only ever set by our own code, never from user input.
   One fixed-position bubble on <body>, so scrolling/overflow containers can't clip it. */
(function () {
  "use strict";

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.id = 'tip';
  document.body.appendChild(tip);

  let current = null;
  const SELECTOR = '[data-tip], [data-tip-html]';

  function show(el){
    current = el;
    if(el.dataset.tipHtml) tip.innerHTML = el.dataset.tipHtml;
    else tip.textContent = el.dataset.tip;
    tip.classList.toggle('wide', 'tipWide' in el.dataset); // room for code listings
    el.setAttribute('aria-describedby', 'tip');
    tip.classList.add('on');

    // below the element, flipped above if there's no room; clamped to the viewport.
    // Measure at the origin: at its previous position the bubble would shrink to the space left of the edge
    tip.style.left = '0px';
    tip.style.top = '0px';
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
    const el = e.target.closest(SELECTOR);
    if(el && el !== current) show(el);
    else if(!el) hide();
  });
  document.addEventListener('focusin', e => {
    const el = e.target.closest(SELECTOR);
    if(el) show(el);
  });
  document.addEventListener('focusout', e => {
    if(current && current.contains(e.target)) hide(); // focus may sit on a child, e.g. a radio inside its label
  });
  document.addEventListener('keydown', e => { if(e.key === 'Escape') hide(); });
  addEventListener('scroll', hide, true);
  addEventListener('resize', hide);
})();
