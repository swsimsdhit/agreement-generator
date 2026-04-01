require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const {
  Document, Packer, Paragraph, TextRun, ImageRun,
  AlignmentType, BorderStyle, UnderlineType, PageNumber, Footer, Header,
  Table, TableRow, TableCell, WidthType, VerticalAlign, ShadingType,
  TabStopPosition, TabStopType, HeightRule
} = require('docx');
const PDFDocument = require('pdfkit');
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.SERVER_PORT || 3003;

// ─── Google Drive OAuth ──────────────────────────────────────────────────────

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = `http://localhost:${PORT}/api/google/callback`;
const TOKEN_PATH = path.join(__dirname, '.google-token.json');

let oauth2Client;
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  try {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oauth2Client.setCredentials(token);
  } catch (e) { /* no saved token */ }
}

function isGoogleAuthed() {
  return !!(oauth2Client && oauth2Client.credentials && oauth2Client.credentials.access_token);
}

// Load products config (re-read on each request for hot-reload during dev)
const productsPath = path.join(__dirname, 'templates', 'products.json');
function loadProducts() {
  try {
    return JSON.parse(fs.readFileSync(productsPath, 'utf8'));
  } catch (e) {
    console.error('Could not load products.json:', e.message);
    return [];
  }
}

// Load logo images
const logoPath = path.join(__dirname, 'templates', 'DHIT_logo.png');
const logoIconPath = path.join(__dirname, 'templates', 'DHIT_logo_D.png');
let logoBuffer, logoIconBuffer;
try { logoBuffer = fs.readFileSync(logoPath); } catch (e) { console.warn('Logo not found:', logoPath); }
try { logoIconBuffer = fs.readFileSync(logoIconPath); } catch (e) { console.warn('Logo icon not found:', logoIconPath); }

// Register fonts for PDF generation
const FONT_DIR = 'C:/Windows/Fonts';
const fontPaths = {
  'Arial': path.join(FONT_DIR, 'arial.ttf'),
  'Arial-Bold': path.join(FONT_DIR, 'arialbd.ttf'),
  'Arial-Italic': path.join(FONT_DIR, 'ariali.ttf'),
  'Arial-BoldItalic': path.join(FONT_DIR, 'arialbi.ttf'),
  'Arial-Black': path.join(FONT_DIR, 'ariblk.ttf'),
};
function registerFonts(doc) {
  for (const [name, fp] of Object.entries(fontPaths)) {
    try { if (fs.existsSync(fp)) doc.registerFont(name, fp); } catch (e) { /* skip */ }
  }
}

// ─── Utility ────────────────────────────────────────────────────────────────

function fill(text, data) {
  if (!text) return '';
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] !== undefined ? data[key] : `{{${key}}}`);
}

const noBorders = {
  top: { style: BorderStyle.NONE, size: 0 },
  bottom: { style: BorderStyle.NONE, size: 0 },
  left: { style: BorderStyle.NONE, size: 0 },
  right: { style: BorderStyle.NONE, size: 0 },
};

const noBordersAll = { ...noBorders, insideHorizontal: { style: BorderStyle.NONE, size: 0 }, insideVertical: { style: BorderStyle.NONE, size: 0 } };

// ─── DOCX: Pricing Table Builder ────────────────────────────────────────────

function buildPricingTable(section) {
  const rows = section.rows || [];
  const tableRows = [];

  // Header row
  tableRows.push(new TableRow({
    children: [
      new TableCell({
        width: { size: 55, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: '1B1464' },
        children: [new Paragraph({ children: [new TextRun({ text: 'Module / Description', bold: true, size: 20, font: 'Arial', color: 'FFFFFF' })], spacing: { before: 40, after: 40 } })],
      }),
      new TableCell({
        width: { size: 25, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: '1B1464' },
        children: [new Paragraph({ children: [new TextRun({ text: 'Initial Here', bold: true, size: 20, font: 'Arial', color: 'FFFFFF' })], alignment: AlignmentType.CENTER, spacing: { before: 40, after: 40 } })],
      }),
      new TableCell({
        width: { size: 20, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: '1B1464' },
        children: [new Paragraph({ children: [new TextRun({ text: 'Price', bold: true, size: 20, font: 'Arial', color: 'FFFFFF' })], alignment: AlignmentType.CENTER, spacing: { before: 40, after: 40 } })],
      }),
    ],
  }));

  for (const row of rows) {
    const cellChildren = [];
    const isBold = row.isTotal;
    cellChildren.push(new Paragraph({
      children: [new TextRun({ text: row.module || '', bold: isBold, size: 20, font: 'Arial' })],
      spacing: { before: 30, after: row.items && row.items.length ? 0 : 30 },
    }));
    if (row.items && row.items.length) {
      for (const item of row.items) {
        cellChildren.push(new Paragraph({
          children: [new TextRun({ text: item, size: 18, font: 'Arial', color: '555555' })],
          spacing: { before: 10, after: 10 },
          indent: { left: 360 },
        }));
      }
    }

    const shading = row.isTotal ? { type: ShadingType.SOLID, color: 'E8E8F0' } : undefined;

    tableRows.push(new TableRow({
      children: [
        new TableCell({ width: { size: 55, type: WidthType.PERCENTAGE }, shading, children: cellChildren }),
        new TableCell({
          width: { size: 25, type: WidthType.PERCENTAGE }, shading,
          verticalAlign: VerticalAlign.BOTTOM,
          children: [new Paragraph({
            children: [new TextRun({ text: row.qty ? '#: _________' : (row.initial ? '_________' : ''), size: 20, font: 'Arial', color: row.qty ? '888888' : undefined })],
            alignment: AlignmentType.CENTER, spacing: { before: 30, after: 30 },
          })],
        }),
        new TableCell({
          width: { size: 20, type: WidthType.PERCENTAGE }, shading,
          verticalAlign: VerticalAlign.BOTTOM,
          children: [new Paragraph({
            children: [new TextRun({ text: row.price || '', bold: isBold, size: 20, font: 'Arial' })],
            alignment: AlignmentType.CENTER, spacing: { before: 30, after: 30 },
          })],
        }),
      ],
    }));
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: tableRows,
  });
}

