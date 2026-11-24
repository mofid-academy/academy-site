(function () {
  'use strict';

  const portalOrigin = 'https://mofid-academy.github.io';
  const portalFrame = portalOrigin + '/learning-studio/studio-domain-api.html';
  const pdfSource = document.currentScript.dataset.pdf;
  let bridgeReady;
  let pdfReady;

  function connect() {
    if (!bridgeReady) {
      bridgeReady = new Promise((resolve, reject) => {
        const frame = document.createElement('iframe');
        frame.hidden = true;
        frame.title = 'اتصال مفید استودیو';
        frame.referrerPolicy = 'no-referrer';
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        frame.src = portalFrame;

        function ready(event) {
          if (event.origin !== portalOrigin || event.source !== frame.contentWindow
              || event.data?.type !== 'mofid-studio-portal-ready') return;
          clearTimeout(timeout);
          window.removeEventListener('message', ready);
          resolve(frame.contentWindow);
        }

        const timeout = setTimeout(() => {
          window.removeEventListener('message', ready);
          frame.remove();
          bridgeReady = undefined;
          reject(Error('اتصال مفید استودیو برقرار نشد.'));
        }, 12000);
        window.addEventListener('message', ready);
        document.body.append(frame);
      });
    }
    return bridgeReady;
  }

  async function request(body) {
    const frame = await connect();
    return new Promise((resolve, reject) => {
      const { port1, port2 } = new MessageChannel();

      function finish(result) {
        clearTimeout(timeout);
        port1.close();
        if (result?.error || !Number.isInteger(result?.status) || result.status < 200 || result.status > 599) {
          reject(Error('پاسخ سرویس استودیو دریافت نشد.'));
          return;
        }
        resolve(new Response(result.text || null, {
          status: result.status,
          headers: { 'Content-Type': 'application/json' },
        }));
      }

      const wait = ['login', 'me'].includes(body.action) ? 15000 : 120000;
      const timeout = setTimeout(() => finish({ error: true }), wait);
      port1.onmessage = event => finish(event.data);
      try {
        frame.postMessage({ type: 'mofid-studio-portal', body }, portalOrigin, [port2]);
      } catch {
        finish({ error: true });
      }
    });
  }

  function loadPdfAssets() {
    if (globalThis.__MOFID_PDF_BINARIES) return Promise.resolve(globalThis.__MOFID_PDF_BINARIES);
    if (!pdfReady) {
      pdfReady = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = pdfSource;
        function fail() {
          script.remove();
          pdfReady = undefined;
          reject(Error('فایل‌های کمکی PDF بارگیری نشدند.'));
        }
        script.onerror = fail;
        script.onload = () => (
          globalThis.__MOFID_PDF_BINARIES ? resolve(globalThis.__MOFID_PDF_BINARIES) : fail()
        );
        document.head.append(script);
      });
    }
    return pdfReady;
  }

  window.MofidStudioDomain = Object.freeze({ request, loadPdfAssets, prepare: connect });
})();
