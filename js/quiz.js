/* GoVibe Mix — small quiz widget shared by the lesson pages. GVQuiz.init(data, onPass): fills every [data-quiz="id"] box; onPass(id) runs when all answers are right. */
window.GVQuiz = (() => {
  function init(QUIZ, onPass) {
    document.querySelectorAll('[data-quiz]').forEach((box) => {
      const id = box.dataset.quiz, qs = QUIZ[id]; if (!qs) return;
      const h = document.createElement('h3'); h.textContent = 'Check yourself'; h.style.fontSize = '15px'; box.appendChild(h);
      qs.forEach((q, qi) => {
        const fs = document.createElement('fieldset'), lg = document.createElement('legend'); lg.textContent = (qi + 1) + '. ' + q.q; fs.appendChild(lg);
        q.o.forEach((txt, oi) => { const lb = document.createElement('label'), r = document.createElement('input'); r.type = 'radio'; r.name = 'q-' + id + '-' + qi; r.value = oi; lb.append(r, document.createTextNode(' ' + txt)); fs.appendChild(lb); });
        const fb = document.createElement('div'); fb.className = 'qfb'; fb.setAttribute('role', 'status'); fs.appendChild(fb); box.appendChild(fs);
      });
      const btn = document.createElement('button'); btn.className = 'btn'; btn.textContent = 'Check answers'; const res = document.createElement('p'); res.className = 'status'; res.setAttribute('role', 'status'); box.append(btn, res);
      btn.onclick = () => {
        let right = 0, answered = 0;
        qs.forEach((q, qi) => { const sel = box.querySelector('input[name="q-' + id + '-' + qi + '"]:checked'), fb = box.querySelectorAll('.qfb')[qi]; if (!sel) { fb.textContent = 'Pick an answer.'; fb.className = 'qfb'; return; } answered++; const ok = +sel.value === q.a; if (ok) right++; fb.textContent = (ok ? 'Correct. ' : 'Not quite. ') + q.w; fb.className = 'qfb ' + (ok ? 'ok' : 'no'); });
        if (answered < qs.length) { res.textContent = 'Answer all ' + qs.length + ' questions first.'; return; }
        res.textContent = right + ' of ' + qs.length + ' correct.' + (right === qs.length ? ' Lesson marked as done.' : ' Read the notes above and try again.'); if (right === qs.length) onPass(id);
      };
    });
  }
  return { init };
})();
