import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const BUILD_ID = '2848-align-2026-01-22-h';

const IRS_TEXT_SIZE = 8.5;

const POS = {
  acts_desc_1: { x: 37,  y: 240, size: IRS_TEXT_SIZE },
  acts_form_1: { x: 330, y: 240, size: IRS_TEXT_SIZE },
  acts_year_1: { x: 474, y: 240, size: IRS_TEXT_SIZE },

  acts_desc_2: { x: 40,  y: 205, size: IRS_TEXT_SIZE },
  acts_form_2: { x: 330, y: 205, size: IRS_TEXT_SIZE },
  acts_year_2: { x: 474, y: 205, size: IRS_TEXT_SIZE },

  acts_desc_3: { x: 40,  y: 180, size: IRS_TEXT_SIZE },
  acts_form_3: { x: 330, y: 180, size: IRS_TEXT_SIZE },
  acts_year_3: { x: 474, y: 180, size: IRS_TEXT_SIZE },

  line5aAccessISP_Check:           { x: 230, y: 137 },
  line5aAuthorizeDisclosure_Check: { x: 55,  y: 130 },
  line5aSignReturn_Check:          { x: 560, y: 130 },
  line5aSubAddRep_Check:           { x: 230, y: 126 },

  repBlock: { x: 40, y: 565, lineGap: 11, size: IRS_TEXT_SIZE },

  repCAF:  { x: 395, y: 578, size: IRS_TEXT_SIZE },
  repPTIN: { x: 396, y: 566, size: IRS_TEXT_SIZE },
  repTel:  { x: 413, y: 554, size: IRS_TEXT_SIZE },
  repFax:  { x: 405, y: 542, size: IRS_TEXT_SIZE },

  taxpayerNameAddressBlock: { x: 40, y: 640, lineGap: 9, size: IRS_TEXT_SIZE },
  taxpayerTIN: { x: 348, y: 640, size: IRS_TEXT_SIZE },
};

function clean(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (s.startsWith('{{') && s.endsWith('}}')) return '';
  return s;
}

function formatTin(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 9) return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  return raw;
}

function formatPeriod(yearFrom, yearTo) {
  const a = String(yearFrom || '').trim();
  const b = String(yearTo || '').trim();
  if (a && b) return `${a} through ${b}`;
  return a || b || '';
}

function splitMatter(s) {
  const text = String(s || '').trim();
  if (!text) return ['', ''];
  const targetBreak = 'Estate';
  const idx = text.indexOf(targetBreak);
  if (idx > 0) {
    const line1 = text.slice(0, idx).trim().replace(/,\s*$/, '') + ',';
    const line2 = text.slice(idx).trim();
    return [line1, line2];
  }
  const mid = Math.floor(text.length / 2);
  const left = text.lastIndexOf(',', mid);
  const right = text.indexOf(',', mid);
  const cut = (right !== -1 && (mid - left) > (right - mid)) ? right : left;
  if (cut > 0) return [text.slice(0, cut + 1).trim(), text.slice(cut + 1).trim()];
  return [text, ''];
}

function splitForms(s) {
  const text = String(s || '').trim();
  if (!text) return ['', ''];
  const line1 = '940, 941, 720';
  const line2 = '1040, 1120, 1120S';
  if (text.replace(/\s+/g, ' ') === `${line1}, ${line2}`) return [line1, line2];
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 3) return [parts.join(', '), ''];
  return [parts.slice(0, 3).join(', '), parts.slice(3).join(', ')];
}

function splitYears(s) {
  const text = String(s || '').trim();
  if (!text) return ['', ''];
  const token = 'through';
  const i = text.indexOf(token);
  if (i !== -1) {
    const a = text.slice(0, i).trim();
    const b = text.slice(i + token.length).trim();
    return [a, `through ${b}`.trim()];
  }
  return [text, ''];
}