// ─── DOCX Builder ────────────────────────────────────────────────────────────

function buildDocxChildren(sections, data) {
  const children = [];

  for (const section of sections) {
    const content = fill(section.content || '', data);

    switch (section.type) {
      case 'doc_header':
        children.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: noBordersAll,
          rows: [
            new TableRow({ children: [
              new TableCell({
                borders: noBorders,
                width: { size: 83, type: WidthType.PERCENTAGE },
                verticalAlign: VerticalAlign.CENTER,
                children: [new Paragraph({
                  children: [new TextRun({ text: 'Dynamic Health IT, Inc.', bold: true, italics: true, size: 28, font: 'Arial' })],
                })],
              }),
              new TableCell({
                borders: noBorders,
                width: { size: 17, type: WidthType.PERCENTAGE },
                verticalAlign: VerticalAlign.CENTER,
                children: [new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: logoIconBuffer
                    ? [new ImageRun({ data: logoIconBuffer, transformation: { width: 32, height: 32 }, type: 'png' })]
                    : [],
                })],
              }),
            ]}),
          ],
        }));
        children.push(new Paragraph({
          text: '',
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 4, color: '2872FA' } },
          spacing: { before: 0, after: 80 },
        }));
        break;

      case 'title_italic':
        children.push(new Paragraph({
          children: [new TextRun({ text: content, bold: true, italics: true, size: 36, font: 'Arial Black' })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 60 },
        }));
        break;

      case 'title':
        children.push(new Paragraph({
          children: [new TextRun({ text: content, bold: true, size: 36, font: 'Arial Black' })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 480 },
        }));
        break;

      case 'subtitle':
        children.push(new Paragraph({
          children: [new TextRun({ text: content, bold: true, size: 28, font: 'Arial Black' })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 320 },
        }));
        break;

      case 'heading':
        children.push(new Paragraph({
          children: [new TextRun({ text: content, bold: true, size: 24, font: 'Arial Black', underline: { type: UnderlineType.SINGLE } })],
          spacing: { before: 400, after: 120 },
        }));
        break;

      case 'diamond_bullet':
        children.push(new Paragraph({
          children: [new TextRun({ text: `\u2756  ${content}`, size: 24, font: 'Arial' })],
          spacing: { before: 100, after: 60 },
          indent: { left: 720, hanging: 360 },
        }));
        break;

      case 'arrow_bullet':
        children.push(new Paragraph({
          children: [new TextRun({ text: `\u27A2  ${content}`, size: 24, font: 'Arial' })],
          spacing: { before: 40, after: 40 },
          indent: { left: 1440, hanging: 360 },
        }));
        break;

      case 'square_bullet':
        children.push(new Paragraph({
          children: [new TextRun({ text: `\u25A0  ${content}`, size: 24, font: 'Arial' })],
          spacing: { before: 40, after: 40 },
          indent: { left: 2160, hanging: 360 },
        }));
        break;

      case 'hr':
        children.push(new Paragraph({
          text: '',
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 4 } },
          spacing: { after: 120 },
        }));
        break;

      case 'paragraph':
        children.push(new Paragraph({
          children: [new TextRun({ text: content, size: 24, font: 'Arial' })],
          alignment: AlignmentType.BOTH,
          spacing: { after: 200 },
          indent: { firstLine: 720 },
        }));
        break;

      case 'paragraph_noindent':
        children.push(new Paragraph({
          children: [new TextRun({ text: content, size: 24, font: 'Arial' })],
          alignment: AlignmentType.BOTH,
          spacing: { after: 200 },
        }));
        break;

      case 'bullet':
        children.push(new Paragraph({
          children: [new TextRun({ text: content, size: 24, font: 'Arial' })],
          bullet: { level: 0 },
          spacing: { after: 120 },
        }));
        break;

      case 'spacer':
        children.push(new Paragraph({ text: '', spacing: { after: 320 } }));
        break;

      case 'note':
        children.push(new Paragraph({
          children: [new TextRun({ text: content, size: 18, font: 'Arial', italics: true, color: '666666' })],
          spacing: { before: 60, after: 60 },
        }));
        break;

      case 'pricing_table':
        if (section.label) {
          children.push(new Paragraph({
            children: [new TextRun({ text: section.label, bold: true, size: 24, font: 'Arial' })],
            spacing: { before: 300, after: 120 },
          }));
        }
        children.push(buildPricingTable(section));
        children.push(new Paragraph({ text: '', spacing: { after: 200 } }));
        break;

      case 'pricing_total':
        children.push(new Paragraph({
          children: [new TextRun({ text: content, bold: true, size: 26, font: 'Arial' })],
          spacing: { before: 200, after: 200 },
          border: {
            top: { style: BorderStyle.SINGLE, size: 6, space: 4 },
            bottom: { style: BorderStyle.SINGLE, size: 6, space: 4 },
          },
        }));
        break;

      case 'signature':
        children.push(new Paragraph({ text: '', spacing: { before: 640, after: 0 } }));
        children.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: noBordersAll,
          rows: [
            new TableRow({ children: [
              new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: noBorders, children: [
                new Paragraph({ children: [new TextRun({ text: 'Client', bold: true, size: 24, font: 'Arial' })], spacing: { after: 160 } }),
                new Paragraph({ children: [new TextRun({ text: 'By: ____________________________', size: 24, font: 'Arial' })], spacing: { after: 200 } }),
                new Paragraph({ children: [new TextRun({ text: '____________________________', size: 24, font: 'Arial' })], spacing: { after: 40 } }),
                new Paragraph({ children: [new TextRun({ text: '(Print Name)', size: 20, font: 'Arial' })], spacing: { after: 160 } }),
                new Paragraph({ children: [new TextRun({ text: 'Title: _________________________', size: 24, font: 'Arial' })], spacing: { after: 160 } }),
                new Paragraph({ children: [new TextRun({ text: 'Date: __________________________', size: 24, font: 'Arial' })], spacing: { after: 320 } }),
                new Paragraph({ children: [new TextRun({ text: 'Mailing Address: ______________________', size: 24, font: 'Arial' })], spacing: { after: 80 } }),
                new Paragraph({ children: [new TextRun({ text: '___________________________________________', size: 24, font: 'Arial' })], spacing: { after: 80 } }),
                new Paragraph({ children: [new TextRun({ text: '___________________________________________', size: 24, font: 'Arial' })], spacing: { after: 0 } }),
              ]}),
              new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: noBorders, children: [
                new Paragraph({ children: [new TextRun({ text: 'Dynamic Health IT, Inc.', bold: true, size: 24, font: 'Arial' })], spacing: { after: 160 } }),
                new Paragraph({ children: [new TextRun({ text: 'By: ____________________________', size: 24, font: 'Arial' })], spacing: { after: 200 } }),
                new Paragraph({ children: [new TextRun({ text: 'Jeffery P. Robbins', size: 24, font: 'Arial' })], spacing: { after: 40 } }),
                new Paragraph({ children: [new TextRun({ text: 'President', size: 24, font: 'Arial' })], spacing: { after: 160 } }),
                new Paragraph({ children: [new TextRun({ text: ' ', size: 24, font: 'Arial' })], spacing: { after: 160 } }),
                new Paragraph({ children: [new TextRun({ text: 'Date: __________________________', size: 24, font: 'Arial' })], spacing: { after: 0 } }),
              ]}),
            ]}),
          ],
        }));
        children.push(new Paragraph({ text: '', spacing: { before: 480, after: 0 } }));
        children.push(new Paragraph({ children: [new TextRun({ text: 'Client A/P Contact:', bold: true, size: 24, font: 'Arial' })], spacing: { after: 120 } }));
        children.push(new Paragraph({ children: [new TextRun({ text: 'Name: _________________________________________', size: 24, font: 'Arial' })], spacing: { after: 100 } }));
        children.push(new Paragraph({ children: [new TextRun({ text: 'Phone: _______________________  Ex: ____________', size: 24, font: 'Arial' })], spacing: { after: 100 } }));
        children.push(new Paragraph({ children: [new TextRun({ text: 'Email: _________________________________________', size: 24, font: 'Arial' })], spacing: { after: 0 } }));
        break;

      default:
        break;
    }
  }

  return children;
}

