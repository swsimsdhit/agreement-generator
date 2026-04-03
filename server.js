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

// ─────────────────────────────────────────────────────────────────────────────
// AUTH SYSTEM — paste this entire block into server.js
// Place it DIRECTLY AFTER the existing middleware lines:
//   app.use(cors());
//   app.use(express.json({ limit: '10mb' }));
// ─────────────────────────────────────────────────────────────────────────────
//
// NEW npm package needed — run once in your terminal:
//   npm install express-session bcryptjs
//
// NEW .env variables — add to Railway Variables:
//   SESSION_SECRET=any-long-random-string-you-make-up
//   USER_1=admin:Your Name:yourpassword
//   USER_2=boss:Boss One Name:theirpassword
//   USER_3=boss:Boss Two Name:theirpassword
//   USER_4=staff:Staff Name:theirpassword
//
// Format: role:Full Name:password
// Roles: admin | boss | staff
// ─────────────────────────────────────────────────────────────────────────────

const session = require('express-session');
const bcrypt  = require('bcryptjs');

// ── Session middleware ────────────────────────────────────────────────────────

app.use(session({
  secret: process.env.SESSION_SECRET || 'dhit-agreement-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

// ── Load users from env vars ──────────────────────────────────────────────────
// Reads USER_1, USER_2 ... USER_10 from environment
// Format: role:Full Name:password

function loadUsers() {
  const users = [];
  for (let i = 1; i <= 10; i++) {
    const raw = process.env[`USER_${i}`];
    if (!raw) continue;
    const parts = raw.split(':');
    if (parts.length < 3) continue;
    const [role, ...rest] = parts;
    const password = rest.pop();
    const name = rest.join(':');
    users.push({ id: `user${i}`, role: role.trim(), name: name.trim(), password: password.trim() });
  }
  return users;
}

// ── Lockout tracking (in-memory, resets on redeploy) ─────────────────────────

const loginAttempts = {}; // { ip: { count, lockedUntil } }
const MAX_ATTEMPTS  = 7;
const LOCKOUT_MS    = 15 * 60 * 1000; // 15 minutes

function isLockedOut(ip) {
  const entry = loginAttempts[ip];
  if (!entry) return false;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) return true;
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    delete loginAttempts[ip]; // lockout expired
    return false;
  }
  return false;
}

function recordFailedAttempt(ip) {
  if (!loginAttempts[ip]) loginAttempts[ip] = { count: 0, lockedUntil: null };
  loginAttempts[ip].count++;
  if (loginAttempts[ip].count >= MAX_ATTEMPTS) {
    loginAttempts[ip].lockedUntil = Date.now() + LOCKOUT_MS;
  }
}

function clearAttempts(ip) {
  delete loginAttempts[ip];
}

function attemptsRemaining(ip) {
  const entry = loginAttempts[ip];
  if (!entry) return MAX_ATTEMPTS;
  return Math.max(0, MAX_ATTEMPTS - entry.count);
}

// ── Auth middleware ───────────────────────────────────────────────────────────
// Protects all routes except login, logout, and client sign pages

function requireAuth(req, res, next) {
  // Always allow: login/logout endpoints, static assets, client sign pages
  const open = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/products',
  '/api/library',
  '/api/snippets',
  '/api/logo-d',
  '/api/google/status',
  '/api/google/auth',
  '/api/google/callback',
];
  if (open.includes(req.path)) return next();

  // Allow client sign routes without builder auth
  if (req.path.startsWith('/api/sign/')) return next();
  if (req.path.startsWith('/api/agreement/')) return next();

  // Static assets
  if (req.path.match(/\.(js|css|png|jpg|ico|map|json|woff|woff2|ttf|svg)$/)) return next();

  // Check session
  if (req.session && req.session.user) return next();

  // API calls get 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // All other routes serve the React app (React handles /login routing)
  next();
}

app.use(requireAuth);

