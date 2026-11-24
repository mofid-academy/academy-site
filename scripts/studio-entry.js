(function () {
  'use strict';

  const {role, vendor, runtime, presentation} = document.currentScript.dataset;
  const key = 'mofid-studio-' + role + '-session';
  const client = window.MofidStudioDomain;
  const shell = document.getElementById('studioEntry');
  const form = document.getElementById('studioLogin');
  const button = form.querySelector('button[type="submit"]');
  const message = document.getElementById('studioEntryMessage');
  const retry = document.getElementById('studioEntryRetry');
  const reveal = document.getElementById('studioReveal');
  let launching = false;

  if (!client) {
    message.textContent = 'بخش ورود بارگیری نشد.';
    retry.hidden = false;
    return;
  }
  const cleanup = window.MofidEntryUI?.mountLogin(shell);

  function readSession() {
    try { return JSON.parse(sessionStorage.getItem(key) || 'null'); }
    catch { return null; }
  }

  function preload(src) {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'script';
    link.href = src;
    document.head.append(link);
    return link;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  }

  async function launch() {
    if (launching) return;
    launching = true;
    cleanup?.();
    form.hidden = true;
    message.textContent = 'در حال آماده‌سازی محیط استودیو…';
    const bundle = preload(runtime);

    function showRetry() {
      if (!shell.isConnected) return;
      message.textContent = 'محیط استودیو هنوز بارگیری نشده است.';
      retry.hidden = false;
    }

    const watchdog = setTimeout(showRetry, 20000);
    try {
      await Promise.all([
        loadScript(vendor),
        loadScript(presentation),
        window.AcademyWorkspaceStyle?.loadStyles(),
      ]);
      await loadScript(runtime);
      window.AcademyWorkspaceStyle?.decorateWorkspace();
    } catch {
      clearTimeout(watchdog);
      showRetry();
    } finally {
      bundle.remove();
    }
  }

  reveal.addEventListener('click', () => {
    const show = form.elements.password.type === 'password';
    form.elements.password.type = show ? 'text' : 'password';
    reveal.setAttribute('aria-pressed', String(show));
    reveal.setAttribute('aria-label', show ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور');
    reveal.textContent = show ? 'پنهان' : 'نمایش';
  });
  form.addEventListener('focusin', () => void client.prepare().catch(() => {}), {once: true});
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = 'در حال ورود…';
    message.textContent = '';

    try {
      const response = await client.request({
        action: 'login',
        username: form.elements.username.value,
        password: form.elements.password.value,
        token: '',
      });
      const data = await response.json();
      if (!response.ok || data?.ok !== true) {
        throw Error(data?.error || 'ورود انجام نشد. دوباره تلاش کنید.');
      }
      if (role === 'admin' && data.user?.role !== 'admin') {
        throw Error('این حساب دسترسی سوپرادمین ندارد.');
      }
      if (typeof data.token !== 'string' || !data.token || !['admin', 'participant'].includes(data.user?.role)) {
        throw Error('پاسخ ورود معتبر نیست. دوباره تلاش کنید.');
      }
      sessionStorage.setItem(key, JSON.stringify({token: data.token, user: data.user}));
      form.elements.password.value = '';
      void launch();
    } catch (error) {
      message.textContent = error.message || 'ورود انجام نشد. دوباره تلاش کنید.';
    } finally {
      button.disabled = false;
      button.textContent = 'ورود';
    }
  });

  button.disabled = false;
  if (readSession()?.token) void launch();
}());
