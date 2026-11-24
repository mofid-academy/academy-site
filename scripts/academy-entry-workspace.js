(function () {
  'use strict';

  const settings = document.documentElement.dataset;
  let styles;
  function loadStyles() {
    if (!settings.academyWorkspaceStyle) return Promise.resolve();
    if (!styles) {
      styles = new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = settings.academyWorkspaceStyle;
        link.onload = () => {
          document.getElementById('academyEntryStyle')?.remove();
          resolve();
        };
        link.onerror = () => {
          link.remove();
          reject(Error('ظاهر بخش به‌طور کامل بارگیری نشد. دوباره تلاش کنید.'));
        };
        document.head.append(link);
      }).catch(error => {
        styles = undefined;
        throw error;
      });
    }
    return styles;
  }

  let decorationsStarted = false;
  function decorateWorkspace() {
    if (decorationsStarted || !settings.academyWorkspaceEffects) return;
    if (navigator.connection?.saveData
        || ['slow-2g', '2g', '3g'].includes(navigator.connection?.effectiveType)
        || !matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches) return;
    decorationsStarted = true;
    for (const src of settings.academyWorkspaceEffects.split(' ')) {
      const script = document.createElement('script');
      script.src = src;
      document.head.append(script);
    }
  }

  window.AcademyWorkspaceStyle = Object.freeze({loadStyles, decorateWorkspace});
}());
