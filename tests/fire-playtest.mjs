/**
 * Playtest 救火挑戰: options at bottom, correct→spray→walk, wrong→flare.
 * Saves screenshots to previews/v6_*.png
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PREV = path.join(ROOT, 'previews');
fs.mkdirSync(PREV, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let url = decodeURIComponent((req.url || '/').split('?')[0]);
      if (url === '/') url = '/index.html';
      const file = path.join(ROOT, url.replace(/^\//, ''));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('missing'); return;
      }
      const ext = path.extname(file);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}/` });
    });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { ok: true, checks: [], errors: [] };

function check(name, cond, detail = '') {
  results.checks.push({ name, pass: !!cond, detail });
  if (!cond) results.ok = false;
  console.log(cond ? 'PASS' : 'FAIL', name, detail || '');
}

const { server, base } = await startServer();
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
page.on('pageerror', (e) => results.errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') results.errors.push('console: ' + m.text());
});

const T0 = Date.now();
const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(1) + 's', ...a);

try {
  log('goto', base);
  await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('#fireStart', { timeout: 15000 });
  await page.screenshot({ path: path.join(PREV, 'v6_home.png') });

  log('start fire mode');
  await page.click('#fireStart');
  await page.waitForSelector('#fire:not(.hide)', { timeout: 10000 });
  await page.waitForSelector('#fire3d canvas', { timeout: 15000 });
  await wait(1800); // let three.js init + first frame

  // Layout: options must be inside .fire-panel, NOT overlaid mid-corridor
  const layout = await page.evaluate(() => {
    const opts = document.getElementById('fireOpts');
    const panel = document.querySelector('.fire-panel');
    const corridor = document.getElementById('corridor');
    const cr = corridor.getBoundingClientRect();
    const or = opts.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    const inPanel = panel.contains(opts);
    const midOverlay = or.top < cr.bottom - 40 && or.bottom > cr.top + 40 && !inPanel;
    // options should be below corridor bottom (or overlapping panel which is below)
    const belowCorridor = or.top >= cr.bottom - 8;
    return {
      inPanel,
      midOverlay,
      belowCorridor,
      optsTop: or.top,
      corridorBottom: cr.bottom,
      panelTop: pr.top,
      optCount: opts.querySelectorAll('button.opt').length,
      bubbleCount: opts.querySelectorAll('.bubble').length,
      hasCanvas: !!document.querySelector('#fire3d canvas')
    };
  });
  log('layout', JSON.stringify(layout));
  check('options in fire-panel', layout.inPanel);
  check('options NOT mid-screen overlay', !layout.midOverlay && layout.belowCorridor, `optsTop=${layout.optsTop} corrBottom=${layout.corridorBottom}`);
  check('no bubble class', layout.bubbleCount === 0, `bubbles=${layout.bubbleCount}`);
  check('has opt buttons', layout.optCount >= 2, `opts=${layout.optCount}`);
  check('3d canvas present', layout.hasCanvas);
  await page.screenshot({ path: path.join(PREV, 'v6_zone0_idle.png'), fullPage: true });

  // Find correct answer index via __p2quiz
  const ans0 = await page.evaluate(() => {
    const qs = window.__p2quiz.getQs();
    return qs[0].ans;
  });
  log('ans0', ans0, 'remaining', await page.evaluate(() => window.__p2quiz.getFire()));

  // Click correct
  await page.click(`#fireOpts button.opt:nth-child(${ans0 + 1})`);
  await wait(500);
  await page.screenshot({ path: path.join(PREV, 'v6_spray.png'), fullPage: true });

  // Wait for playCorrect to finish (spray + extinguish + walk ~2.5s)
  await page.waitForFunction(() => {
    const n = document.getElementById('fireNext');
    return n && !n.classList.contains('hide');
  }, null, { timeout: 12000 });
  await wait(400);

  const afterCorrect = await page.evaluate(() => ({
    remaining: window.__p2quiz.getFire(),
    zone: window.__p2quiz.getZone(),
    fb: document.getElementById('fireFb').innerText.slice(0, 80),
    optsDim: document.getElementById('fireOpts').classList.contains('dim')
  }));
  log('afterCorrect', afterCorrect);
  check('fire decreased after correct', afterCorrect.remaining === 4, `rem=${afterCorrect.remaining}`);
  check('walked to zone 1', afterCorrect.zone === 1, `zone=${afterCorrect.zone}`);
  check('feedback mentions extinguish/advance', /熄|前進|救火/.test(afterCorrect.fb), afterCorrect.fb);
  await page.screenshot({ path: path.join(PREV, 'v6_after_walk.png'), fullPage: true });

  // Next question then wrong answer
  await page.click('#fireNext');
  await wait(600);
  const ans1 = await page.evaluate(() => window.__p2quiz.getQs()[1].ans);
  const wrong = ans1 === 0 ? 1 : 0;
  log('ans1', ans1, 'pick wrong', wrong);
  await page.click(`#fireOpts button.opt:nth-child(${wrong + 1})`);
  await wait(350);
  const flared = await page.evaluate(() => document.getElementById('corridor').classList.contains('flare'));
  // flare class may already have timed out — check remaining unchanged after wrong
  await page.waitForFunction(() => {
    const n = document.getElementById('fireNext');
    return n && !n.classList.contains('hide');
  }, null, { timeout: 8000 });
  const afterWrong = await page.evaluate(() => ({
    remaining: window.__p2quiz.getFire(),
    zone: window.__p2quiz.getZone(),
    fb: document.getElementById('fireFb').innerText.slice(0, 60)
  }));
  log('afterWrong', afterWrong, 'flareSeen', flared);
  check('wrong keeps fire level', afterWrong.remaining === 4, `rem=${afterWrong.remaining}`);
  check('wrong stays on same zone', afterWrong.zone === 1, `zone=${afterWrong.zone}`);
  check('wrong feedback', /答錯|火勢/.test(afterWrong.fb), afterWrong.fb);
  await page.screenshot({ path: path.join(PREV, 'v6_flare.png'), fullPage: true });

  // One more correct to confirm spray+walk still works from zone 1 → 2
  await page.click('#fireNext');
  await wait(500);
  const ans2 = await page.evaluate(() => window.__p2quiz.getQs()[2].ans);
  await page.click(`#fireOpts button.opt:nth-child(${ans2 + 1})`);
  await page.waitForFunction(() => {
    const n = document.getElementById('fireNext');
    return n && !n.classList.contains('hide') && window.__p2quiz.getZone() >= 2;
  }, null, { timeout: 15000 }).catch(() => {});
  await wait(300);
  const after2 = await page.evaluate(() => ({
    remaining: window.__p2quiz.getFire(),
    zone: window.__p2quiz.getZone()
  }));
  log('after2', after2);
  check('second correct extinguishes', after2.remaining === 3, `rem=${after2.remaining}`);
  check('walked to zone 2', after2.zone === 2, `zone=${after2.zone}`);
  await page.screenshot({ path: path.join(PREV, 'v6_zone2.png'), fullPage: true });

  // Re-check layout still bottom after gameplay
  const layout2 = await page.evaluate(() => {
    const opts = document.getElementById('fireOpts');
    const corridor = document.getElementById('corridor');
    const cr = corridor.getBoundingClientRect();
    const or = opts.getBoundingClientRect();
    return {
      inPanel: document.querySelector('.fire-panel').contains(opts),
      below: or.top >= cr.bottom - 8
    };
  });
  check('layout still bottom after play', layout2.inPanel && layout2.below, JSON.stringify(layout2));

} catch (e) {
  results.ok = false;
  results.errors.push(String(e && e.stack || e));
  console.error('PLAYTEST ERROR', e);
  try { await page.screenshot({ path: path.join(PREV, 'v6_error.png'), fullPage: true }); } catch (_) {}
}

const pageErrors = results.errors.filter((e) => !/favicon|AudioContext|autoplay/i.test(e));
check('no critical page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

fs.writeFileSync(path.join(PREV, 'v6_playtest.json'), JSON.stringify(results, null, 2));
console.log('\n=== SUMMARY ===');
console.log(results.ok ? 'ALL PASSED' : 'FAILED');
console.log('checks', results.checks.filter(c => c.pass).length + '/' + results.checks.length);

await browser.close();
server.close();
process.exit(results.ok ? 0 : 1);