// ─── DOCX Footer (all pages): contact info, centered, italic ────────────────

function buildDocxFooter() {
  return new Footer({
    children: [
      // Divider line
      new Paragraph({
        text: '',
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 4, color: '888888' } },
        spacing: { before: 0, after: 80 },
      }),
      // Line 1: Address + Email
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [
          new TextRun({ text: '320C Monticello Avenue, New Orleans, LA 70121', italics: true, size: 16, font: 'Arial', color: '555555' }),
          new TextRun({ text: '  \u2219  E-mail: info@DynamicHealthIT.com', italics: true, size: 16, font: 'Arial', color: '555555' }),
        ],
      }),
      // Line 2: Phone + Website (underlined)
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [
          new TextRun({ text: 'Phone: (504) 309-9103', italics: true, size: 16, font: 'Arial', color: '555555' }),
          new TextRun({ text: '  \u2219  ', italics: true, size: 16, font: 'Arial', color: '555555' }),
          new TextRun({ text: 'www.DynamicHealthIT.com', italics: true, size: 16, font: 'Arial', color: '555555', underline: { type: UnderlineType.SINGLE } }),
        ],
      }),
      // Line 3: Confidential notice
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 0 },
        children: [
          new TextRun({ text: 'Confidential and Proprietary \u2013 Quote is Valid for 30 days after date shown', italics: true, size: 16, font: 'Arial', color: '555555' }),
        ],
      }),
    ],
  });
}

