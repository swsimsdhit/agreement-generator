import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "./App.css";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayFormatted() {
  return new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDisplayDate(iso) {
  if (!iso) return "";
  const [y, m, day] = iso.split("-");
  return new Date(y, m - 1, day).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
}

function fill(text, data) {
  if (!text) return "";
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    data[key] !== undefined ? data[key] : `{{${key}}}`
  );
}

function truncate(str, len = 80) {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "…" : str;
}

// Section type labels for display
const SECTION_TYPE_LABELS = {
  heading: "Heading",
  paragraph: "Paragraph",
  paragraph_noindent: "Paragraph (no indent)",
  bullet: "Bullet",
  diamond_bullet: "Diamond Bullet",
  arrow_bullet: "Arrow Bullet",
  square_bullet: "Square Bullet",
  note: "Note",
  hr: "Horizontal Rule",
  spacer: "Spacer",
  title: "Title",
  title_italic: "Title (Italic)",
  subtitle: "Subtitle",
  doc_header: "Doc Header",
  pricing_table: "Pricing Table",
  pricing_total: "Pricing Total",
  signature: "Signature Block",
};

// ─── Product category config ───────────────────────────────────────────────

const CATEGORY_ORDER = ["software", "services", "legal", "custom"];
const CATEGORY_LABELS = {
  software: "Core Software",
  services: "Services & Consulting",
  legal: "Legal & Compliance",
  custom: "Custom",
};
const PRODUCT_CATEGORY = {
  "connectehr":    "software",
  "fhir":          "software",
  "cqm-solution":  "software",
  "cehrt":         "software",
  "support":       "services",
  "gap-analysis":  "services",
  "icd-pointer":   "services",
  "nda":           "legal",
  "baa":           "legal",
  "custom":        "custom",
};

// ─── Preview renderer ─────────────────────────────────────────────────────────

