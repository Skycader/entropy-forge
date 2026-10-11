/* Drawing pad: captures {x, y, t, newStroke} points and renders the path */
(function (EF) {
  "use strict";

  function createPad(shell, canvas, onChange){
    const ctx = canvas.getContext('2d');
    let points = [];
    let activePointer = null; // pointerId of the stroke in progress, null when idle
    let liftPen = false;      // pointer left the pad mid-stroke -> next point starts a new stroke

    function resize(){
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const rect = shell.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0);
      redraw();
    }

    function redraw(){
      const rect = shell.getBoundingClientRect();
      ctx.clearRect(0,0,rect.width,rect.height);
      if(points.length < 2) return;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowBlur = 8;
      ctx.shadowColor = 'rgba(52,255,240,0.8)';
      ctx.strokeStyle = 'rgba(52,255,240,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for(let i=1;i<points.length;i++){
        // gap between strokes -> lift pen
        if(points[i].newStroke){
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(points[i].x, points[i].y);
        } else {
          ctx.lineTo(points[i].x, points[i].y);
        }
      }
      ctx.stroke();
    }

    function addPoint(e, newStroke){
      const rect = shell.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // pointer is captured, so moves outside the pad still arrive — skip them
      if(x < 0 || y < 0 || x > rect.width || y > rect.height){
        liftPen = true;
        return;
      }
      points.push({x, y, t: performance.now(), newStroke: newStroke || liftPen});
      liftPen = false;
      redraw();
      onChange(points);
    }

    shell.addEventListener('pointerdown', e => {
      if(activePointer !== null) return; // ignore extra fingers
      activePointer = e.pointerId;
      shell.setPointerCapture(e.pointerId);
      addPoint(e, true);
      e.preventDefault();
    });

    shell.addEventListener('pointermove', e => {
      if(e.pointerId !== activePointer) return;
      addPoint(e, false);
      e.preventDefault();
    });

    function endStroke(e){
      if(e.pointerId === activePointer) activePointer = null;
    }
    shell.addEventListener('pointerup', endStroke);
    shell.addEventListener('pointercancel', endStroke);
    shell.addEventListener('lostpointercapture', endStroke);

    window.addEventListener('resize', resize);
    resize();

    return {
      get points(){ return points; },
      reset(){
        points = [];
        activePointer = null;
        liftPen = false;
        redraw();
      }
    };
  }

  EF.createPad = createPad;
})(window.EF = window.EF || {});