// ─── DOCX Header (page 2+): company name + page, divider, client/product/date ─

function buildDocxHeader(data) {
  const customerName = data.CUSTOMER_NAME || '';
  const docDate = data.DATE || '';
  const docTitle = data._DOC_TITLE || 'Agreement';

  return new Header({
    children: [
      // Line 1: "Dynamic Health IT, Inc." left, "Page #" right — table for Google Docs compatibility
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: noBordersAll,
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders: noBorders,
                width: { size: 70, type: WidthType.PERCENTAGE },
                verticalAlign: VerticalAlign.BOTTOM,
                children: [new Paragraph({
                  children: [new TextRun({ text: 'Dynamic Health IT, Inc.', italics: true, size: 36, font: 'Arial' })],
                  spacing: { before: 0, after: 0 },
                })],
              }),
              new TableCell({
                borders: noBorders,
                width: { size: 30, type: WidthType.PERCENTAGE },
                verticalAlign: VerticalAlign.BOTTOM,
                children: [new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({ text: 'Page ', size: 20, font: 'Arial' }),
                    new TextRun({ children: [PageNumber.CURRENT], size: 20, font: 'Arial' }),
                  ],
                  spacing: { before: 0, after: 0 },
                })],
              }),
            ],
          }),
        ],
      }),
      // Divider line
      new Paragraph({
        text: '',
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 2, color: '2872FA' } },
        spacing: { before: 40, after: 40 },
      }),
      // Line 2: Client name | Product name | Date — bold, size 10, using table for reliable single-line
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: noBordersAll,
        rows: [
          new TableRow({
            height: { value: 280, rule: HeightRule.EXACT },
            children: [
              new TableCell({
                width: { size: 33, type: WidthType.PERCENTAGE },
                borders: noBorders,
                verticalAlign: VerticalAlign.CENTER,
                children: [new Paragraph({
                  children: [new TextRun({ text: customerName, bold: true, size: 20, font: 'Arial' })],
                  spacing: { before: 0, after: 0 },
                })],
              }),
              new TableCell({
                width: { size: 34, type: WidthType.PERCENTAGE },
                borders: noBorders,
                verticalAlign: VerticalAlign.CENTER,
                children: [new Paragraph({
                  children: [new TextRun({ text: docTitle, bold: true, size: 20, font: 'Arial' })],
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 0, after: 0 },
                })],
              }),
              new TableCell({
                width: { size: 33, type: WidthType.PERCENTAGE },
                borders: noBorders,
                verticalAlign: VerticalAlign.CENTER,
                children: [new Paragraph({
                  children: [new TextRun({ text: docDate, bold: true, size: 20, font: 'Arial' })],
                  alignment: AlignmentType.RIGHT,
                  spacing: { before: 0, after: 0 },
                })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

// ─── PDF Builder ─────────────────────────────────────────────────────────────

function buildPDF(doc, sections, data) {
  const marginLeft = 72;
  const pageWidth = doc.page.width - marginLeft * 2;
  const bottomLimit = doc.page.height - 90; // reserve space for footer
  registerFonts(doc);

  // Helper: check if we need a new page, leaving room for footer
  function checkPage(needed) {
    if (doc.y + (needed || 30) > bottomLimit) {
      doc.addPage();
    }
  }

  for (const section of sections) {
    const content = fill(section.content || '', data);

    switch (section.type) {
      case 'doc_header': {
        const headerY = 42; // start near top of page regardless of margin
        doc.fontSize(13).font('Arial-BoldItalic').text('Dynamic Health IT, Inc.', marginLeft, headerY + 4, { width: pageWidth - 40 });
        if (logoIconBuffer) {
          doc.image(logoIconBuffer, marginLeft + pageWidth - 28, headerY, { width: 28 });
        }
        doc.y = headerY + 34;
        doc.strokeColor('#2872FA').moveTo(marginLeft, doc.y).lineTo(marginLeft + pageWidth, doc.y).lineWidth(1.5).stroke();
        doc.strokeColor('#000000');
        doc.moveDown(0.4);
        break;
      }

      case 'title_italic':
        checkPage(30);
        doc.fontSize(18).font('Arial-Black').text(content, marginLeft, doc.y, { align: 'center', width: pageWidth });
        doc.moveDown(0.25);
        break;

      case 'title':
        checkPage(30);
        doc.fontSize(18).font('Arial-Black').text(content, marginLeft, doc.y, { align: 'center', width: pageWidth });
        doc.moveDown(1.5);
        break;

      case 'subtitle':
        checkPage(25);
        doc.fontSize(14).font('Arial-Black').text(content, marginLeft, doc.y, { align: 'center', width: pageWidth });
        doc.moveDown(1);
        break;

      case 'heading':
        checkPage(50);
        doc.moveDown(0.7);
        doc.fontSize(12).font('Arial-Black').text(content, marginLeft, doc.y, { width: pageWidth, underline: true });
        doc.moveDown(0.4);
        break;

      case 'diamond_bullet':
        checkPage(30);
        doc.fontSize(12).font('Arial').text(`*  ${content}`, marginLeft + 18, doc.y, { width: pageWidth - 18 });
        doc.moveDown(0.45);
        break;

      case 'arrow_bullet':
        checkPage(25);
        doc.fontSize(12).font('Arial').text(`>  ${content}`, marginLeft + 54, doc.y, { width: pageWidth - 54 });
        doc.moveDown(0.3);
        break;

      case 'square_bullet':
        checkPage(25);
        doc.fontSize(12).font('Arial').text(`-  ${content}`, marginLeft + 90, doc.y, { width: pageWidth - 90 });
        doc.moveDown(0.25);
        break;

      case 'hr':
        checkPage(10);
        doc.moveTo(marginLeft, doc.y).lineTo(marginLeft + pageWidth, doc.y).lineWidth(1).stroke();
        doc.moveDown(0.5);
        break;

      case 'paragraph':
        checkPage(30);
        doc.fontSize(12).font('Arial').text(content, marginLeft + 36, doc.y, { align: 'justify', width: pageWidth - 36 });
        doc.moveDown(0.6);
        break;

      case 'paragraph_noindent':
        checkPage(30);
        doc.fontSize(12).font('Arial').text(content, marginLeft, doc.y, { align: 'justify', width: pageWidth });
        doc.moveDown(0.6);
        break;

      case 'bullet':
        checkPage(25);
        doc.fontSize(12).font('Arial').text(`\u2022  ${content}`, marginLeft + 18, doc.y, { width: pageWidth - 18 });
        doc.moveDown(0.4);
        break;

      case 'spacer':
        checkPage(20);
        doc.moveDown(0.5);
        break;

      case 'note':
        checkPage(20);
        doc.fontSize(9).font('Arial-Italic').fillColor('#666666').text(content, marginLeft, doc.y, { width: pageWidth });
        doc.fillColor('#000000');
        doc.moveDown(0.3);
        break;

      case 'pricing_table': {
        checkPage(60);
        if (section.label) {
          doc.moveDown(0.5);
          doc.fontSize(12).font('Arial-Bold').text(section.label, marginLeft, doc.y, { width: pageWidth });
          doc.moveDown(0.3);
        }
        const rows = section.rows || [];
        const col1W = pageWidth * 0.55;
        const col2W = pageWidth * 0.25;
        const col3W = pageWidth * 0.20;

        // Header
        checkPage(25);
        const ptHeaderY = doc.y;
        doc.rect(marginLeft, ptHeaderY, pageWidth, 18).fill('#1B1464');
        doc.fontSize(9).font('Arial-Bold').fillColor('#FFFFFF');
        doc.text('Module / Description', marginLeft + 4, ptHeaderY + 4, { width: col1W, lineBreak: false });
        doc.text('Initial Here', marginLeft + col1W, ptHeaderY + 4, { width: col2W, align: 'center', lineBreak: false });
        doc.text('Price', marginLeft + col1W + col2W, ptHeaderY + 4, { width: col3W, align: 'center', lineBreak: false });
        doc.fillColor('#000000');
        doc.y = ptHeaderY + 20;

        for (const row of rows) {
          checkPage(25);
          const startY = doc.y;
          if (row.isTotal) {
            doc.rect(marginLeft, startY, pageWidth, 16).fill('#E8E8F0');
            doc.fillColor('#000000');
          }
          doc.fontSize(9).font(row.isTotal ? 'Arial-Bold' : 'Arial');
          doc.text(row.module || '', marginLeft + 4, startY + 3, { width: col1W - 8 });
          let rowBottom = doc.y + 3;

          if (row.items && row.items.length) {
            doc.fontSize(8).font('Arial').fillColor('#555555');
            for (const item of row.items) {
              checkPage(15);
              doc.text(item, marginLeft + 22, doc.y, { width: col1W - 26 });
            }
            rowBottom = doc.y + 3;
            doc.fillColor('#000000');
          }

          // Place initial and price at the bottom of the row
          const cellBottomY = rowBottom - 14;
          doc.fontSize(9).font('Arial');
          if (row.qty) {
            doc.fillColor('#888888').text('#: _________', marginLeft + col1W, cellBottomY, { width: col2W, align: 'center', lineBreak: false });
            doc.fillColor('#000000');
          } else if (row.initial) {
            doc.text('_________', marginLeft + col1W, cellBottomY, { width: col2W, align: 'center', lineBreak: false });
          }
          doc.font(row.isTotal ? 'Arial-Bold' : 'Arial');
          doc.text(row.price || '', marginLeft + col1W + col2W, cellBottomY, { width: col3W - 4, align: 'center', lineBreak: false });

          doc.y = rowBottom;
          doc.moveTo(marginLeft, doc.y).lineTo(marginLeft + pageWidth, doc.y).lineWidth(0.5).strokeColor('#CCCCCC').stroke();
          doc.strokeColor('#000000');
          doc.y += 2;
        }
        doc.moveDown(0.5);
        break;
      }

      case 'pricing_total':
        checkPage(30);
        doc.moveDown(0.3);
        doc.moveTo(marginLeft, doc.y).lineTo(marginLeft + pageWidth, doc.y).lineWidth(1.5).stroke();
        doc.moveDown(0.2);
        doc.fontSize(13).font('Arial-Bold').text(content, marginLeft, doc.y, { width: pageWidth });
        doc.moveDown(0.2);
        doc.moveTo(marginLeft, doc.y).lineTo(marginLeft + pageWidth, doc.y).lineWidth(1.5).stroke();
        doc.moveDown(0.5);
        break;

      case 'signature': {
        checkPage(280); // need substantial space for signature block
        if (doc.y + 280 > bottomLimit) doc.addPage();
        const col1X = marginLeft;
        const col2X = marginLeft + pageWidth / 2 + 10;
        const colW = pageWidth / 2 - 10;
        const lineH = 18;
        let sigY = doc.y + 20;

        doc.fontSize(12).font('Arial-Bold');
        doc.text('Client', col1X, sigY, { width: colW, lineBreak: false });
        doc.text('Dynamic Health IT, Inc.', col2X, sigY, { width: colW, lineBreak: false });
        sigY += lineH * 1.5;

        doc.font('Arial');
        doc.text('By: ____________________________', col1X, sigY, { width: colW, lineBreak: false });
        doc.text('By: ____________________________', col2X, sigY, { width: colW, lineBreak: false });
        sigY += lineH * 1.5;

        doc.text('____________________________', col1X, sigY, { width: colW, lineBreak: false });
        doc.text('Jeffery P. Robbins', col2X, sigY, { width: colW, lineBreak: false });
        sigY += lineH;

        doc.text('(Print Name)', col1X, sigY, { width: colW, lineBreak: false });
        doc.text('President', col2X, sigY, { width: colW, lineBreak: false });
        sigY += lineH * 1.5;

        doc.text('Title: ________________________', col1X, sigY, { width: colW, lineBreak: false });
        sigY += lineH * 1.5;

        doc.text('Date: _________________________', col1X, sigY, { width: colW, lineBreak: false });
        doc.text('Date: _________________________', col2X, sigY, { width: colW, lineBreak: false });
        sigY += lineH * 2;

        doc.text('Mailing Address: ____________________________________________', marginLeft, sigY, { width: pageWidth, lineBreak: false });
        sigY += lineH;
        doc.text('______________________________________________________________________', marginLeft, sigY, { width: pageWidth, lineBreak: false });
        sigY += lineH;
        doc.text('______________________________________________________________________', marginLeft, sigY, { width: pageWidth, lineBreak: false });
        sigY += lineH * 2;

        doc.font('Arial-Bold').text('Client A/P Contact:', marginLeft, sigY, { lineBreak: false });
        sigY += lineH;
        doc.font('Arial').text('Name: _________________________________________', marginLeft, sigY, { lineBreak: false });
        sigY += lineH;
        doc.text('Phone: _______________________   Ex: ____________', marginLeft, sigY, { lineBreak: false });
        sigY += lineH;
        doc.text('Email: _________________________________________', marginLeft, sigY, { lineBreak: false });
        doc.y = sigY + lineH;
        break;
      }

      default:
        break;
    }
  }
}

// Add headers and footers to all pages after content is built (requires bufferPages: true)
function addPDFHeadersFooters(doc, data) {
  const pages = doc.bufferedPageRange();
  const customerName = data.CUSTOMER_NAME || '';
  const docDate = data.DATE || '';
  const docTitle = data._DOC_TITLE || 'Agreement';
  const marginLeft = 72;
  const pageWidth = 612 - marginLeft * 2;

  // Temporarily disable auto-page-adding while writing headers/footers
  const origAddPage = doc.addPage.bind(doc);
  let headerFooterMode = true;
  doc.addPage = function() {
    if (headerFooterMode) return doc;
    return origAddPage.apply(this, arguments);
  };

  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    const savedX = doc.x;
    const savedY = doc.y;

    // ── HEADER (page 2+ only) ──
    if (i > 0) {
      const headerTop = 30;

      // "Dynamic Health IT, Inc." — size 18, italic, left
      doc.fontSize(18).font('Arial-Italic').fillColor('#000000');
      doc.text('Dynamic Health IT, Inc.', marginLeft, headerTop, { lineBreak: false });

      // Page number — right aligned
      doc.fontSize(10).font('Arial');
      doc.text('Page ' + (i + 1), marginLeft, headerTop + 4, { width: pageWidth, align: 'right', lineBreak: false });

      // Divider line
      const lineY = headerTop + 24;
      doc.save();
      doc.strokeColor('#2872FA').lineWidth(1.5);
      doc.moveTo(marginLeft, lineY).lineTo(marginLeft + pageWidth, lineY).stroke();
      doc.restore();

      // Three columns: client name | product | date — bold, size 9, single line
      const colW = pageWidth / 3;
      const infoY = lineY + 5;
      doc.fontSize(9).font('Arial-Bold').fillColor('#000000');
      doc.text(customerName, marginLeft, infoY, { width: colW, align: 'left', lineBreak: false, ellipsis: true });
      doc.text(docTitle, marginLeft + colW, infoY, { width: colW, align: 'center', lineBreak: false, ellipsis: true });
      doc.text(docDate, marginLeft + colW * 2, infoY, { width: colW, align: 'right', lineBreak: false, ellipsis: true });
    }

    // ── FOOTER (all pages): centered contact info with divider ──
    const footerTop = doc.page.height - 72;

    // Divider line
    doc.save();
    doc.strokeColor('#888888').lineWidth(0.75);
    doc.moveTo(marginLeft, footerTop).lineTo(marginLeft + pageWidth, footerTop).stroke();
    doc.restore();

    doc.fontSize(7.5).font('Arial-Italic').fillColor('#555555');

    doc.text(
      '320C Monticello Avenue, New Orleans, LA 70121  \u2219  E-mail: info@DynamicHealthIT.com',
      marginLeft, footerTop + 6, { width: pageWidth, align: 'center', lineBreak: false }
    );

    doc.text(
      'Phone: (504) 309-9103  \u2219  www.DynamicHealthIT.com',
      marginLeft, footerTop + 18, { width: pageWidth, align: 'center', lineBreak: false }
    );

    doc.text(
      'Confidential and Proprietary \u2013 Quote is Valid for 30 days after date shown',
      marginLeft, footerTop + 30, { width: pageWidth, align: 'center', lineBreak: false }
    );

    doc.fillColor('#000000');

    // Restore cursor position
    doc.x = savedX;
    doc.y = savedY;
  }

  // Restore original addPage
  headerFooterMode = false;
  doc.addPage = origAddPage;
}

// ─── Snippets Library ─────────────────────────────────────────────────────────

const snippetsPath = path.join(__dirname, 'templates', 'snippets.json');
function loadSnippets() {
  try { return JSON.parse(fs.readFileSync(snippetsPath, 'utf8')); }
  catch (e) { return []; }
}
function saveSnippets(snippets) {
  fs.writeFileSync(snippetsPath, JSON.stringify(snippets, null, 2), 'utf8');
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// Serve logo icon for frontend preview
app.get('/api/logo-d', (req, res) => {
  if (logoIconBuffer) {
    res.setHeader('Content-Type', 'image/png');
    res.send(logoIconBuffer);
  } else {
    res.status(404).end();
  }
});

app.get('/api/products', (req, res) => {
  const products = loadProducts();
  res.json(products.map(p => ({ id: p.id, name: p.name, description: p.description, fields: p.fields, sections: p.sections, hostingAvailable: p.hostingAvailable || false, hostingSections: p.hostingSections || undefined })));
});

// ─── Snippet Library Routes ──────────────────────────────────────────────────

// Get all available sections from all templates (for the insert-from-library feature)
app.get('/api/library', (req, res) => {
  const products = loadProducts();
  const library = [];
  for (const p of products) {
    for (let i = 0; i < p.sections.length; i++) {
      const s = p.sections[i];
      if (!s.content && s.type !== 'pricing_table') continue; // skip empty spacers/hrs
      library.push({
        id: `${p.id}__${i}`,
        source: p.name,
        sourceId: p.id,
        type: s.type,
        label: s.label || '',
        content: s.content || '',
        rows: s.rows || undefined,
      });
    }
  }
  res.json(library);
});

// CRUD for custom snippets
app.get('/api/snippets', (req, res) => {
  res.json(loadSnippets());
});

app.post('/api/snippets', (req, res) => {
  const { name, type, content, category } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'name and content required' });
  const snippets = loadSnippets();
  const snippet = {
    id: `snip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    type: type || 'paragraph',
    content,
    category: category || 'Custom',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  snippets.push(snippet);
  saveSnippets(snippets);
  res.json(snippet);
});

app.put('/api/snippets/:id', (req, res) => {
  const snippets = loadSnippets();
  const idx = snippets.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const { name, type, content, category } = req.body;
  if (name !== undefined) snippets[idx].name = name;
  if (type !== undefined) snippets[idx].type = type;
  if (content !== undefined) snippets[idx].content = content;
  if (category !== undefined) snippets[idx].category = category;
  snippets[idx].updatedAt = new Date().toISOString();
  saveSnippets(snippets);
  res.json(snippets[idx]);
});

app.delete('/api/snippets/:id', (req, res) => {
  let snippets = loadSnippets();
  const before = snippets.length;
  snippets = snippets.filter(s => s.id !== req.params.id);
  if (snippets.length === before) return res.status(404).json({ error: 'not found' });
  saveSnippets(snippets);
  res.json({ ok: true });
});

app.post('/api/generate/docx', async (req, res) => {
  try {
    const { sections, fields } = req.body;
    if (!sections || !Array.isArray(sections)) return res.status(400).json({ error: 'sections array required' });

    const data = {};
    for (const [k, v] of Object.entries(fields || {})) {
      data[k.toUpperCase()] = v;
    }

    const doc = new Document({
      sections: [{
        properties: {
          page: { margin: { top: 1800, bottom: 1800, left: 1440, right: 1440 } },
          titlePage: true,
        },
        headers: {
          default: buildDocxHeader(data),
          // first page: no header (titlePage=true means first page uses 'first' which defaults to empty)
        },
        footers: {
          default: buildDocxFooter(),
          first: buildDocxFooter(),
        },
        children: buildDocxChildren(sections, data),
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    const safeName = (data.CUSTOMER_NAME || 'Agreement').replace(/[/\\?%*:|"<>]/g, '-');
    const filename = `${safeName} - DHIT Agreement.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('DOCX error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/generate/pdf', (req, res) => {
  try {
    const { sections, fields } = req.body;
    if (!sections || !Array.isArray(sections)) return res.status(400).json({ error: 'sections array required' });

    const data = {};
    for (const [k, v] of Object.entries(fields || {})) {
      data[k.toUpperCase()] = v;
    }

    const safeName = (data.CUSTOMER_NAME || 'Agreement').replace(/[/\\?%*:|"<>]/g, '-');
    const filename = `${safeName} - DHIT Agreement.pdf`;

    const pdfDoc = new PDFDocument({ margins: { top: 80, bottom: 72, left: 72, right: 72 }, size: 'LETTER', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    pdfDoc.pipe(res);

    buildPDF(pdfDoc, sections, data);
    addPDFHeadersFooters(pdfDoc, data);

    pdfDoc.end();
  } catch (err) {
    console.error('PDF error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Google Drive Integration ────────────────────────────────────────────────

app.get('/api/google/status', (req, res) => {
  res.json({ authed: isGoogleAuthed() });
});

app.get('/api/google/auth', (req, res) => {
  if (!oauth2Client) return res.status(500).json({ error: 'Google OAuth not configured' });
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive.file'],
  });
  res.json({ url });
});

app.get('/api/google/callback', async (req, res) => {
  if (!oauth2Client) return res.status(500).send('Google OAuth not configured');
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    oauth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    res.send('<html><body><h2>Google Drive connected!</h2><p>You can close this tab.</p><script>window.close();</script></body></html>');
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    res.status(500).send('Authentication failed: ' + err.message);
  }
});

app.post('/api/generate/gdocs', async (req, res) => {
  try {
    if (!isGoogleAuthed()) return res.status(401).json({ error: 'Not connected to Google Drive' });

    const { sections, fields } = req.body;
    if (!sections || !Array.isArray(sections)) return res.status(400).json({ error: 'sections array required' });

    const data = {};
    for (const [k, v] of Object.entries(fields || {})) {
      data[k.toUpperCase()] = v;
    }

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1000, bottom: 1800, left: 1440, right: 1440 },
          },
          titlePage: true,
        },
        headers: { default: buildDocxHeader(data) },
        footers: { default: buildDocxFooter(), first: buildDocxFooter() },
        children: buildDocxChildren(sections, data),
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    const safe = (s) => (s || '').replace(/[/\\?%*:|"<>]/g, '-');
    const customerName = safe(data.CUSTOMER_NAME) || 'Agreement';
    const docTitle = safe(data._DOC_TITLE) || 'Agreement';
    const docDate = safe(data.DATE) || '';
    const filename = [customerName, docTitle, docDate].filter(Boolean).join('_');

    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const response = await drive.files.create({
      requestBody: {
        name: filename,
        mimeType: 'application/vnd.google-apps.document',
      },
      media: {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        body: Readable.from(buffer),
      },
      fields: 'id, webViewLink',
    });

    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: { role: 'writer', type: 'anyone' },
    });

    res.json({ url: response.data.webViewLink, id: response.data.id });
  } catch (err) {
    console.error('Google Docs error:', err);
    if (err.code === 401 || err.message?.includes('invalid_grant')) {
      try { fs.unlinkSync(TOKEN_PATH); } catch (e) {}
      if (oauth2Client) oauth2Client.revokeCredentials().catch(() => {});
      return res.status(401).json({ error: 'Google auth expired. Please reconnect.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'build')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});
app.listen(PORT, () => {
  console.log(`Agreement Generator API running on http://localhost:${PORT}`);
});
