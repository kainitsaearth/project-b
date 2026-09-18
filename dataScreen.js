// dataScreen.js — Step 10: back up your data (JSON export), install, offline status,
// notification permission for the cooled reminder.

import { h, row } from './dom.js?v=23';
import * as X from './exportData.js?v=23';

// The version this build was loaded as — the ?v= on this module's own URL, bumped by the deploy loop.
export const APP_VERSION = Number(new URL(import.meta.url).searchParams.get('v')) || null;

// Chrome fires this once, early; keep it so the Install button can use it later.
let installPrompt = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); installPrompt = ev; });
  window.addEventListener('appinstalled', () => { installPrompt = null; });
}

const when = iso => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'never'
    : `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

export function dataScreen(initialState, actions, { schema }) {
  let state = initialState;
  const el = h('section', { class: 'screen', id: 'data' });

  const countsEl = h('div', { class: 'derived', id: 'data-counts' });
  const lastEl = h('span', { id: 'data-last-export' });
  const pendingEl = h('div', { id: 'data-pending' });
  const statusEl = h('p', { class: 'field-hint', id: 'export-status', role: 'status' });
  const storageEl = h('span', { id: 'data-storage' }, '…');
  const offlineEl = h('span', { id: 'data-offline' }, '…');
  const installEl = h('div', { id: 'data-install' });
  const notifyEl = h('div', { id: 'data-notify' });

  const payload = () => {
    const now = new Date();
    const obj = X.buildExport(state, { exportedAt: now.toISOString(), appVersion: APP_VERSION, schema });
    return { now, obj, name: X.exportFilename(now), json: JSON.stringify(obj, null, 2) };
  };

  const download = () => {
    const { now, obj, name, json } = payload();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    actions.markExported(now.toISOString());
    statusEl.textContent = `Saved ${name}: ${obj.counts.brews} brews, ${obj.counts.recipes} recipes.`;
  };

  const share = async () => {
    const { now, obj, json } = payload();
    const name = X.shareFilename(now);
    const file = new File([json], name, { type: X.SHARE_TYPE });
    const useDownload = 'Use ⬇ Download JSON instead, then send the file from your Files app or Drive.';
    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
      statusEl.textContent = `This phone can't share the backup file. ${useDownload}`;
      return;
    }
    try {
      await navigator.share({ files: [file], title: name });
      actions.markExported(now.toISOString());
      statusEl.textContent = `Shared ${name}: ${obj.counts.brews} brews. It's JSON inside; rename to .json on the laptop if you like.`;
    } catch (err) {
      statusEl.textContent = err?.name === 'AbortError'
        ? 'Share cancelled. Nothing was marked as backed up.'
        : `Android wouldn't share the file (${err?.name ?? 'error'}: ${err?.message ?? err}). ${useDownload}`;
    }
  };
  const canShareFiles = (() => {
    try { return Boolean(navigator.canShare?.({ files: [new File(['{}'], 'x.json.txt', { type: X.SHARE_TYPE })] })); } catch { return false; }
  })();

  el.append(
    h('h2', {}, 'Data'),
    h('h3', { class: 'section-title' }, 'Back up'),
    h('p', { class: 'field-hint' }, 'Everything lives only on this phone until you export it. The file holds every bean, rig, water, recipe, brew and assessment. Send it to your laptop or Drive.'),
    pendingEl,
    h('div', { class: 'derived' }, row('Last export', lastEl)),
    h('div', { class: 'alert-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', id: 'export-download', onclick: download }, '⬇ Download JSON'),
      canShareFiles ? h('button', { type: 'button', class: 'btn', id: 'export-share', onclick: share }, 'Share…') : null),
    statusEl,
    countsEl,

    h('h3', { class: 'section-title' }, 'App'),
    h('div', { class: 'derived' },
      row('Works offline', offlineEl),
      row('Storage', storageEl),
      row('Version', `v${APP_VERSION}`)),
    installEl,
    notifyEl);

  // ---- async status: storage, offline, install, notifications ----
  (async () => {
    try {
      const persisted = await navigator.storage?.persisted?.();
      const est = await navigator.storage?.estimate?.();
      const mb = est?.usage != null ? ` · ${(est.usage / 1_048_576).toFixed(1)} MB used` : '';
      storageEl.textContent = `${persisted ? 'protected from clearing' : 'may be cleared by the browser under pressure'}${mb}`;
    } catch { storageEl.textContent = 'unknown'; }
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      offlineEl.textContent = navigator.serviceWorker?.controller ? 'yes ✓' : reg ? 'after the next reload' : 'no (not installed yet)';
    } catch { offlineEl.textContent = 'unknown'; }
  })();

  function paintInstall() {
    const standalone = matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
    installEl.replaceChildren(standalone
      ? h('p', { class: 'ready', id: 'install-done' }, '✓ Installed: running from the home screen')
      : installPrompt
        ? h('button', { type: 'button', class: 'btn', id: 'install-app', onclick: async () => {
            const p = installPrompt; installPrompt = null;
            await p.prompt();
            paintInstall();
          } }, '📲 Install app')
        : h('p', { class: 'field-hint', id: 'install-hint' }, 'To install: Chrome menu ⋮ → Add to Home screen (or Install app).'));
  }

  function paintNotify() {
    if (!('Notification' in window)) { notifyEl.replaceChildren(h('p', { class: 'field-hint' }, 'This browser has no notifications.')); return; }
    const p = Notification.permission;
    notifyEl.replaceChildren(p === 'granted'
      ? h('p', { class: 'field-hint', id: 'notify-state' }, '✓ Notifications allowed: the cooled reminder can notify while the app is in the background.')
      : p === 'denied'
        ? h('p', { class: 'field-hint', id: 'notify-state' }, 'Notifications blocked. Allow them in Chrome site settings for the cooled reminder to reach you in the background.')
        : h('button', { type: 'button', class: 'btn', id: 'notify-allow', onclick: async () => { await Notification.requestPermission(); paintNotify(); } },
            '🔔 Allow notifications (cooled reminder)'));
  }

  function refresh(next) {
    state = next;
    const obj = X.buildExport(state, {});
    countsEl.replaceChildren(
      row('Brews', h('span', { id: 'count-brews' }, `${obj.counts.brews} (${obj.counts.assessedBrews} scored)`)),
      row('Recipes', String(obj.counts.recipes)),
      row('Beans · rigs · waters', `${obj.counts.beans} · ${obj.counts.rigs} · ${obj.counts.waters}`),
      row('Practice sessions', String(obj.counts.sessions)));
    lastEl.textContent = when(state.meta.lastExportAt);
    const pending = X.unexportedBrews(Object.values(state.sessions), state.meta.lastExportAt);
    pendingEl.replaceChildren(pending
      ? h('div', { class: 'alert alert-warn', id: 'data-unexported' }, h('strong', {}, `${pending} ${pending === 1 ? 'brew' : 'brews'} not backed up yet`))
      : obj.counts.brews === 0
        ? h('p', { class: 'field-hint', id: 'data-nobrews' }, 'No brews yet. Recipes, beans, rigs and waters still export.')
        : h('p', { class: 'ready', id: 'data-uptodate' }, '✓ Every brew is in your last export'));
    paintInstall();
    paintNotify();
  }

  refresh(state);
  return { el, refresh };
}
