(function () {
  'use strict';

  const { portal, pdf: pdfSource } = document.currentScript.dataset;
  let pdfReady;

  async function request(body) {
    const timeout = ['login', 'me'].includes(body.action) ? 20000 : 120000;
    try {
      return await fetch(portal, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw Error('پاسخ سرویس استودیو دریافت نشد. دوباره تلاش کنید.');
    }
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

  window.MofidStudioDomain = Object.freeze({ request, loadPdfAssets });
})();
