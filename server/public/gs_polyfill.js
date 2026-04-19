// gs_polyfill.js — google.script.run Proxy 폴리필
// google.script.run.functionName(args) → POST /api/functionName
(function () {
  var _success = null;
  var _failure = null;

  var runProxy = new Proxy({}, {
    get: function (_, prop) {
      if (prop === 'withSuccessHandler') {
        return function (fn) { _success = fn; return runProxy; };
      }
      if (prop === 'withFailureHandler') {
        return function (fn) { _failure = fn; return runProxy; };
      }

      // GAS 함수 이름 — 호출 시 fetch로 중계
      var s = _success;
      var f = _failure;
      _success = null;
      _failure = null;

      return function () {
        var args = Array.prototype.slice.call(arguments);
        fetch('/api/' + prop, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(args)
        })
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then(function (data) { if (s) s(data); })
          .catch(function (e) { if (f) f(e); else console.error('[gs_polyfill]', e); });
      };
    }
  });

  window.google = { script: { run: runProxy } };
})();
