/** MAIN.JS | Purpose: * Application entry point. Waits for DOM ready, then initializes the app. */

const _v = window.__BS_VERSION__ || '0';

async function initApp() {
  try {
    const [appMod, stateMod] = await Promise.all([
      import('./app.js?v=' + _v),
      import('./state.js?v=' + _v),
    ]);
    window.app = appMod;
    window.state = stateMod.state;
    window.elements = stateMod.elements;

    const { pwaAuth } = await import('./pwa-auth.js?v=' + _v);
    window.pwaAuth = pwaAuth;

    // Initialize PWA authentication first
    const authSuccess = await pwaAuth.initialize();

    if (!authSuccess) {
      console.error('Authentication failed or cancelled');
      document.body.innerHTML = `
        <div style="
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          background: #1e1e1e;
          color: #fff;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          text-align: center;
          padding: 20px;
        ">
          <div>
            <h1 style="font-size: 24px; margin-bottom: 10px;">Login Required</h1>
            <p style="color: #aaa; margin-bottom: 20px;">Please login with your Home Assistant account to continue.</p>
            <button id="btn-login-ha" style="
              padding: 12px 24px;
              background: #0e639c;
              border: none;
              border-radius: 6px;
              color: #fff;
              cursor: pointer;
              font-size: 14px;
              font-weight: 600;
            ">Login with Home Assistant</button>
          </div>
        </div>
      `;
      document.getElementById('btn-login-ha')?.addEventListener('click', () => {
        pwaAuth.loginWithHA();
      });
      return;
    }

    // Start the application — dynamic import with cache bust
    const { init } = await import('./initialization.js?v=' + _v);
    await init();
  } catch (error) {
    console.error('Failed to initialize app:', error);
  }
}

// Start the application
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
