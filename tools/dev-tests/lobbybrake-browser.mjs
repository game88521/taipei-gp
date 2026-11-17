// Three isolated Chrome contexts, a real local service and an HTTP-upgrade fault proxy.
// The proxy changes transport availability only; it never fabricates room messages.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { connect as connectTcp } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preview } from 'vite';
import { CdpConnection, instrument, click, focus, layout } from './multiplayer-ui-cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), own = path.resolve(here, '../..');
const project = path.resolve(process.env.LOBBYBRAKE_BROWSER_PROJECT ?? own);
const before = process.env.LOBBYBRAKE_EXPECT_BEFORE === '1';
const origin = 'http://127.0.0.1:4330', endpoint = 'ws://127.0.0.1:4331/ws';
const cdp = `http://127.0.0.1:${process.env.GP_MULTIPLAYER_CDP_PORT ?? 9334}`;
const evidence = path.join(here, `lobbybrake-browser-evidence-${Date.now()}`);
await mkdir(evidence);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { startedAt: new Date().toISOString(), before, project, localOnly: true, status: 'FAIL', cases: [], exceptions: [], externalRequests: [], layouts: [], screenshots: [], dialogs: [], sourceHashes: {} };
const sourceNames = ['src/multiplayer-client.ts', 'src/multiplayer-game.ts', 'src/multiplayer-entry.ts', 'src/multiplayer-ui.ts', 'src/multiplayer.css', 'shared/multiplayer-protocol.ts', 'server/room-service.mjs', 'multiplayer.html'];
for (const name of sourceNames) {
  try { report.sourceHashes[name] = digest(await readFile(path.join(project, name))); }
  catch (error) { if (!(before && name === 'src/multiplayer-entry.ts' && error.code === 'ENOENT')) throw error; }
}
report.scriptSha256 = digest(await readFile(fileURLToPath(import.meta.url)));
report.build = (await readFile(path.join(project, 'dist/sw.js'), 'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
const faults = { rejectNext: 0, hold: false }, transport = { upgrades: 0, rejected503: 0, held: 0, forwarded: 0 };
const connections = new Set(), pages = [], contexts = [], dialogPolicies = new Map();
let app, web, proxy, browser;
async function check(name, action) {
  try { report.cases.push({ name, status: 'PASS', details: await action() }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); throw error; }
  finally { console.log(JSON.stringify(report.cases.at(-1))); }
}
async function untilNode(action, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = action(); if (result) return result; await delay(25); }
  throw new Error(`Local service condition timed out: ${label}`);
}
const wireCount = (page, type) => page.evaluate(`__mpWire.filter(message => message.type === ${JSON.stringify(type)}).length`);
const value = (page, id, next) => page.evaluate(`(() => {const element = document.getElementById(${JSON.stringify(id)}); element.value = ${JSON.stringify(next)}; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return element.value;})()`);
async function selectTarget(page, id) {
  assert.equal(await value(page, 'mp-host-target', id), id);
  await page.until(`document.getElementById('mp-host-target').value === ${JSON.stringify(id)}`);
}
async function confirmClick(page, id, accept, during = null) {
  let handled = false;
  dialogPolicies.set(page, async event => {
    assert.equal(event.type, 'confirm');
    try { if (during) await during(); }
    finally { await page.send('Page.handleJavaScriptDialog', { accept }); handled = true; }
  });
  try { await focus(page); await click(page, id); await untilNode(() => handled, `${id} confirmation`); }
  finally { dialogPolicies.delete(page); }
}
async function openPage(label) {
  const browserContextId = (await browser.send('Target.createBrowserContext')).browserContextId;
  contexts.push(browserContextId);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const target = (await (await fetch(cdp + '/json')).json()).find(row => row.id === targetId);
  assert.ok(target);
  const page = new CdpConnection(target.webSocketDebuggerUrl, label, report); pages.push(page);
  const cancelledRequests = new Map();
  page.on('Runtime.exceptionThrown', event => report.exceptions.push({ label, ...event }));
  page.on('Network.loadingFailed', event => {
    if (event.canceled || event.errorText === 'net::ERR_ABORTED') cancelledRequests.set(event.requestId, event);
  });
  page.on('Page.javascriptDialogOpening', async event => {
    report.dialogs.push({ label, type: event.type, message: event.message });
    const policy = dialogPolicies.get(page);
    if (policy) await policy(event);
    else await page.send('Page.handleJavaScriptDialog', { accept: false });
  });
  page.on('Network.webSocketCreated', ({ url }) => { if (url !== endpoint) report.externalRequests.push(url); });
  page.on('Fetch.requestPaused', async ({ requestId, networkId, request }) => {
    const url = new URL(request.url), allowed = url.origin === origin || ['about:', 'data:', 'blob:'].includes(url.protocol);
    if (!allowed) report.externalRequests.push(request.url);
    try { await page.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...allowed ? {} : { errorReason: 'BlockedByClient' } }); }
    catch (error) {
      // AbortController may cancel a map request between Fetch's pause event
      // and this continuation. Accept only Chrome's precise stale-id response
      // with a matching Network.loadingFailed cancellation; preserve evidence.
      if (!allowed || !networkId || !String(error).includes('Invalid InterceptionId.')) throw error;
      const cancellation = await untilNode(() => cancelledRequests.get(networkId), 'matching cancelled intercepted request', 1500);
      (report.interceptionCancellations ??= []).push({ label, url: request.url, requestId, networkId, cancellation, cdpError: String(error) });
    }
  });
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
  await page.send('Network.setBypassServiceWorker', { bypass: true });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  // Route the configured endpoint to the real local fault proxy. Keep native
  // WebSocket handshakes/messages; observe all command types, never expose tokens.
  const source = instrument(origin, endpoint)
    .replace('constructor(url,protocols){', `constructor(url,protocols){url=${JSON.stringify(endpoint)};`)
    .replace("if(m.type==='input')", 'if(true)');
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.navigate', { url: origin + '/multiplayer.html?room=ABC234' });
  await page.until(`window.__mp && document.getElementById('mp-track').options.length > 0`, 150000);
  await value(page, 'mp-track', 'japan');
  await page.until(`__mp.ready && !document.getElementById('mp-create').disabled`, 150000);
  return page;
}

