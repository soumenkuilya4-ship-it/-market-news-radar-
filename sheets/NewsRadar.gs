/**
 * Market Radar -> MASTER SHEET bridge (Google Apps Script).
 *
 * Every 15 minutes this reads the rows on the 9_News_Radar tab (Type, Symbol, Name),
 * asks your Market Radar app for the latest news on each one, and writes the results
 * to the News_Live tab. The 9_News_Radar formulas show News_Live first and fall back to
 * your Tab 4 data when there is no news for a row.
 *
 * Setup (once):
 *  1. In the MASTER SHEET: Extensions > Apps Script. Paste this whole file, replacing what is there.
 *  2. Set MARKET_RADAR_URL below to your https://....ts.net address (from "Enable phone access.cmd").
 *  3. Pick "updateNewsRadar" in the function menu and click Run. Allow the permissions it asks for.
 *  4. Pick "installTrigger" and click Run, so it repeats every 15 minutes.
 *     (If installTrigger fails, add the trigger by hand: clock icon > Add Trigger >
 *      updateNewsRadar, Time-driven, Minutes timer, Every 15 minutes.)
 */
const MARKET_RADAR_URL = 'https://YOUR-PC-NAME.YOUR-TAILNET.ts.net';
// Optional: the "Phone access code" from Settings on your PC. With it, your own
// Manual Posts are included in the radar; without it only the public feeds are used.
const MARKET_RADAR_CODE = '';

const SOURCE_TAB = '9_News_Radar';
const SOURCE_FIRST_ROW = 5;
const LIVE_TAB = 'News_Live';
const HEADERS = ['Key', 'Type', 'Symbol', '📰 Latest headline', 'Sentiment', '🚀 Catalysts', '⚠️ Risks / Red Flags', 'Radar Action', 'Stories', 'Latest at', 'Link'];

function updateNewsRadar() {
  const ss = SpreadsheetApp.getActive();
  const src = ss.getSheetByName(SOURCE_TAB);
  const live = ss.getSheetByName(LIVE_TAB) || ss.insertSheet(LIVE_TAB);
  const status = live.getRange('M1');
  const last = src.getLastRow();
  if (last < SOURCE_FIRST_ROW) return;

  const rows = src.getRange(SOURCE_FIRST_ROW, 1, last - SOURCE_FIRST_ROW + 1, 3).getValues()
    .filter((r) => r[0] && r[1])
    .map((r) => ({ type: String(r[0]).trim(), key: String(r[1]).trim(), name: String(r[2] || '').trim() }));

  let data;
  try {
    const res = UrlFetchApp.fetch(MARKET_RADAR_URL.replace(/\/+$/, '') + '/api/radar', {
      method: 'post',
      contentType: 'application/json',
      headers: MARKET_RADAR_CODE ? { 'X-App-Token': MARKET_RADAR_CODE } : {},
      payload: JSON.stringify({ rows: rows }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
    data = JSON.parse(res.getContentText());
  } catch (e) {
    // Keep the last good data; just record why this update failed (usually: PC is off).
    status.setValue('⚠️ Update failed ' + stamp_() + ': ' + e.message + ' — is the PC with Market Radar on?');
    return;
  }

  const out = data.rows.map((r) => [r.key, r.type, r.symbol, r.headline, r.sentiment, r.catalysts, r.risks, r.action, r.stories, new Date(r.latestAt), r.url]);
  live.getRange(1, 1, live.getMaxRows(), HEADERS.length).clearContent();
  live.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  if (out.length) live.getRange(2, 1, out.length, HEADERS.length).setValues(out);
  live.setFrozenRows(1);
  status.setValue('✅ Updated ' + stamp_() + ' · ' + out.length + ' of ' + rows.length + ' rows had news in the last ' + data.days + ' days');
}

function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'updateNewsRadar')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('updateNewsRadar').timeBased().everyMinutes(15).create();
}

function stamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd MMM HH:mm') + ' IST';
}