function drawMultiline(page, text, x, y, size, lineGap, font) {
  const lines = (text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  let cy = y;
  for (const line of lines) {
    page.drawText(line, { x, y: cy, size, font, color: rgb(0, 0, 0) });
    cy -= lineGap;
  }
}

function drawCheck(page, x, y, font) {
  page.drawText('X', { x: x + 1, y: y - 3, size: 8, font, color: rgb(0, 0, 0) });
}

function todayTokenYYYY_MMDD() {
  const d = new Date();
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}_${m}${dd}`;
}

export function buildFilename(input) {
  const last = clean(input.clientLastName) || 'ClientLastName';
  const first = clean(input.clientFirstName) || 'ClientFirstName';
  return `Form_2848_${last}_${first}_DateSigned_${todayTokenYYYY_MMDD()}_p1`;
}

export async function generate2848Pdf(input, templateBytes) {
  const data = {
    TaxpayerSSNITIN: clean(input.TaxpayerSSNITIN),

    clientAddressLine1: clean(input.clientAddressLine1),
    clientAddressLine2: clean(input.clientAddressLine2),
    clientAddressRegion: clean(input.clientAddressRegion),
    clientAddressTown: clean(input.clientAddressTown),
    clientAddressZip: clean(input.clientAddressZip),
    clientFirstName: clean(input.clientFirstName),
    clientLastName: clean(input.clientLastName),

    line3DescriptionOfMatter:
      clean(input.line3DescriptionOfMatter) ||
      'Income, Employment, Payroll, Excise, Estate, Gift, Civil Penalty, Sec. 4980H Shared Responsibility Payment',
    line3TaxFormNumber: clean(input.line3TaxFormNumber) || '940, 941, 720, 1040, 1120, 1120S',

    line5aAccessRecords: input.line5aAccessRecords !== false,
    line5aAuthorizeDisclosure: input.line5aAuthorizeDisclosure === true,
    line5aSignReturn: input.line5aSignReturn === true,
    line5aSubstituteOrAddRep: input.line5aSubstituteOrAddRep !== false,

    repAddr1: clean(input.repAddr1),
    repAddr2: clean(input.repAddr2),
    repCAF: clean(input.repCAF),
    repCity: clean(input.repCity),
    repFax: clean(input.repFax),
    repFirst: clean(input.repFirst),
    repLast: clean(input.repLast),
    repPTIN: clean(input.repPTIN),
    repState: clean(input.repState),
    repTel: clean(input.repTel),
    repZip: clean(input.repZip),

    yearFrom: clean(input.yearFrom),
    yearTo: clean(input.yearTo),
  };

  const pdfDoc = await PDFDocument.load(templateBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page1 = pdfDoc.getPages()[0];
  const { width, height } = page1.getSize();
  page1.setCropBox(0, 0, width, height);

  const taxpayerName = [data.clientFirstName, data.clientLastName].filter(Boolean).join(' ').trim();
  const repName = [data.repFirst, data.repLast].filter(Boolean).join(' ').trim();

  const repAddr12 = [data.repAddr1, data.repAddr2].filter(Boolean).join(' ').trim();
  const repCityStateZip =
    [data.repCity, data.repState].filter(Boolean).join(', ') + (data.repZip ? ' ' + data.repZip : '');
  const repBlockText = [repName, repAddr12, repCityStateZip]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join('\n');

  const taxpayerAddr12 = [data.clientAddressLine1, data.clientAddressLine2].filter(Boolean).join(' ').trim();
  const taxpayerCityStateZip =
    [data.clientAddressTown, data.clientAddressRegion].filter(Boolean).join(', ') +
    (data.clientAddressZip ? ' ' + data.clientAddressZip : '');
  const taxpayerNameAddress = [taxpayerName, taxpayerAddr12, taxpayerCityStateZip]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join('\n');

  const periodText = formatPeriod(data.yearFrom, data.yearTo);

  drawMultiline(
    page1,
    taxpayerNameAddress,
    POS.taxpayerNameAddressBlock.x,
    POS.taxpayerNameAddressBlock.y,
    POS.taxpayerNameAddressBlock.size,
    POS.taxpayerNameAddressBlock.lineGap,
    font,
  );

  page1.drawText(formatTin(data.TaxpayerSSNITIN), {
    x: POS.taxpayerTIN.x,
    y: POS.taxpayerTIN.y,
    size: POS.taxpayerTIN.size,
    font,
    color: rgb(0, 0, 0),
  });

  drawMultiline(
    page1,
    repBlockText,
    POS.repBlock.x,
    POS.repBlock.y,
    POS.repBlock.size,
    POS.repBlock.lineGap,
    font,
  );

  page1.drawText(data.repCAF, { x: POS.repCAF.x, y: POS.repCAF.y, size: POS.repCAF.size, font, color: rgb(0, 0, 0) });
  page1.drawText(data.repPTIN, { x: POS.repPTIN.x, y: POS.repPTIN.y, size: POS.repPTIN.size, font, color: rgb(0, 0, 0) });
  page1.drawText(data.repTel, { x: POS.repTel.x, y: POS.repTel.y, size: POS.repTel.size, font, color: rgb(0, 0, 0) });
  page1.drawText(data.repFax, { x: POS.repFax.x, y: POS.repFax.y, size: POS.repFax.size, font, color: rgb(0, 0, 0) });

  const lineGap = 9;

  const matterLines = splitMatter(data.line3DescriptionOfMatter);
  if (matterLines[0]) page1.drawText(matterLines[0], { x: POS.acts_desc_1.x, y: POS.acts_desc_1.y, size: POS.acts_desc_1.size, font, color: rgb(0, 0, 0) });
  if (matterLines[1]) page1.drawText(matterLines[1], { x: POS.acts_desc_1.x, y: POS.acts_desc_1.y - lineGap, size: POS.acts_desc_1.size, font, color: rgb(0, 0, 0) });

  const formLines = splitForms(data.line3TaxFormNumber);
  if (formLines[0]) page1.drawText(formLines[0], { x: POS.acts_form_1.x, y: POS.acts_form_1.y, size: POS.acts_form_1.size, font, color: rgb(0, 0, 0) });
  if (formLines[1]) page1.drawText(formLines[1], { x: POS.acts_form_1.x, y: POS.acts_form_1.y - lineGap, size: POS.acts_form_1.size, font, color: rgb(0, 0, 0) });

  const yearsLines = splitYears(periodText);
  if (yearsLines[0]) page1.drawText(yearsLines[0], { x: POS.acts_year_1.x, y: POS.acts_year_1.y, size: POS.acts_year_1.size, font, color: rgb(0, 0, 0) });
  if (yearsLines[1]) page1.drawText(yearsLines[1], { x: POS.acts_year_1.x, y: POS.acts_year_1.y - lineGap, size: POS.acts_year_1.size, font, color: rgb(0, 0, 0) });

  if (data.line5aAuthorizeDisclosure) drawCheck(page1, POS.line5aAuthorizeDisclosure_Check.x, POS.line5aAuthorizeDisclosure_Check.y, font);
  if (data.line5aAccessRecords)       drawCheck(page1, POS.line5aAccessISP_Check.x,           POS.line5aAccessISP_Check.y,           font);
  if (data.line5aSubstituteOrAddRep)  drawCheck(page1, POS.line5aSubAddRep_Check.x,           POS.line5aSubAddRep_Check.y,           font);
  if (data.line5aSignReturn)          drawCheck(page1, POS.line5aSignReturn_Check.x,          POS.line5aSignReturn_Check.y,          font);

  return pdfDoc.save();
}
