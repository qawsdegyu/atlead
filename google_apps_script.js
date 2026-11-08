/**
 * ==============================================================================
 * GOOGLE APPS SCRIPT - ATLEAD GOOGLE SHEETS CONNECTOR (طريقة بديلة)
 * الطريقة الموصى بها هي Service Account من صفحة الإعدادات. استخدم هذا الكود فقط
 * إذا ما بدك تعمل Service Account.
 * ==============================================================================
 * 1. افتح الشيت ← Extensions ← Apps Script ← الصق الكود ← Save.
 * 2. Deploy ← New deployment ← Web app ← Execute as: Me ← Who has access: Anyone.
 * 3. انسخ رابط Web App والصقه بخانة "Webhook" بإعدادات Google Sheets.
 *
 * كل عميل = صف واحد (العمود الأول = ID العميل)، وكل تحديث بيعدّل نفس الصف.
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var data = JSON.parse(e.postData.contents);
    var headers = data.headers;
    var row = data.row;
    if (!headers || !row) {
      return json({ status: 'error', message: 'No row data provided' });
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Leads')
      || SpreadsheetApp.getActiveSpreadsheet().insertSheet('Leads');
    sheet.setRightToLeft(true);

    // Header row
    var firstRow = sheet.getLastRow() > 0 ? sheet.getRange(1, 1, 1, headers.length).getValues()[0] : [];
    if (firstRow.join('|') !== headers.join('|')) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers])
        .setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }

    // Find existing row by lead ID (column A)
    var lastRow = sheet.getLastRow();
    var targetRow = -1;
    if (lastRow > 1) {
      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(row[0])) { targetRow = i + 2; break; }
      }
    }
    if (targetRow === -1) targetRow = lastRow + 1;

    // Write as plain text (no formulas)
    sheet.getRange(targetRow, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    return json({ status: 'success', row: targetRow });
  } catch (err) {
    return json({ status: 'error', message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
