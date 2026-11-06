/**
 * Shared "↻ 重新整理" button for every page in this site.
 *
 * Usage: <script src="reload-button.js" defer></script> (adjust the relative path).
 * - If the page has an element with [data-reload], that element becomes the button.
 * - Otherwise a small button is pinned to the top-right corner.
 *   Optional: <script ... data-top="64px"> to sit below a fixed top bar, and
 *   data-top-mobile="10px" for phones, where it shrinks to a round ↻ icon.
 * Pressing it fetches the newest deploy (cache-busting query, service worker
 * update when there is one) and keeps the current #hash, so you stay put.
 */
(function () {
  const script = document.currentScript;
  const top = script?.dataset.top || '10px';
  const topMobile = script?.dataset.topMobile || top;

  async function reloadFresh() {
    try {
      const registration = await navigator.serviceWorker?.getRegistration?.();
      await registration?.update();
    } catch (error) {
      console.warn('service worker update skipped', error);
    }
    const url = new URL(location.href);
    url.searchParams.set('r', String(Date.now()));
    location.replace(url.toString());
  }

  function mount() {
    let button = document.querySelector('[data-reload]');
    if (!button) {
      const style = document.createElement('style');
      style.textContent = `#site-reload{position:fixed;z-index:19;top:calc(${top} + env(safe-area-inset-top,0px));right:max(12px,env(safe-area-inset-right,0px));`
        + 'padding:7px 12px;border:1px solid rgba(255,255,255,.25);border-radius:8px;background:rgba(30,30,46,.85);color:#f3efe4;'
        + 'font:700 14px "Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;cursor:pointer;opacity:.6;transition:opacity .2s}'
        + '#site-reload:hover,#site-reload:focus-visible{opacity:1}'
        + `@media (max-width:640px){#site-reload{top:calc(${topMobile} + env(safe-area-inset-top,0px));width:38px;height:38px;padding:0;border-radius:50%;font-size:0}#site-reload::before{content:"↻";font-size:18px;line-height:36px}}`
        + '@media print{#site-reload{display:none}}';
      document.head.append(style);
      button = document.createElement('button');
      button.id = 'site-reload';
      button.type = 'button';
      button.textContent = '↻ 重新整理';
      button.setAttribute('aria-label', '重新整理，載入最新版');
      document.body.append(button);
    }
    button.title = button.title || '載入最新版';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      reloadFresh();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