// ── Auth routes ───────────────────────────────────────────────────────────────

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;

  if (isLockedOut(ip)) {
    const entry = loginAttempts[ip];
    const minutesLeft = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({
      error: `Account locked. Try again in ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''}.`,
      locked: true,
    });
  }

  const { name, password } = req.body;
  if (!name || !password) {
    return res.status(400).json({ error: 'Name and password required' });
  }

  const users = loadUsers();
  const user = users.find(u => u.name.toLowerCase() === name.trim().toLowerCase());

  if (!user || user.password !== password.trim()) {
    recordFailedAttempt(ip);
    const remaining = attemptsRemaining(ip);
    if (remaining === 0) {
      return res.status(401).json({
        error: 'Account locked for 15 minutes due to too many failed attempts.',
        locked: true,
        remaining: 0,
      });
    }
    return res.status(401).json({
      error: `Incorrect name or password. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
      remaining,
    });
  }

  clearAttempts(ip);
  req.session.user = { id: user.id, name: user.name, role: user.role };
  res.json({ ok: true, user: { name: user.name, role: user.role } });
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// GET /api/auth/me — React calls this on load to check session
app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.user) {
    res.json({ authenticated: true, user: req.session.user });
  } else {
    res.json({ authenticated: false });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// END AUTH SYSTEM BLOCK
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// APPROVAL FLOW — paste this entire block into server.js
// Place it ABOVE the "Start" / app.listen section at the bottom
// ─────────────────────────────────────────────────────────────────────────────
//
// NEW npm package needed — run once:
//   npm install nodemailer
//
// NEW .env variables needed (add to your .env file):
//   GMAIL_USER=you@yourdomain.com
//   GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx   ← 16-char Google App Password
//   APP_BASE_URL=https://agreements.yourdomain.com
//   BOSS_1_EMAIL=boss1@yourdomain.com
//   BOSS_1_NAME=Boss One
//   BOSS_2_EMAIL=boss2@yourdomain.com
//   BOSS_2_NAME=Boss Two
//   TEAM_EMAIL=team@yourdomain.com
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const nodemailer = require('nodemailer');

// ── Storage (flat JSON file next to server.js) ────────────────────────────────

const DRAFTS_PATH = path.join(__dirname, 'drafts.json');

function loadDrafts() {
  try { return JSON.parse(fs.readFileSync(DRAFTS_PATH, 'utf8')); }
  catch { return []; }
}

function saveDrafts(drafts) {
  fs.writeFileSync(DRAFTS_PATH, JSON.stringify(drafts, null, 2));
}

function findDraft(token) {
  return loadDrafts().find(d => d.token === token);
}

function updateDraft(token, patch) {
  const drafts = loadDrafts();
  const i = drafts.findIndex(d => d.token === token);
  if (i === -1) return null;
  drafts[i] = { ...drafts[i], ...patch };
  saveDrafts(drafts);
  return drafts[i];
}

// ── Email transport ───────────────────────────────────────────────────────────

function getMailer() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

async function sendMail({ to, subject, html }) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn('[email] GMAIL_USER / GMAIL_APP_PASSWORD not set — skipping send');
    console.log('[email] Would have sent to:', to, '|', subject);
    return;
  }
  await getMailer().sendMail({
    from: `"Agreement Builder" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
  });
}

// ── Email helpers ─────────────────────────────────────────────────────────────

function bossReviewEmail(draft, bossId, bossName) {
  const url = `${process.env.APP_BASE_URL}/review/${draft.token}?boss=${bossId}`;
  const products = (draft.selectedProductNames || []).join(', ') || 'See agreement';
  return `
    <p>Hi ${bossName},</p>
    <p><strong>${draft.createdBy || 'Your team'}</strong> has submitted an agreement for your approval.</p>
    <table style="border-collapse:collapse;font-size:14px;margin:16px 0">
      <tr><td style="padding:4px 12px 4px 0;color:#666">Client</td><td><strong>${draft.fields.CUSTOMER_NAME || '—'}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Products</td><td>${products}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Date</td><td>${draft.fields.DATE || '—'}</td></tr>
    </table>
    <p>
      <a href="${url}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px">
        Review &amp; Approve Agreement →
      </a>
    </p>
    <p style="font-size:12px;color:#999">
      You can edit the agreement before approving. Both bosses must approve before the client link is sent.
    </p>
  `;
}

