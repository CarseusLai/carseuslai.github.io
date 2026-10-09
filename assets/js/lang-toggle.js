/*
 * Bilingual (zh / en) toggle, shared by the public homepage and the encrypted /cv/ page.
 *
 * Markup: wrap text in elements with class "lang-zh" / "lang-en"; any element with
 * [data-lang-toggle] switches language. Load this script synchronously in <head> so the
 * hidden language never flashes. Without JS both languages stay visible.
 */
(function () {
  var KEY = 'site-lang';
  var root = document.documentElement;

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function initial() {
    var s = stored();
    if (s === 'zh' || s === 'en') return s;
    return /^zh/i.test(navigator.language || '') ? 'zh' : 'en';
  }

  function apply(lang) {
    root.setAttribute('data-lang', lang);
    root.setAttribute('lang', lang === 'zh' ? 'zh-Hant' : 'en');
    var btns = document.querySelectorAll('[data-lang-toggle]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].textContent = lang === 'zh' ? 'EN' : '中文';
      btns[i].setAttribute('aria-label', lang === 'zh' ? 'Switch to English' : '切換為中文');
    }
  }

  var style = document.createElement('style');
  style.textContent =
    'html[data-lang="zh"] .lang-en,html[data-lang="en"] .lang-zh{display:none !important}';
  document.head.appendChild(style);

  apply(initial());

  document.addEventListener('DOMContentLoaded', function () {
    apply(root.getAttribute('data-lang'));
  });

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-lang-toggle]');
    if (!t) return;
    e.preventDefault();
    var next = root.getAttribute('data-lang') === 'zh' ? 'en' : 'zh';
    try { localStorage.setItem(KEY, next); } catch (err) {}
    apply(next);
  });
})();