try {
  const { createMultiplayerServer } = await import(pathToFileURL(path.join(project, 'server/index.mjs')).href);
  app = createMultiplayerServer({ allowedOrigins: [origin] });
  await new Promise((resolve, reject) => { app.httpServer.once('error', reject); app.httpServer.listen(0, '127.0.0.1', resolve); });
  const backendPort = app.httpServer.address().port;
  report.backend = { host: '127.0.0.1', port: backendPort, realService: true };
  proxy = createServer((request, response) => { response.writeHead(404); response.end(); });
  proxy.on('connection', socket => { connections.add(socket); socket.once('close', () => connections.delete(socket)); socket.on('error', () => {}); });
  proxy.on('upgrade', (request, socket, head) => {
    transport.upgrades++;
    if (request.url !== '/ws') { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    if (faults.hold) { transport.held++; return; }
    if (faults.rejectNext > 0) {
      faults.rejectNext--; transport.rejected503++;
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
    }
    transport.forwarded++;
    const upstream = connectTcp({ host: '127.0.0.1', port: backendPort });
    connections.add(upstream); upstream.once('close', () => connections.delete(upstream));
    upstream.on('error', () => socket.destroy()); socket.once('close', () => upstream.destroy()); upstream.once('close', () => socket.destroy());
    upstream.once('connect', () => {
      let headers = `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n`;
      for (let i = 0; i < request.rawHeaders.length; i += 2) headers += `${request.rawHeaders[i]}: ${request.rawHeaders[i + 1]}\r\n`;
      upstream.write(headers + '\r\n'); if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
  });
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(4331, '127.0.0.1', resolve); });
  web = await preview({ root: project, preview: { host: '127.0.0.1', port: 4330, strictPort: true }, logLevel: 'error' });
  const version = await (await fetch(cdp + '/json/version')).json();
  browser = new CdpConnection(version.webSocketDebuggerUrl, 'browser', report);
  const host = await openPage('host');
  if (before) {
    await check('before_has_no_wait_cancel_retry_or_host_management_controls', async () => {
      const state = await host.evaluate(`({ sockets: __mpSocketCount, room: __mp.client.room, absent: ['mp-entry-wait','mp-cancel-connect','mp-entry-retry','mp-host-controls','mp-host-target','mp-host-transfer','mp-host-kick'].every(id => document.getElementById(id) === null) })`);
      assert.equal(state.sockets, 0); assert.equal(state.room, null); assert.equal(state.absent, true);
      assert.equal(report.build, 'f8ca4b1d251c'); return state;
    });
  } else {
    const guest = await openPage('guest'), third = await openPage('third');
    let code, room, hostId, guestId, thirdId;
    await check('entry_is_explicit_and_real_503_handshakes_retry_before_one_create', async () => {
      for (const page of pages) assert.equal(await page.evaluate('__mpSocketCount'), 0);
      await value(host, 'mp-name', '房主甲'); faults.rejectNext = 2;
      await focus(host); await click(host, 'mp-create');
      await host.until(`!document.getElementById('mp-entry-wait').hidden && document.getElementById('mp-entry-progress').textContent.includes('重試')`);
      code = await host.until('__mp.client.room?.code', 25000);
      hostId = await host.evaluate('__mp.client.selfId'); room = app.service.rooms.get(code); assert.ok(room);
      assert.equal(transport.rejected503, 2); assert.equal(await host.evaluate('__mpSocketCount'), 3);
      assert.equal(await wireCount(host, 'create'), 1); assert.equal(app.service.rooms.size, 1);
      return { failedHandshakes: 2, socketAttempts: 3, createCommands: 1, rooms: 1 };
    });
    await value(guest, 'mp-name', '車手乙'); await value(guest, 'mp-code', code); faults.hold = true;
    await focus(guest); await click(guest, 'mp-join');
    await guest.until(`!document.getElementById('mp-entry-wait').hidden`);
    await check('waiting_cancel_is_reachable_in_three_viewports', async () => {
      await focus(guest); await layout(guest, 'lobbybrake-wait', '#mp-entry-wait', report, evidence);
      assert.equal(await wireCount(guest, 'join'), 0); return { viewports: 3, entryCommandsBeforeHandshake: 0 };
    });
    await check('cancel_preserves_fields_stops_late_retry_and_manual_join_sends_once', async () => {
      await click(guest, 'mp-cancel-connect');
      await guest.until(`document.getElementById('mp-message').textContent.includes('已取消連線') && !document.getElementById('mp-join').disabled`);
      const attempts = await guest.evaluate('__mpSocketCount'); faults.hold = false;
      await delay(2000); assert.equal(await guest.evaluate('__mpSocketCount'), attempts);
      assert.equal(await guest.evaluate('__mp.client.room'), null); assert.equal(await wireCount(guest, 'join'), 0);
      assert.equal(await guest.evaluate(`document.getElementById('mp-name').value`), '車手乙');
      assert.equal(await guest.evaluate(`document.getElementById('mp-code').value`), code);
      await focus(guest); await click(guest, 'mp-join'); await guest.until(`__mp.client.room?.code === ${JSON.stringify(code)}`);
      guestId = await guest.evaluate('__mp.client.selfId'); assert.equal(await wireCount(guest, 'join'), 1);
      return { cancelledSocketAttempts: attempts, quietPeriodMs: 2000, preservedNameAndCode: true, joinCommands: 1 };
    });
    await check('manual_retry_control_is_reachable_and_uses_edited_room_code', async () => {
      await value(third, 'mp-name', '車手丙'); await value(third, 'mp-code', 'ZZZ999');
      assert.equal(app.service.rooms.has('ZZZ999'), false);
      await focus(third); await click(third, 'mp-join');
      await third.until(`!document.getElementById('mp-entry-retry').hidden && !document.getElementById('mp-entry-retry').disabled`);
      assert.equal(await wireCount(third, 'join'), 1); assert.equal(await third.evaluate('__mp.client.room'), null);
      await layout(third, 'lobbybrake-retry', '#mp-entry', report, evidence);
      assert.equal(await wireCount(third, 'join'), 1, 'Room-entry failures are not automatically replayed');
      await value(third, 'mp-code', code); await focus(third); await click(third, 'mp-entry-retry');
      await third.until(`__mp.client.room?.code === ${JSON.stringify(code)}`); thirdId = await third.evaluate('__mp.client.selfId');
      for (const page of pages) await page.until(`__mp.ready && __mp.client.room.players.length === 3 && __mp.client.room.players.every(player => player.loaded)`, 150000);
      assert.equal(await wireCount(third, 'join'), 2); return { manualAttempts: 2, commandsPerAttempt: 1, actualPlayers: room.players.size, viewports: 3 };
    });
    await check('cancelled_confirmation_and_offline_target_do_not_transfer_host', async () => {
      await selectTarget(host, thirdId); const beforeCommands = await wireCount(host, 'transfer-host');
      await confirmClick(host, 'mp-host-transfer', false);
      assert.equal(room.hostId, hostId); assert.equal(await wireCount(host, 'transfer-host'), beforeCommands);
      await confirmClick(host, 'mp-host-transfer', true, async () => {
        // A genuine peer transport close while the other context's native modal
        // is open. No room state or target snapshot is injected into the UI.
        await third.evaluate('__mp.client.disconnect()');
        await untilNode(() => room.players.get(thirdId)?.connected === false, 'target disconnected during confirmation');
      });
      await host.until(`__mp.client.room.players.find(player => player.id === ${JSON.stringify(thirdId)})?.connected === false`);
      assert.equal(room.hostId, hostId); assert.equal(await host.evaluate('__mp.client.room.hostId'), hostId);
      await third.evaluate('__mp.client.restore()');
      for (const page of pages) await page.until(`__mp.ready && __mp.client.room.players.every(player => player.connected && player.loaded)`, 150000);
      return { cancelSentNoCommand: true, offlineTargetBecameHost: false, peerRestoredThroughRealTransport: true };
    });
    await check('host_transfer_updates_all_three_clients_and_permissions', async () => {
      await selectTarget(host, guestId); await confirmClick(host, 'mp-host-transfer', true);
      for (const page of pages) await page.until(`__mp.client.room.hostId === ${JSON.stringify(guestId)}`);
      assert.equal(room.hostId, guestId);
      assert.equal(await host.evaluate(`document.getElementById('mp-host-controls').hidden`), true);
      assert.equal(await guest.evaluate(`document.getElementById('mp-host-controls').hidden`), false);
      assert.equal(await third.evaluate(`document.getElementById('mp-host-controls').hidden`), true);
      assert.equal(await host.evaluate(`document.getElementById('mp-start').hidden`), true);
      return { newHost: guestId, oldHostControlsHidden: true, guestBecameManager: true, clients: 3 };
    });
    await check('host_management_controls_are_reachable_in_three_viewports', async () => {
      await focus(guest); await layout(guest, 'lobbybrake-host', '#mp-host-controls', report, evidence);
      return { viewports: 3, controls: ['mp-host-target', 'mp-host-transfer', 'mp-host-kick'] };
    });
    await check('kick_notifies_clears_session_and_does_not_automatically_reconnect', async () => {
      assert.equal(await host.evaluate(`sessionStorage.getItem('taipei-gp-multiplayer-session-v2') !== null`), true);
      await selectTarget(guest, hostId); await confirmClick(guest, 'mp-host-kick', true);
      await host.until(`__mp.client.room === null && __mp.client.error?.includes('房主已將你移出')`);
      assert.equal(await host.evaluate(`sessionStorage.getItem('taipei-gp-multiplayer-session-v2')`), null);
      assert.equal(await host.evaluate('__mp.client.hasSavedSession'), false);
      assert.equal(room.players.has(hostId), false); assert.equal(room.removedPlayerIds.has(hostId), true);
      const sockets = await host.evaluate('__mpSocketCount'), resume = await wireCount(host, 'resume');
      await delay(2000); assert.equal(await host.evaluate('__mpSocketCount'), sockets); assert.equal(await wireCount(host, 'resume'), resume);
      return { sessionRemoved: true, revokedIdentity: true, quietPeriodMs: 2000, automaticReconnects: 0 };
    });
    await check('kicked_player_can_manually_rejoin_with_a_new_identity', async () => {
      await value(host, 'mp-code', code); const previousJoins = await wireCount(host, 'join');
      await focus(host); await click(host, 'mp-join');
      await host.until(`__mp.client.room?.code === ${JSON.stringify(code)} && __mp.client.selfId !== ${JSON.stringify(hostId)}`);
      const newId = await host.evaluate('__mp.client.selfId');
      assert.ok(newId && newId !== hostId); assert.equal(await wireCount(host, 'join'), previousJoins + 1);
      assert.equal(room.players.size, 3); assert.equal(room.hostId, guestId);
      return { oldIdentityRevoked: !room.players.has(hostId), newIdentity: newId, joinCommands: 1, players: 3 };
    });
  }
  assert.deepEqual(report.exceptions, []); assert.deepEqual(report.externalRequests, []); report.status = 'PASS';
} catch (error) {
  report.error = error.stack ?? String(error); console.error(report.error); process.exitCode = 1;
} finally {
  const cleanup = async (label, operation) => {
    try { await operation(); }
    catch (error) { (report.cleanupErrors ??= []).push({ label, error: String(error) }); report.cleanupError = 'One or more local resources could not be cleaned up'; report.status = 'FAIL'; process.exitCode = 1; }
  };
  for (const page of pages) {
    await page.evaluate('__mp.client?.leave()').catch(() => {}); page.close();
  }
  for (const browserContextId of contexts) await cleanup('dispose browser context', () => browser?.send('Target.disposeBrowserContext', { browserContextId }));
  browser?.close();
  for (const socket of connections) socket.destroy();
  if (proxy?.listening) await cleanup('close upgrade fault proxy', () => new Promise(resolve => proxy.close(resolve)));
  await cleanup('close real local multiplayer service', () => app?.close());
  if (web) await cleanup('close Vite preview', () => new Promise(resolve => web.httpServer.close(resolve)));
  try {
    for (const [name, expected] of Object.entries(report.sourceHashes)) assert.equal(digest(await readFile(path.join(project, name))), expected, `Product changed while browser test ran: ${name}`);
    report.sourceUnchangedDuringTests = true;
  } catch (error) { report.sourceUnchangedDuringTests = false; report.sourceError = String(error); report.status = 'FAIL'; process.exitCode = 1; }
  report.cleanupComplete = !report.cleanupError && !proxy?.listening && !app?.httpServer.listening && !web?.httpServer.listening;
  report.transport = transport; report.contexts = contexts.length; report.completedAt = new Date().toISOString();
  report.limitations = ['新版使用本機三個隔離Chrome contexts與真WebSocket，不是外網、跨裝置或手機實機。', 'HTTP upgrade proxy只安排503／握手等待並轉發真後端；不測Render實際冷啟動秒數或服務方案。', '玩家離線案例由真client.disconnect關閉傳輸，再以真restore恢復；未模擬作業系統網路切換。', '視窗尺寸與DOM命中檢查不代表實機觸控、FPS或耗電；確認視窗由CDP接受／取消，未使用系統分享或傳送訊息。'];
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(here, before ? 'lobbybrake-browser-before.json' : 'lobbybrake-browser-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, before, cases: report.cases.length, build: report.build, evidence }));
}