function changesRequestedEmail(draft, bossName, feedback) {
  return `
    <p>Hi,</p>
    <p><strong>${bossName}</strong> has requested changes to the agreement for <strong>${draft.fields.CUSTOMER_NAME || 'your client'}</strong>.</p>
    ${feedback ? `<blockquote style="border-left:3px solid #ccc;margin:12px 0;padding:8px 16px;color:#444">${feedback}</blockquote>` : ''}
    <p>Please update the agreement and resubmit for approval.</p>
    <p>
      <a href="${process.env.APP_BASE_URL}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px">
        Open Agreement Builder →
      </a>
    </p>
  `;
}

function allApprovedEmail(draft) {
  const url = `${process.env.APP_BASE_URL}/sign/${draft.clientToken}`;
  return `
    <p>Hi,</p>
    <p>Both bosses have approved the agreement for <strong>${draft.fields.CUSTOMER_NAME}</strong>.</p>
    <p>The client sign link has been sent to <strong>${draft.clientEmail}</strong>.</p>
    <p style="font-size:13px;color:#666">Sign link: <a href="${url}">${url}</a></p>
  `;
}

function clientSignEmail(draft) {
  const url = `${process.env.APP_BASE_URL}/sign/${draft.clientToken}`;
  const products = (draft.selectedProductNames || []).join(', ') || 'your agreement';
  return `
    <p>Hi ${draft.fields.CUSTOMER_NAME || 'there'},</p>
    <p>Your agreement is ready for your review and signature.</p>
    <table style="border-collapse:collapse;font-size:14px;margin:16px 0">
      <tr><td style="padding:4px 12px 4px 0;color:#666">Products</td><td>${products}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Date</td><td>${draft.fields.DATE || '—'}</td></tr>
    </table>
    <p>
      <a href="${url}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px">
        Review &amp; Sign Agreement →
      </a>
    </p>
    <p style="font-size:12px;color:#999">This link is unique to you. Please do not share it.</p>
  `;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/draft  — team submits agreement for boss approval
app.post('/api/draft', async (req, res) => {
  try {
    const {
      fields,
      selectedIds,
      selectedProductNames,
      sections,
      priceOverrides,
      hostedProducts,
      customSections,
      clientEmail,
      createdBy,
    } = req.body;

    if (!fields?.CUSTOMER_NAME) {
      return res.status(400).json({ error: 'CUSTOMER_NAME is required' });
    }

    const token = crypto.randomBytes(5).toString('hex'); // e.g. a3f9k2b1c4

    const draft = {
      token,
      status: 'pending_review',      // pending_review | approved | sent | signed
      approvals: {},                  // { boss1: { name, at }, boss2: { name, at } }
      clientToken: null,
      clientEmail: clientEmail || '',
      createdBy: createdBy || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fields,
      selectedIds: Array.from(selectedIds || []),
      selectedProductNames: selectedProductNames || [],
      sections,
      priceOverrides: priceOverrides || {},
      hostedProducts: Array.from(hostedProducts || []),
      customSections: customSections || [],
    };

    const drafts = loadDrafts();
    drafts.push(draft);
    saveDrafts(drafts);

    // Email both bosses
    const bosses = [
      { id: 'boss1', email: process.env.BOSS_1_EMAIL, name: process.env.BOSS_1_NAME || 'Boss 1' },
      { id: 'boss2', email: process.env.BOSS_2_EMAIL, name: process.env.BOSS_2_NAME || 'Boss 2' },
    ];

    await Promise.all(bosses.map(b =>
      sendMail({
        to: b.email,
        subject: `Agreement for ${fields.CUSTOMER_NAME} — needs your approval`,
        html: bossReviewEmail(draft, b.id, b.name),
      })
    ));

    res.json({ token, status: draft.status });
  } catch (err) {
    console.error('/api/draft error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/draft/:token  — load draft into the builder (boss review page)
app.get('/api/draft/:token', (req, res) => {
  const draft = findDraft(req.params.token);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });
  res.json(draft);
});

// GET /api/drafts  — list all drafts (admin list view)
app.get('/api/drafts', (req, res) => {
  const drafts = loadDrafts().map(d => ({
    token: d.token,
    status: d.status,
    clientEmail: d.clientEmail,
    customerName: d.fields?.CUSTOMER_NAME,
    products: d.selectedProductNames,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    approvals: d.approvals,
    clientToken: d.clientToken,
  }));
  res.json(drafts.reverse()); // newest first
});

// POST /api/draft/:token/approve  — one boss approves (optionally with edits)
app.post('/api/draft/:token/approve', async (req, res) => {
  try {
    const { bossId, bossName, updatedDraft } = req.body;

    if (!bossId) return res.status(400).json({ error: 'bossId required' });

    let draft = findDraft(req.params.token);
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    if (draft.status === 'sent' || draft.status === 'signed') {
      return res.status(400).json({ error: 'Agreement already sent to client' });
    }

    // Merge any edits the boss made before approving
    const patch = {
      approvals: {
        ...draft.approvals,
        [bossId]: { name: bossName, at: new Date().toISOString() },
      },
      updatedAt: new Date().toISOString(),
    };
    if (updatedDraft) {
      patch.fields         = updatedDraft.fields         ?? draft.fields;
      patch.selectedIds    = updatedDraft.selectedIds    ?? draft.selectedIds;
      patch.sections       = updatedDraft.sections       ?? draft.sections;
      patch.priceOverrides = updatedDraft.priceOverrides ?? draft.priceOverrides;
      patch.hostedProducts = updatedDraft.hostedProducts ?? draft.hostedProducts;
      patch.customSections = updatedDraft.customSections ?? draft.customSections;
      patch.selectedProductNames = updatedDraft.selectedProductNames ?? draft.selectedProductNames;
    }

    draft = updateDraft(req.params.token, patch);

    // Check if both bosses have now approved
    const BOSS_IDS = ['boss1', 'boss2'];
    const allApproved = BOSS_IDS.every(id => draft.approvals[id]);

    if (allApproved && !draft.clientToken) {
      const clientToken = crypto.randomBytes(5).toString('hex');
      draft = updateDraft(req.params.token, { status: 'sent', clientToken });

      // Email client
      if (draft.clientEmail) {
        await sendMail({
          to: draft.clientEmail,
          subject: `Your agreement is ready to review and sign`,
          html: clientSignEmail(draft),
        });
      }

      // Notify team
      if (process.env.TEAM_EMAIL) {
        await sendMail({
          to: process.env.TEAM_EMAIL,
          subject: `✓ Agreement for ${draft.fields.CUSTOMER_NAME} approved and sent`,
          html: allApprovedEmail(draft),
        });
      }
    }

    res.json({
      allApproved,
      approvals: draft.approvals,
      status: draft.status,
      clientToken: draft.clientToken || null,
    });
  } catch (err) {
    console.error('/api/draft/:token/approve error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/draft/:token/changes  — boss requests changes, notifies team
app.post('/api/draft/:token/changes', async (req, res) => {
  try {
    const { bossName, feedback } = req.body;
    const draft = findDraft(req.params.token);
    if (!draft) return res.status(404).json({ error: 'Draft not found' });

    // Reset approvals so both bosses must re-approve after edits
    updateDraft(req.params.token, {
      status: 'pending_review',
      approvals: {},
      updatedAt: new Date().toISOString(),
    });

    if (process.env.TEAM_EMAIL) {
      await sendMail({
        to: process.env.TEAM_EMAIL,
        subject: `Changes requested on agreement for ${draft.fields.CUSTOMER_NAME}`,
        html: changesRequestedEmail(draft, bossName || 'A boss', feedback),
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('/api/draft/:token/changes error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// END APPROVAL FLOW BLOCK
// ─────────────────────────────────────────────────────────────────────────────

// ─── Start ───────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'build')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});
app.listen(PORT, () => {
  console.log(`Agreement Generator API running on http://localhost:${PORT}`);
});