function renderPreview(sections, data, onPriceChange) {
  return sections.map((section, i) => {
    const content = fill(section.content || "", data);
    switch (section.type) {
      case "doc_header":
        return (
          <div key={i} className="prev-doc-header">
            <span>Dynamic Health IT, Inc.</span>
            <img src="/api/logo-d" alt="" className="prev-doc-header-logo" />
          </div>
        );
      case "title_italic":
        return <div key={i} className="prev-title-italic">{content}</div>;
      case "title":
        return <h1 key={i} className="prev-title">{content}</h1>;
      case "subtitle":
        return <h2 key={i} className="prev-subtitle">{content}</h2>;
      case "heading":
        return <h3 key={i} className="prev-heading">{content}</h3>;
      case "paragraph":
        return <p key={i} className="prev-paragraph prev-indent">{content}</p>;
      case "paragraph_noindent":
        return <p key={i} className="prev-paragraph">{content}</p>;
      case "bullet":
        return <p key={i} className="prev-bullet">&#x2022;&nbsp;&nbsp;{content}</p>;
      case "diamond_bullet":
        return <p key={i} className="prev-diamond">❖&nbsp;&nbsp;{content}</p>;
      case "arrow_bullet":
        return <p key={i} className="prev-arrow">➢&nbsp;&nbsp;{content}</p>;
      case "square_bullet":
        return <p key={i} className="prev-square">■&nbsp;&nbsp;{content}</p>;
      case "hr":
        return <hr key={i} className="prev-hr" />;
      case "spacer":
        return <div key={i} className="prev-spacer" />;
      case "note":
        return <p key={i} style={{ fontSize: "9px", color: "#888", fontStyle: "italic", margin: "4px 0" }}>{content}</p>;
      case "pricing_table":
        return (
          <div key={i} style={{ margin: "16px 0" }}>
            {section.label && <div style={{ fontWeight: 700, fontSize: "12px", marginBottom: "8px", fontFamily: "Arial, Helvetica, sans-serif" }}>{section.label}</div>}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px", fontFamily: "Arial, Helvetica, sans-serif" }}>
              <thead>
                <tr style={{ background: "#1B1464", color: "#fff" }}>
                  <th style={{ padding: "4px 6px", textAlign: "left" }}>Module / Description</th>
                  <th style={{ padding: "4px 6px", textAlign: "center" }}>Initial Here</th>
                  <th style={{ padding: "4px 6px", textAlign: "center" }}>Price</th>
                </tr>
              </thead>
              <tbody>
                {(section.rows || []).map((row, ri) => (
                  <tr key={ri} style={{ background: row.isTotal ? "#E8E8F0" : (ri % 2 ? "#f8f8fc" : "#fff"), borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "4px 6px", fontWeight: row.isTotal ? 700 : 400 }}>
                      {row.module}
                      {row.items && row.items.length > 0 && (
                        <div style={{ paddingLeft: "12px", fontSize: "9px", color: "#555" }}>
                          {row.items.map((item, ii) => <div key={ii}>{item}</div>)}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "4px 6px", textAlign: "center", verticalAlign: "bottom", color: row.qty ? "#888" : "#999" }}>{row.qty ? "#: _________" : (row.initial ? "_________" : "")}</td>
                    <td style={{ padding: "4px 6px", textAlign: "center", verticalAlign: "bottom", fontWeight: row.isTotal ? 700 : 400 }}>
                      {onPriceChange ? (
                        <input
                          type="text"
                          value={row.price || ""}
                          onChange={e => onPriceChange(i, ri, e.target.value)}
                          style={{
                            width: "80px", textAlign: "center", border: "1px solid #ccc",
                            borderRadius: "3px", padding: "2px 4px", fontSize: "10px",
                            fontWeight: row.isTotal ? 700 : 400, fontFamily: "Arial, Helvetica, sans-serif",
                            background: row.isTotal ? "#E8E8F0" : "#fff",
                          }}
                          placeholder="$0"
                        />
                      ) : row.price}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "pricing_total":
        return (
          <div key={i} style={{ fontWeight: 700, fontSize: "13px", fontFamily: "Arial, Helvetica, sans-serif", padding: "8px 0", margin: "12px 0", borderTop: "2px solid #000", borderBottom: "2px solid #000" }}>
            {content}
          </div>
        );
      case "signature":
        return (
          <div key={i} className="prev-sig">
            <div className="prev-sig-two-col">
              <div className="prev-sig-col">
                <div className="prev-sig-label">Client</div>
                <div className="prev-sig-line">By: <span className="prev-sig-blank">______________________________</span></div>
                <div className="prev-sig-line">&nbsp;</div>
                <div className="prev-sig-line"><span className="prev-sig-blank">______________________________</span></div>
                <div className="prev-sig-line">(Print Name)</div>
                <div className="prev-sig-line">Title: <span className="prev-sig-blank">__________________________</span></div>
                <div className="prev-sig-line">Date: <span className="prev-sig-blank">___________________________</span></div>
                <div className="prev-sig-line" style={{ marginTop: "14px" }}>Mailing Address: <span className="prev-sig-blank">____________________</span></div>
                <div className="prev-sig-line"><span className="prev-sig-blank">______________________________________________</span></div>
                <div className="prev-sig-line"><span className="prev-sig-blank">______________________________________________</span></div>
              </div>
              <div className="prev-sig-col">
                <div className="prev-sig-label">Dynamic Health IT, Inc.</div>
                <div className="prev-sig-line">By: <span className="prev-sig-blank">______________________________</span></div>
                <div className="prev-sig-line">&nbsp;</div>
                <div className="prev-sig-line">Jeffery P. Robbins</div>
                <div className="prev-sig-line">President</div>
                <div className="prev-sig-line">&nbsp;</div>
                <div className="prev-sig-line">Date: <span className="prev-sig-blank">___________________________</span></div>
              </div>
            </div>
            <div className="prev-ap-contact">
              <div className="prev-sig-label">Client A/P Contact:</div>
              <div className="prev-sig-line">Name: <span className="prev-sig-blank">____________________________________________</span></div>
              <div className="prev-sig-line">Phone: <span className="prev-sig-blank">__________________________</span>&nbsp;&nbsp;Ex: <span className="prev-sig-blank">____________</span></div>
              <div className="prev-sig-line">Email: <span className="prev-sig-blank">____________________________________________</span></div>
            </div>
          </div>
        );
      default:
        return null;
    }
  });
}

// ─── Icons ───────────────────────────────────────────────────────────────────

const IconDoc = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2"/>
    <path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IconGDocs = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2"/>
    <path d="M14 2v6h6M8 13h8M8 17h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const IconCheck = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
    <polyline points="20 6 9 17 4 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IconEmpty = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="#C5C9D4" strokeWidth="1.5"/>
    <path d="M14 2v6h6M8 13h8M8 17h5" stroke="#C5C9D4" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const IconPlus = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const IconSearch = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
    <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const IconTrash = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const IconEdit = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2"/>
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2"/>
  </svg>
);

const IconX = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const IconSave = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" stroke="currentColor" strokeWidth="2"/>
    <path d="M17 21v-8H7v8M7 3v5h8" stroke="currentColor" strokeWidth="2"/>
  </svg>
);

const IconArrowUp = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
    <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IconArrowDown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
    <path d="M12 5v14M19 12l-7 7-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [products, setProducts]           = useState([]);
  const [selectedIds, setSelectedIds]     = useState(new Set());
  const [fields, setFields]               = useState({});
  const [generating, setGenerating]       = useState(null);
  const [toast, setToast]                 = useState(null);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [googleAuthed, setGoogleAuthed]   = useState(false);

  // Custom agreement state
  const [customSections, setCustomSections] = useState([]);

  // Hosting toggle state — set of product IDs with hosting enabled
  const [hostedProducts, setHostedProducts] = useState(new Set());

  // Snippet sidebar state
  const [library, setLibrary]             = useState([]);
  const [snippets, setSnippets]           = useState([]);
  const [libSearch, setLibSearch]         = useState("");
  const [libTab, setLibTab]               = useState("library"); // "library" | "snippets"
  const [libSourceFilter, setLibSourceFilter] = useState("all");

  // Snippet editor state
  const [editSnippet, setEditSnippet]     = useState(null); // null | { id?, name, type, content, category }
  const editNameRef = useRef(null);

  const isCustomMode = selectedIds.has("custom");

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Load products on mount
  useEffect(() => {
    fetch("/api/products")
      .then(r => r.json())
      .then(data => { setProducts(data); setLoadingProducts(false); })
      .catch(() => { setLoadingProducts(false); showToast("Could not connect to server.", "error"); });
    fetch("/api/google/status").then(r => r.json()).then(d => setGoogleAuthed(d.authed)).catch(() => {});
  }, [showToast]);

  // Load library + snippets when custom mode is activated
  useEffect(() => {
    if (!isCustomMode) return;
    fetch("/api/library").then(r => r.json()).then(setLibrary).catch(() => {});
    fetch("/api/snippets").then(r => r.json()).then(setSnippets).catch(() => {});
  }, [isCustomMode]);

  const reloadSnippets = useCallback(() => {
    fetch("/api/snippets").then(r => r.json()).then(setSnippets).catch(() => {});
  }, []);

  // Collect unique fields from all selected products
  const allFields = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const p of products.filter(p => selectedIds.has(p.id))) {
      for (const f of p.fields) {
        if (!seen.has(f.key)) {
          seen.add(f.key);
          result.push(f);
        }
      }
    }
    return result;
  }, [products, selectedIds]);

  // Merge in default field values
  useEffect(() => {
    setFields(prev => {
      const next = { ...prev };
      for (const p of products.filter(p => selectedIds.has(p.id))) {
        for (const f of p.fields) {
          if (!(f.key in next)) {
            next[f.key] = f.auto && f.key === "DATE" ? todayISO() : (f.default || "");
          }
        }
      }
      return next;
    });
  }, [selectedIds, products]);

  // Price overrides: keyed by "sectionIndex__rowIndex" -> price string
  const [priceOverrides, setPriceOverrides] = useState({});

  // Disabled add-ons: Set of row IDs that are toggled OFF
  const [disabledAddons, setDisabledAddons] = useState(new Set());

  // Collect all optional add-ons from selected products, grouped by table label
  const addonGroups = useMemo(() => {
    const groups = {};
    const selected = products.filter(p => selectedIds.has(p.id));
    for (const p of selected) {
      for (const s of p.sections) {
        if (s.type !== "pricing_table" || !s.rows) continue;
        const label = s.label || "Pricing";
        if (!groups[label]) groups[label] = [];
        const seen = new Set(groups[label].map(r => r.id));
        for (const row of s.rows) {
          if (row.optional && row.id && !seen.has(row.id)) {
            seen.add(row.id);
            groups[label].push({ id: row.id, module: row.module, price: row.price });
          }
        }
      }
    }
    return groups;
  }, [products, selectedIds]);

  const hasAddons = Object.values(addonGroups).some(g => g.length > 0);

  const toggleAddon = useCallback((rowId) => {
    setDisabledAddons(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  // Composed sections: for custom, use base template + user-inserted sections
  const composedSections = useMemo(() => {
    const nonCustomProducts = products.filter(p => selectedIds.has(p.id) && p.id !== "custom");
    const nonCustomSections = nonCustomProducts.flatMap(p => p.sections);

    let sections;
    if (isCustomMode) {
      const customProduct = products.find(p => p.id === "custom");
      const baseSections = customProduct ? customProduct.sections : [];
      sections = [...baseSections, ...customSections, ...nonCustomSections];
    } else {
      sections = nonCustomSections;
    }

    // Insert hosting sections before the signature block for products with hosting enabled
    const hostingInserts = [];
    for (const p of nonCustomProducts) {
      if (p.hostingAvailable && hostedProducts.has(p.id) && p.hostingSections) {
        hostingInserts.push(...p.hostingSections);
      }
    }
    if (hostingInserts.length > 0) {
      // Find last signature index and insert hosting before it
      const sigIdx = sections.reduce((last, s, i) => s.type === "signature" ? i : last, -1);
      if (sigIdx >= 0) {
        sections = [...sections.slice(0, sigIdx), ...hostingInserts, ...sections.slice(sigIdx)];
      } else {
        sections = [...sections, ...hostingInserts];
      }
    }

    // Apply price overrides and filter disabled add-ons from pricing_table rows
    return sections.map((s, si) => {
      if (s.type !== "pricing_table" || !s.rows) return s;
      const filteredRows = s.rows
        .filter(row => !(row.optional && row.id && disabledAddons.has(row.id)))
        .map((row, ri) => {
          const key = `${si}__${ri}`;
          if (priceOverrides[key] !== undefined) {
            return { ...row, price: priceOverrides[key] };
          }
          return row;
        });
      return { ...s, rows: filteredRows };
    });
  }, [products, selectedIds, customSections, isCustomMode, priceOverrides, disabledAddons, hostedProducts]);

  // Handler for editing prices in the preview
  const handlePriceChange = useCallback((sectionIndex, rowIndex, value) => {
    setPriceOverrides(prev => ({ ...prev, [`${sectionIndex}__${rowIndex}`]: value }));
  }, []);

  const templateData = { ...fields };
  if (fields.DATE) templateData.DATE = formatDisplayDate(fields.DATE);

  const toggleProduct = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Reset custom sections when custom is deselected
    if (id === "custom") {
      setCustomSections(prev => {
        // Only reset if it was selected (toggling off)
        return prev;
      });
    }
  }, []);

  const handleFieldChange = (key, value) => {
    setFields(prev => ({ ...prev, [key]: value }));
  };

  const canGenerate = selectedIds.size > 0
    && fields.CUSTOMER_NAME
    && fields.CUSTOMER_NAME.trim().length > 0;

  const handleGenerate = async (type) => {
    if (!canGenerate) return;
    setGenerating(type);
    try {
      const docTitle = products.filter(p => selectedIds.has(p.id)).map(p => p.name).join(" / ") || "Agreement";
      const fieldsWithTitle = { ...templateData, _DOC_TITLE: docTitle };
      const res = await fetch(`/api/generate/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: composedSections, fields: fieldsWithTitle }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Generation failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = (templateData.CUSTOMER_NAME || "Agreement").replace(/[/\\?%*:|"<>]/g, "-");
      a.download = `${safeName} - DHIT Agreement.${type}`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`${type.toUpperCase()} downloaded successfully.`);
    } catch (err) {
      showToast(`Error: ${err.message}`, "error");
    } finally {
      setGenerating(null);
    }
  };

  const handleGoogleConnect = async () => {
    try {
      const res = await fetch("/api/google/auth");
      const { url } = await res.json();
      const popup = window.open(url, "google-auth", "width=500,height=600");
      // Poll for completion
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          fetch("/api/google/status").then(r => r.json()).then(d => {
            setGoogleAuthed(d.authed);
            if (d.authed) showToast("Google Drive connected!");
          });
        }
      }, 500);
    } catch (err) {
      showToast("Could not start Google auth", "error");
    }
  };

  const handlePushToGDocs = async () => {
    if (!canGenerate) return;
    if (!googleAuthed) return handleGoogleConnect();
    setGenerating("gdocs");
    try {
      const docTitle = products.filter(p => selectedIds.has(p.id)).map(p => p.name).join(" / ") || "Agreement";
      const fieldsWithTitle = { ...templateData, _DOC_TITLE: docTitle };
      const res = await fetch("/api/generate/gdocs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: composedSections, fields: fieldsWithTitle }),
      });
      if (res.status === 401) {
        setGoogleAuthed(false);
        showToast("Google auth expired. Click the button again to reconnect.", "error");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Upload failed");
      }
      const { url } = await res.json();
      window.open(url, "_blank");
      showToast("Pushed to Google Docs!");
    } catch (err) {
      showToast(`Error: ${err.message}`, "error");
    } finally {
      setGenerating(null);
    }
  };

  // Group products by category
  const grouped = useMemo(() => {
    const map = {};
    for (const cat of CATEGORY_ORDER) map[cat] = [];
    for (const p of products) {
      const cat = PRODUCT_CATEGORY[p.id] || "services";
      if (map[cat]) map[cat].push(p);
    }
    return map;
  }, [products]);

  // ─── Snippet Sidebar Logic ──────────────────────────────────────────────────

  // Insert a library item or snippet into the custom agreement
  const insertSection = useCallback((section) => {
    const newSection = { type: section.type, content: section.content || "" };
    if (section.label) newSection.label = section.label;
    if (section.rows) newSection.rows = section.rows;
    setCustomSections(prev => [...prev, newSection]);
    showToast("Section inserted");
  }, [showToast]);

  // Remove an inserted custom section
  const removeCustomSection = useCallback((index) => {
    setCustomSections(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Reorder custom sections
  const moveCustomSection = useCallback((index, direction) => {
    setCustomSections(prev => {
      const arr = [...prev];
      const target = index + direction;
      if (target < 0 || target >= arr.length) return prev;
      [arr[index], arr[target]] = [arr[target], arr[index]];
      return arr;
    });
  }, []);

  // Unique sources for filter dropdown
  const libSources = useMemo(() => {
    const s = new Set();
    for (const item of library) s.add(item.source);
    return ["all", ...Array.from(s)];
  }, [library]);

  // Filtered library items
  const filteredLibrary = useMemo(() => {
    const q = libSearch.toLowerCase().trim();
    return library.filter(item => {
      if (libSourceFilter !== "all" && item.source !== libSourceFilter) return false;
      if (!q) return true;
      return (
        (item.content || "").toLowerCase().includes(q) ||
        (item.label || "").toLowerCase().includes(q) ||
        (item.source || "").toLowerCase().includes(q) ||
        (item.type || "").toLowerCase().includes(q)
      );
    });
  }, [library, libSearch, libSourceFilter]);

  // Filtered snippets
  const filteredSnippets = useMemo(() => {
    const q = libSearch.toLowerCase().trim();
    if (!q) return snippets;
    return snippets.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.content || "").toLowerCase().includes(q) ||
      (s.category || "").toLowerCase().includes(q)
    );
  }, [snippets, libSearch]);

  // Save snippet (create or update)
  const handleSaveSnippet = useCallback(async () => {
    if (!editSnippet || !editSnippet.name?.trim() || !editSnippet.content?.trim()) {
      showToast("Name and content required", "error");
      return;
    }
    try {
      if (editSnippet.id) {
        // Update
        await fetch(`/api/snippets/${editSnippet.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editSnippet),
        });
        showToast("Snippet updated");
      } else {
        // Create
        await fetch("/api/snippets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editSnippet),
        });
        showToast("Snippet saved to library");
      }
      setEditSnippet(null);
      reloadSnippets();
    } catch (err) {
      showToast("Failed to save snippet", "error");
    }
  }, [editSnippet, showToast, reloadSnippets]);

  const handleDeleteSnippet = useCallback(async (id) => {
    try {
      await fetch(`/api/snippets/${id}`, { method: "DELETE" });
      showToast("Snippet deleted");
      reloadSnippets();
    } catch (err) {
      showToast("Failed to delete", "error");
    }
  }, [showToast, reloadSnippets]);

  // Focus name input when editor opens
  useEffect(() => {
    if (editSnippet && editNameRef.current) editNameRef.current.focus();
  }, [editSnippet]);

  return (
    <div className="app">

      {/* ── Header ── */}
      <header className="header">
        <div className="header-left">
          <div className="header-logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="#2872FA" strokeWidth="2"/>
              <path d="M7 8h10M7 12h10M7 16h6" stroke="#2872FA" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="header-title">Agreement Builder</span>
          <span className="header-divider" />
          <span className="header-sub">Dynamic Health IT, Inc.</span>
        </div>
        <div className="header-right">
          <span className="header-date">{todayFormatted()}</span>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="app-body">

        {/* ── Left: Info Panel ── */}
        <aside className="info-panel">
          <div className="info-scroll">
            <div className="info-section-header">Customer Information</div>

            {selectedIds.size === 0 ? (
              <p className="info-empty-hint">Select modules to enter details</p>
            ) : (
              allFields.map(f => (
                <div key={f.key} className="field-group">
                  <label className="field-label">
                    {f.label}
                    {f.required && <span className="required">*</span>}
                  </label>
                  {f.type === "textarea" ? (
                    <textarea
                      className="input textarea"
                      rows={2}
                      placeholder={f.placeholder || ""}
                      value={fields[f.key] || ""}
                      onChange={e => handleFieldChange(f.key, e.target.value)}
                    />
                  ) : f.type === "date" ? (
                    <input
                      type="date"
                      className="input"
                      value={fields[f.key] || ""}
                      onChange={e => handleFieldChange(f.key, e.target.value)}
                    />
                  ) : (
                    <input
                      type="text"
                      className="input"
                      placeholder={f.placeholder || f.default || ""}
                      value={fields[f.key] || ""}
                      onChange={e => handleFieldChange(f.key, e.target.value)}
                    />
                  )}
                </div>
              ))
            )}

            {/* Pricing Add-ons toggles */}
            {hasAddons && (
              <div style={{ marginTop: 16 }}>
                <div className="info-section-header">Pricing Add-ons</div>
                <p className="info-empty-hint" style={{ marginBottom: 8 }}>Toggle items to include/exclude from pricing tables</p>
                {Object.entries(addonGroups).map(([label, addons]) => {
                  if (!addons.length) return null;
                  return (
                    <div key={label} style={{ marginBottom: 12 }}>
                      <div className="addon-group-label">{label}</div>
                      {addons.map(addon => {
                        const enabled = !disabledAddons.has(addon.id);
                        return (
                          <div
                            key={addon.id}
                            className={`addon-row${enabled ? " addon-row--on" : ""}`}
                            onClick={() => toggleAddon(addon.id)}
                          >
                            <div className={`addon-check${enabled ? " addon-check--on" : ""}`}>
                              {enabled && <IconCheck />}
                            </div>
                            <div className="addon-info">
                              <span className="addon-name">{addon.module}</span>
                              {addon.price && <span className="addon-price">{addon.price}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Show inserted custom sections list when in custom mode */}
            {isCustomMode && customSections.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="info-section-header">Inserted Sections</div>
                {customSections.map((s, i) => (
                  <div key={i} className="custom-section-item">
                    <span className="custom-section-type">{SECTION_TYPE_LABELS[s.type] || s.type}</span>
                    <span className="custom-section-preview">{truncate(s.content, 40)}</span>
                    <div className="custom-section-actions">
                      <button className="icon-btn" title="Move up" onClick={() => moveCustomSection(i, -1)} disabled={i === 0}><IconArrowUp /></button>
                      <button className="icon-btn" title="Move down" onClick={() => moveCustomSection(i, 1)} disabled={i === customSections.length - 1}><IconArrowDown /></button>
                      <button className="icon-btn icon-btn-danger" title="Remove" onClick={() => removeCustomSection(i)}><IconX /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Generate Actions */}
          <div className="info-actions">
            {selectedIds.size > 0 && (
              <div className="selected-badge">
                {selectedIds.size} module{selectedIds.size !== 1 ? "s" : ""} selected
              </div>
            )}
            {selectedIds.size > 0 && !canGenerate && (
              <p className="missing-hint">Enter customer name to generate</p>
            )}
            <button
              className={`btn btn-gdocs ${!canGenerate ? "btn-disabled" : ""}`}
              disabled={!canGenerate || generating === "gdocs"}
              onClick={handlePushToGDocs}
            >
              {generating === "gdocs" ? <span className="btn-spinner" /> : <IconGDocs />}
              {googleAuthed ? "Push to Google Docs" : "Connect Google Drive"}
            </button>
          </div>
        </aside>

        {/* ── Center: Module Selector ── */}
        <div className="module-panel">
          <div className="module-panel-heading">Agreement Modules</div>
          <p className="module-panel-hint">Click modules to add them to your document</p>

          {loadingProducts ? (
            <div className="loading-text">Loading modules…</div>
          ) : (
            CATEGORY_ORDER.map(catId => {
              const catProducts = grouped[catId] || [];
              if (!catProducts.length) return null;
              return (
                <div key={catId} className="module-group">
                  <div className="module-group-label">{CATEGORY_LABELS[catId]}</div>
                  {catProducts.map(p => {
                    const selected = selectedIds.has(p.id);
                    return (
                      <div
                        key={p.id}
                        className={`module-card${selected ? " module-card--selected" : ""}`}
                        onClick={() => toggleProduct(p.id)}
                        role="checkbox"
                        aria-checked={selected}
                      >
                        <div className={`module-check${selected ? " module-check--on" : ""}`}>
                          {selected && <IconCheck />}
                        </div>
                        <div className="module-card-body">
                          <div className="module-card-name">{p.name}</div>
                          <div className="module-card-desc">{p.description}</div>
                          {p.hostingAvailable && selected && (
                            <label
                              className="hosting-toggle"
                              onClick={e => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={hostedProducts.has(p.id)}
                                onChange={() => {
                                  setHostedProducts(prev => {
                                    const next = new Set(prev);
                                    if (next.has(p.id)) next.delete(p.id);
                                    else next.add(p.id);
                                    return next;
                                  });
                                }}
                              />
                              <span className="hosting-toggle-label">Hosted by DHIT</span>
                            </label>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* ── Preview ── */}
        <section className="preview-panel">
          <div className="preview-toolbar">
            <span className="preview-toolbar-label">
              {composedSections.length > 0
                ? `Document Preview — ${selectedIds.size} module${selectedIds.size !== 1 ? "s" : ""}`
                : "Document Preview"}
            </span>
            {fields.CUSTOMER_NAME && selectedIds.size > 0 && (
              <span className="preview-toolbar-customer">{fields.CUSTOMER_NAME}</span>
            )}
          </div>

          <div className="preview-scroll">
            {composedSections.length === 0 ? (
              <div className="preview-empty">
                <IconEmpty />
                <p>Select modules on the left to build your agreement</p>
              </div>
            ) : (
              <div className="preview-doc-wrapper">
                <div className="document-page">
                  {renderPreview(composedSections, templateData, handlePriceChange)}
                  <div className="prev-footer prev-footer-contact">
                    <div className="prev-footer-divider" />
                    <div className="prev-footer-center-line">
                      320C Monticello Avenue, New Orleans, LA 70121 &nbsp;∙&nbsp; E-mail: info@DynamicHealthIT.com
                    </div>
                    <div className="prev-footer-center-line">
                      Phone: (504) 309-9103 &nbsp;∙&nbsp; <span style={{ textDecoration: "underline" }}>www.DynamicHealthIT.com</span>
                    </div>
                    <div className="prev-footer-center-line">
                      Confidential and Proprietary – Quote is Valid for 30 days after date shown
                    </div>
                  </div>
                </div>
                {composedSections.length > 5 && (
                  <div className="prev-page2-header">
                    <div className="prev-page2-header-top">
                      <span className="prev-page2-company">Dynamic Health IT, Inc.</span>
                      <span className="prev-page2-page">Page 2</span>
                    </div>
                    <div className="prev-page2-divider" />
                    <div className="prev-page2-info">
                      <span>{templateData.CUSTOMER_NAME || ""}</span>
                      <span>{products.filter(p => selectedIds.has(p.id)).map(p => p.name).join(" / ") || "Agreement"}</span>
                      <span>{templateData.DATE || ""}</span>
                    </div>
                    <div style={{ fontSize: "8px", color: "#aaa", textAlign: "center", marginTop: 4 }}>— Page 2+ header shown in downloaded document —</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ── Snippet Sidebar (only when custom is selected) ── */}
        {isCustomMode && (
          <aside className="snippet-sidebar">
            <div className="snippet-sidebar-header">
              <span className="snippet-sidebar-title">Section Library</span>
              <button
                className="icon-btn icon-btn-accent"
                title="New snippet"
                onClick={() => setEditSnippet({ name: "", type: "paragraph", content: "", category: "Custom" })}
              >
                <IconPlus />
              </button>
            </div>

            {/* Tabs */}
            <div className="snippet-tabs">
              <button
                className={`snippet-tab${libTab === "library" ? " snippet-tab--active" : ""}`}
                onClick={() => setLibTab("library")}
              >
                Templates
              </button>
              <button
                className={`snippet-tab${libTab === "snippets" ? " snippet-tab--active" : ""}`}
                onClick={() => setLibTab("snippets")}
              >
                My Snippets{snippets.length > 0 && ` (${snippets.length})`}
              </button>
            </div>

            {/* Search */}
            <div className="snippet-search-row">
              <div className="snippet-search-wrap">
                <IconSearch />
                <input
                  type="text"
                  className="snippet-search"
                  placeholder="Search sections…"
                  value={libSearch}
                  onChange={e => setLibSearch(e.target.value)}
                />
                {libSearch && (
                  <button className="snippet-search-clear" onClick={() => setLibSearch("")}><IconX /></button>
                )}
              </div>
              {libTab === "library" && (
                <select
                  className="snippet-source-filter"
                  value={libSourceFilter}
                  onChange={e => setLibSourceFilter(e.target.value)}
                >
                  {libSources.map(s => (
                    <option key={s} value={s}>{s === "all" ? "All Templates" : s}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Snippet Editor (inline) */}
            {editSnippet && (
              <div className="snippet-editor">
                <div className="snippet-editor-title">{editSnippet.id ? "Edit Snippet" : "New Snippet"}</div>
                <input
                  ref={editNameRef}
                  className="input snippet-editor-input"
                  placeholder="Snippet name"
                  value={editSnippet.name}
                  onChange={e => setEditSnippet(prev => ({ ...prev, name: e.target.value }))}
                />
                <div className="snippet-editor-row">
                  <select
                    className="input snippet-editor-select"
                    value={editSnippet.type}
                    onChange={e => setEditSnippet(prev => ({ ...prev, type: e.target.value }))}
                  >
                    {Object.entries(SECTION_TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                  <input
                    className="input snippet-editor-input"
                    placeholder="Category"
                    value={editSnippet.category}
                    onChange={e => setEditSnippet(prev => ({ ...prev, category: e.target.value }))}
                  />
                </div>
                <textarea
                  className="input textarea snippet-editor-textarea"
                  rows={4}
                  placeholder="Section content… (supports {{CUSTOMER_NAME}} variables)"
                  value={editSnippet.content}
                  onChange={e => setEditSnippet(prev => ({ ...prev, content: e.target.value }))}
                />
                <div className="snippet-editor-actions">
                  <button className="btn-sm btn-sm-accent" onClick={handleSaveSnippet}><IconSave /> Save</button>
                  <button className="btn-sm btn-sm-ghost" onClick={() => setEditSnippet(null)}>Cancel</button>
                </div>
              </div>
            )}

            {/* Library List */}
            <div className="snippet-list">
              {libTab === "library" ? (
                filteredLibrary.length === 0 ? (
                  <p className="snippet-empty">No matching sections found</p>
                ) : (
                  filteredLibrary.map((item) => (
                    <div key={item.id} className="snippet-card">
                      <div className="snippet-card-top">
                        <span className="snippet-card-type">{SECTION_TYPE_LABELS[item.type] || item.type}</span>
                        <span className="snippet-card-source">{item.source}</span>
                      </div>
                      <div className="snippet-card-content">{truncate(item.content, 120)}</div>
                      <div className="snippet-card-actions">
                        <button className="btn-sm btn-sm-accent" onClick={() => insertSection(item)}>
                          <IconPlus /> Insert
                        </button>
                        <button
                          className="btn-sm btn-sm-ghost"
                          onClick={() => setEditSnippet({
                            name: truncate(item.content, 40),
                            type: item.type,
                            content: item.content,
                            category: item.source,
                          })}
                        >
                          <IconSave /> Save as Snippet
                        </button>
                      </div>
                    </div>
                  ))
                )
              ) : (
                filteredSnippets.length === 0 ? (
                  <div className="snippet-empty">
                    <p>No snippets yet</p>
                    <button
                      className="btn-sm btn-sm-accent"
                      onClick={() => setEditSnippet({ name: "", type: "paragraph", content: "", category: "Custom" })}
                    >
                      <IconPlus /> Create your first snippet
                    </button>
                  </div>
                ) : (
                  filteredSnippets.map((snip) => (
                    <div key={snip.id} className="snippet-card">
                      <div className="snippet-card-top">
                        <span className="snippet-card-name">{snip.name}</span>
                        <span className="snippet-card-type">{SECTION_TYPE_LABELS[snip.type] || snip.type}</span>
                      </div>
                      {snip.category && <span className="snippet-card-category">{snip.category}</span>}
                      <div className="snippet-card-content">{truncate(snip.content, 120)}</div>
                      <div className="snippet-card-actions">
                        <button className="btn-sm btn-sm-accent" onClick={() => insertSection(snip)}>
                          <IconPlus /> Insert
                        </button>
                        <button
                          className="btn-sm btn-sm-ghost"
                          onClick={() => setEditSnippet({ ...snip })}
                        >
                          <IconEdit /> Edit
                        </button>
                        <button
                          className="btn-sm btn-sm-danger"
                          onClick={() => handleDeleteSnippet(snip.id)}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </div>
                  ))
                )
              )}
            </div>
          </aside>
        )}

      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === "success" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M8 12l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          )}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
