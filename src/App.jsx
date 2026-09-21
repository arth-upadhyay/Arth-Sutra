import LockScreen from './components/LockScreen';
import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { Home, FileText, Settings, Plus, Users, Package, BarChart3, Wallet, RefreshCw, Receipt, BookOpen, Moon, Sun, Download, X, ShoppingCart, ChevronDown, Building2, Pencil, HelpCircle, Search, Command, Bell, Calculator } from 'lucide-react';
import { getAllProfiles, saveProfile, getEnabledModules, getAllBills, getAllProducts, getStockAlertSettings, getAllClients } from './store';
import { isModuleEnabled, getUpcomingFilings } from './utils';
import Dashboard from './components/Dashboard';
import InvoiceGenerator from './components/InvoiceGenerator';
import SetupWizard from './components/SetupWizard';
import ToastContainer from './components/Toast';
import ConfirmModalContainer from './components/ConfirmModal';
import WelcomeGuide from './components/WelcomeGuide';
const SettingsView = lazy(() => import('./components/SettingsView'));
const ClientsView = lazy(() => import('./components/ClientsView'));
const InventoryView = lazy(() => import('./components/InventoryView'));
const ReportsView = lazy(() => import('./components/ReportsView'));
const ExpenseTracker = lazy(() => import('./components/ExpenseTracker'));
const RecurringInvoices = lazy(() => import('./components/RecurringInvoices'));
const ReceiptVoucher = lazy(() => import('./components/ReceiptVoucher'));
const GSTReturns = lazy(() => import('./components/GSTReturns'));
const IncomeTax = lazy(() => import('./components/IncomeTax'));
const PurchaseBills = lazy(() => import('./components/PurchaseBills'));
const UserGuideView = lazy(() => import('./components/UserGuideView'));
import { getPrintSettings } from './utils/printSettings';

function ViewLoading() {
  return (
    <div style={{ padding: '3rem', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
        <span style={{
          display: 'inline-block', width: 14, height: 14, border: '2px solid var(--border)',
          borderTopColor: 'var(--primary)', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        Loading…
      </div>
    </div>
  );
}

// ============================================================================
// v1.10.44 — Rules-of-Hooks fix + reactivity improvements.
//
// BUG THAT DROVE THIS REWRITE:
//   The old App() called `useState(isUnlocked)` at the top, then
//   `if (!isUnlocked) return <LockScreen/>` — and 20+ more hooks AFTER
//   that early return. On first render (locked) React saw 1 hook. On
//   the render after unlock React saw ~25. "Rendered more hooks than
//   during the previous render" → hard crash. This was the #1 reported
//   white-screen-on-unlock bug.
//
// FIX: every hook now runs unconditionally at the top of App(). The
// three legitimate early-return states (locked / server-down / welcome
// wizard) sit BELOW all hooks. Hooks inside the main body are gated by
// `if (!isUnlocked) return;` INSIDE the effect, not by an outer return.
//
// ALSO FIXED:
//   • enabledModules is now React state (was re-read from localStorage
//     on every render with no re-render trigger — toggling a module in
//     Settings didn't update the sidebar until full reload).
//   • navItems is memoised and its handler deps are useCallback'd, so
//     the paletteActions useMemo actually fires only when relevant.
//   • Ctrl+S / Ctrl+P now dispatch 'fgsb-save-invoice' / 'fgsb-print-invoice'
//     custom events. InvoiceGenerator needs to listen for these
//     (follow-up); the shortcuts table reflects that they only work
//     when the invoice form is open.
// ============================================================================

function App() {
  // ═══════════════════════════════════════════════════════════════════════
  // 1. STATE  (every hook, no exceptions, before any conditional return)
  // ═══════════════════════════════════════════════════════════════════════

  const [isUnlocked, setIsUnlocked] = useState(() => {
    return sessionStorage.getItem('fgsb_unlocked') === 'true';
  });

  const [showWizard, setShowWizard] = useState(() => {
    try { return !getPrintSettings().onboardingComplete; } catch { return false; }
  });

  const [currentView, setCurrentView] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const v = params.get('view');
      const valid = ['dashboard', 'new', 'clients', 'inventory', 'expenses', 'purchases', 'recurring', 'receipts', 'reports', 'filing', 'incometax', 'guide', 'settings'];
      if (v && valid.includes(v)) {
        window.history.replaceState({}, '', window.location.pathname);
        return v;
      }
    } catch { /* sandboxed history API */ }
    return sessionStorage.getItem('gst_currentView') || 'dashboard';
  });

  const [profile, setProfile] = useState(null);

  const [editingBill, setEditingBill] = useState(() => {
    try {
      const saved = sessionStorage.getItem('gst_editingBill');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('freegstbill_theme') === 'dark';
  });

  const [showWelcome, setShowWelcome] = useState(false);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [serverDown, setServerDown] = useState(false);
  const [serverStatus, setServerStatus] = useState('checking');

  const [allProfiles, setAllProfiles] = useState([]);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  const [notifications, setNotifications] = useState({ overdue: [], dueSoon: [], lowStock: [], filings: [], autoFire: null });
  const [showNotifs, setShowNotifs] = useState(false);

  const [showPalette, setShowPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [searchCorpus, setSearchCorpus] = useState({ bills: [], clients: [], products: [] });
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // Enabled feature modules — stateful so toggling in Settings reflects
  // in the sidebar. Refreshed by 'fgsb-modules-changed' custom event
  // (fired by SettingsView when a toggle is flipped) OR on view change
  // as a fallback if the event isn't wired yet.
  const [enabledModules, setEnabledModulesState] = useState(() => getEnabledModules());

  // ═══════════════════════════════════════════════════════════════════════
  // 2. REFS
  // ═══════════════════════════════════════════════════════════════════════

  const deferredPrompt = useRef(null);
  const retryTimer = useRef(null);
  const profileLoaded = useRef(false);
  const profileMenuRef = useRef(null);
  // Ref mirror of showPalette so the global Esc handler (mounted once)
  // can see the current value without needing to re-subscribe.
  const showPaletteRef = useRef(showPalette);

  // ═══════════════════════════════════════════════════════════════════════
  // 3. CALLBACKS  (stable references for props + effect deps)
  // ═══════════════════════════════════════════════════════════════════════

  const handleUnlock = useCallback(() => {
    setIsUnlocked(true);
    sessionStorage.setItem('fgsb_unlocked', 'true');
  }, []);

  const handleNewInvoice = useCallback(() => {
    sessionStorage.removeItem('gst_invoiceDraft');
    setEditingBill(null);
    setCurrentView('new');
  }, []);

  const handleEditInvoice = useCallback((bill) => {
    sessionStorage.removeItem('gst_invoiceDraft');
    setEditingBill(bill);
    setCurrentView('new');
  }, []);

  const handleDuplicateInvoice = useCallback((bill) => {
    sessionStorage.removeItem('gst_invoiceDraft');
    const clone = JSON.parse(JSON.stringify(bill));
    clone._isDuplicate = true;
    setEditingBill(clone);
    setCurrentView('new');
  }, []);

  const handleConvertToInvoice = useCallback((bill) => {
    sessionStorage.removeItem('gst_invoiceDraft');
    const clone = JSON.parse(JSON.stringify(bill));
    clone._isDuplicate = true;
    clone._convertToType = 'tax-invoice';
    setEditingBill(clone);
    setCurrentView('new');
  }, []);

  const handleSwitchProfile = useCallback(async (bp) => {
    setShowProfileMenu(false);
    const loaded = { ...bp };
    delete loaded.id;
    await saveProfile(loaded);
    setProfile(loaded);
  }, []);

  const handleInstallPWA = useCallback(async () => {
    if (!deferredPrompt.current) return;
    deferredPrompt.current.prompt();
    const result = await deferredPrompt.current.userChoice;
    if (result.outcome === 'accepted') {
      setShowInstallBanner(false);
    }
    deferredPrompt.current = null;
  }, []);

  const dismissInstallBanner = useCallback(() => {
    setShowInstallBanner(false);
    localStorage.setItem('freegstbill_pwa_dismissed_at', String(Date.now()));
  }, []);

  const dismissUpdate = useCallback(() => {
    if (updateInfo?.latest) {
      localStorage.setItem('freegstbill_dismissedUpdate', updateInfo.latest);
    }
    setShowUpdateModal(false);
  }, [updateInfo]);

  const showIfModule = useCallback(
    (moduleId) => isModuleEnabled(moduleId, enabledModules),
    [enabledModules]
  );

  // ═══════════════════════════════════════════════════════════════════════
  // 4. MEMOISED DERIVED VALUES
  // ═══════════════════════════════════════════════════════════════════════

  const updateBannerVisible = useMemo(() => {
    if (!updateInfo?.updateAvailable) return false;
    try {
      return localStorage.getItem('freegstbill_dismissedUpdate') !== updateInfo.latest;
    } catch { return true; }
  }, [updateInfo]);

  const notifTotal = useMemo(() => (
    notifications.overdue.length
    + notifications.dueSoon.length
    + notifications.lowStock.length
    + notifications.filings.length
    + (notifications.autoFire?.count > 0 ? 1 : 0)
  ), [notifications]);

  const navItems = useMemo(() => [
    { id: 'dashboard', icon: Home, label: 'Dashboard', module: 'dashboard' },
    { id: 'new', icon: Plus, label: 'New Invoice', onClick: handleNewInvoice, module: 'invoicing' },
    { id: 'clients', icon: Users, label: 'Clients', module: 'clients' },
    { id: 'inventory', icon: Package, label: 'Products', module: 'inventory' },
    { id: 'expenses', icon: Wallet, label: 'Expenses', module: 'expenses' },
    { id: 'purchases', icon: ShoppingCart, label: 'Purchases', module: 'purchases' },
    { id: 'recurring', icon: RefreshCw, label: 'Recurring', module: 'recurring' },
    { id: 'receipts', icon: Receipt, label: 'Receipts', module: 'receipts' },
    { id: 'reports', icon: BarChart3, label: 'Reports', module: 'reports' },
    { id: 'filing', icon: BookOpen, label: 'GST Returns', module: 'gstReturns' },
    { id: 'incometax', icon: Calculator, label: 'Income Tax', module: 'incomeTax' },
    { id: 'guide', icon: HelpCircle, label: 'User Guide', module: 'dashboard' },
  ].filter(item => showIfModule(item.module)), [showIfModule, handleNewInvoice]);

  const paletteActions = useMemo(() => {
    const acts = [
      { label: 'New Invoice', hint: 'Ctrl+N', category: 'action', run: () => handleNewInvoice() },
    ];
    navItems.forEach(item => {
      if (item.id === 'new') return;
      acts.push({
        label: `Go to ${item.label}`,
        hint: '',
        category: 'nav',
        run: item.onClick || (() => setCurrentView(item.id)),
      });
    });
    acts.push({ label: 'Go to Settings', hint: '', category: 'nav', run: () => setCurrentView('settings') });
    acts.push({ label: 'Toggle dark mode', hint: '', category: 'action', run: () => setDarkMode(d => !d) });
    acts.push({ label: 'Show keyboard shortcuts', hint: 'Ctrl+/', category: 'help', run: () => setShowShortcutsHelp(true) });
    if (updateInfo?.updateAvailable) {
      acts.push({ label: `View update — v${updateInfo.latest}`, hint: '', category: 'update', run: () => setShowUpdateModal(true) });
    }
    searchCorpus.bills.forEach(b => {
      acts.push({
        label: `📄 ${b.invoiceNumber || 'INV-?'} — ${b.clientName || 'No client'}`,
        hint: b.invoiceDate ? new Date(b.invoiceDate).toLocaleDateString('en-IN') : '',
        category: 'invoice',
        run: () => handleEditInvoice(b),
      });
    });
    searchCorpus.clients.forEach(c => {
      acts.push({
        label: `👤 ${c.name} — client${c.gstin ? ' · GSTIN: ' + c.gstin : ''}`,
        hint: c.phone || c.email || '',
        category: 'client',
        run: () => setCurrentView('clients'),
      });
    });
    searchCorpus.products.forEach(p => {
      acts.push({
        label: `📦 ${p.name} — product${p.hsn ? ' · HSN: ' + p.hsn : ''}`,
        hint: (p.stock ?? 0) + ' in stock',
        category: 'product',
        run: () => setCurrentView('inventory'),
      });
    });
    const settingsJumps = [
      'Company profile', 'Payment accounts', 'Print & PDF Settings', 'PDF Style Editor',
      'Business type presets', 'Section labels', 'Watermarks', 'Multi-copy print',
      'Digital signature', 'Company letterhead', 'Modules', 'Region preference',
      'Google Drive backup', 'App updates',
    ];
    settingsJumps.forEach(s => {
      acts.push({ label: `⚙️ Settings → ${s}`, hint: '', category: 'settings', run: () => setCurrentView('settings') });
    });
    return acts;
  }, [navItems, updateInfo, handleNewInvoice, handleEditInvoice, searchCorpus]);

  const filteredPalette = useMemo(
    () => paletteActions.filter(a =>
      !paletteQuery.trim() || a.label.toLowerCase().includes(paletteQuery.toLowerCase())
    ),
    [paletteActions, paletteQuery]
  );

  const showResumeSetupPill = useMemo(() => {
    try {
      const ps = getPrintSettings();
      return !showWizard && ps.onboardingComplete === true && ps.onboardingSkipped === true;
    } catch { return false; }
  }, [showWizard]);

  // ═══════════════════════════════════════════════════════════════════════
  // 5. EFFECTS
  // ═══════════════════════════════════════════════════════════════════════

  // -- Update check (runs regardless of lock state; harmless) --
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/check-update');
        const data = await res.json();
        if (!cancelled) setUpdateInfo(data);
      } catch { /* offline */ }
    };
    const initial = setTimeout(check, 5000);
    const interval = setInterval(check, 6 * 60 * 60 * 1000);
    return () => { cancelled = true; clearTimeout(initial); clearInterval(interval); };
  }, []);

  // -- Notifications (only meaningful once unlocked) --
  useEffect(() => {
    if (!isUnlocked) return;
    let cancelled = false;
    const compute = async () => {
      try {
        const [bills, products, stockAlertCfg] = await Promise.all([
          getAllBills().catch(() => []),
          getAllProducts().catch(() => []),
          getStockAlertSettings().catch(() => ({ enabled: true, threshold: 5 })),
        ]);
        if (cancelled) return;
        const today = new Date().toISOString().split('T')[0];
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 3);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];
        const overdue = bills.filter(b => {
          const d = b.data?.details?.dueDate;
          return d && d < today && b.status !== 'paid';
        });
        const dueSoon = bills.filter(b => {
          const d = b.data?.details?.dueDate;
          return d && d >= today && d <= tomorrowStr && b.status !== 'paid';
        });
        const stockThreshold = Number(stockAlertCfg?.threshold ?? 5);
        const lowStock = stockAlertCfg?.enabled === false
          ? []
          : products.filter(p => (p.stock ?? 999) <= stockThreshold);
        const filings = getUpcomingFilings().filter(f => f.daysAway <= 10);
        let autoFire = null;
        try {
          const r = await fetch('/api/meta/lastRecurringAutoFire');
          if (r.ok) {
            const j = await r.json();
            if (j.value && j.value.date === today && j.value.count > 0) autoFire = j.value;
          }
        } catch { /* fine */ }
        setNotifications({ overdue, dueSoon, lowStock, filings, autoFire });
      } catch { /* offline / server down */ }
    };
    compute();
    const interval = setInterval(compute, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isUnlocked, currentView]);

  // -- Command palette search corpus --
  useEffect(() => {
    if (!isUnlocked || !showPalette) return;
    Promise.all([
      getAllBills().catch(() => []),
      getAllClients().catch(() => []),
      getAllProducts().catch(() => []),
    ]).then(([bills, clients, products]) => {
      setSearchCorpus({
        bills: bills.slice(0, 100),
        clients: clients.slice(0, 200),
        products: products.slice(0, 200),
      });
    });
  }, [isUnlocked, showPalette]);

  // -- Server health check --
  useEffect(() => {
    let cancelled = false;

    const checkServer = async () => {
      try {
        const res = await fetch('/api/profile', { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          if (cancelled) return;
          setServerDown(false);
          setServerStatus('online');
          if (!profileLoaded.current) {
            profileLoaded.current = true;
            const p = await res.json();
            setProfile(p);
            if (!p.businessName && !localStorage.getItem('freegstbill_onboarded')) {
              setShowWelcome(true);
            }
          }
          return;
        }
        throw new Error('not ok');
      } catch {
        if (!cancelled) {
          setServerDown(true);
          setServerStatus('offline');
        }
      }
    };

    checkServer();
    retryTimer.current = setInterval(checkServer, 5000);

    return () => {
      cancelled = true;
      if (retryTimer.current) clearInterval(retryTimer.current);
    };
  }, []);

  // -- PWA install banner --
  useEffect(() => {
    const dismissedAt = localStorage.getItem('freegstbill_pwa_dismissed_at');
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    if (isStandalone) return;
    if (dismissedAt) {
      const days = (Date.now() - Number(dismissedAt)) / 86400000;
      if (days < 14) return;
    }

    const handler = (e) => {
      e.preventDefault();
      deferredPrompt.current = e;
      setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // -- Persist current view --
  useEffect(() => {
    sessionStorage.setItem('gst_currentView', currentView);
  }, [currentView]);

  // -- Persist editing bill --
  useEffect(() => {
    if (editingBill) {
      sessionStorage.setItem('gst_editingBill', JSON.stringify(editingBill));
    } else {
      sessionStorage.removeItem('gst_editingBill');
    }
  }, [editingBill]);

  // -- Theme --
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('freegstbill_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // -- Saved profiles list --
  useEffect(() => {
    if (!isUnlocked) return;
    if (serverStatus === 'online') {
      getAllProfiles().then(setAllProfiles).catch(() => {});
    }
  }, [isUnlocked, serverStatus]);

  // -- Profile menu outside-click --
  useEffect(() => {
    if (!showProfileMenu) return;
    const handler = (e) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showProfileMenu]);

  // -- Enabled-modules reactivity --
  // Two triggers: (1) the custom event SettingsView fires on toggle,
  // (2) the storage event (cross-tab). The current tab can't listen to
  // its own localStorage writes, hence the custom event.
  // NOTE: SettingsView should dispatch `fgsb-modules-changed` after
  // calling setEnabledModules(). Until that's wired, module toggles
  // still apply on next full page load — same as before this fix.
  useEffect(() => {
    const refresh = () => setEnabledModulesState(getEnabledModules());
    window.addEventListener('fgsb-modules-changed', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('fgsb-modules-changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // -- Redirect if current view's module is disabled --
  useEffect(() => {
    const map = {
      new: 'invoicing',
      clients: 'clients',
      inventory: 'inventory',
      expenses: 'expenses',
      purchases: 'purchases',
      recurring: 'recurring',
      receipts: 'receipts',
      reports: 'reports',
      filing: 'gstReturns',
    };
    const moduleForView = map[currentView];
    if (moduleForView && !isModuleEnabled(moduleForView, enabledModules)) {
      setCurrentView('dashboard');
    }
  }, [currentView, enabledModules]);

  // -- Global keyboard shortcuts --
  // Ctrl+K palette, Ctrl+/ help, Ctrl+N new invoice, Ctrl+S save
  // (custom event → InvoiceGenerator), Ctrl+P print (custom event).
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      const editable = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        setShowPalette(p => !p);
        setPaletteQuery('');
        setPaletteIdx(0);
      } else if (e.key === '/') {
        e.preventDefault();
        setShowShortcutsHelp(s => !s);
      } else if (key === 'n' && !editable) {
        e.preventDefault();
        handleNewInvoice();
      } else if (key === 's') {
        // Only meaningful when the invoice form is open; InvoiceGenerator
        // listens for this event and saves. Prevents the browser's
        // "Save page as…" dialog either way.
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('fgsb-save-invoice'));
      } else if (key === 'p') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('fgsb-print-invoice'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleNewInvoice]);

  // -- Keep the palette ref in sync for the global Esc handler --
  useEffect(() => {
    showPaletteRef.current = showPalette;
  }, [showPalette]);

  // -- aria-label mirror + global Esc-to-close-modal --
  // Mounted once. Uses showPaletteRef to avoid re-subscribing on palette toggle.
  useEffect(() => {
    const mirrorTitleToAria = (root = document) => {
      root.querySelectorAll('button.icon-btn[title]:not([aria-label])').forEach(btn => {
        btn.setAttribute('aria-label', btn.getAttribute('title'));
      });
    };
    mirrorTitleToAria();
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes.length) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) {
              if (node.matches?.('button.icon-btn[title]:not([aria-label])')) {
                node.setAttribute('aria-label', node.getAttribute('title'));
              }
              mirrorTitleToAria(node);
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const onEsc = (e) => {
      if (e.key !== 'Escape') return;
      // Palette has its own Esc handler; skip so we don't double-close.
      if (showPaletteRef.current) return;
      const overlays = Array.from(document.querySelectorAll('.modal-overlay'));
      const top = overlays[overlays.length - 1];
      if (!top) return;
      top.click();
    };
    window.addEventListener('keydown', onEsc);
    return () => { observer.disconnect(); window.removeEventListener('keydown', onEsc); };
  }, []);

  // -- Command palette keyboard navigation --
  useEffect(() => {
    if (!showPalette) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); setShowPalette(false); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteIdx(i => Math.min(i + 1, filteredPalette.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteIdx(i => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const action = filteredPalette[paletteIdx];
        if (action) { action.run(); setShowPalette(false); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPalette, paletteIdx, filteredPalette]);

  // ═══════════════════════════════════════════════════════════════════════
  // 6. CONDITIONAL RENDERS  (below ALL hooks — this is the critical fix)
  // ═══════════════════════════════════════════════════════════════════════

  if (!isUnlocked) {
    return <LockScreen onUnlock={handleUnlock} />;
  }

  if (serverDown) {
    return (
      <div className="server-down-overlay">
        <div className="server-down-modal">
          <FileText size={48} color="#4D7C0F" />
          <h2>ArthSutra Needs a Quick Start</h2>
          <p>
            Your data is <strong>100% safe</strong> on your computer — nothing is lost.
            The app just needs to be started once.
          </p>
          <a href="freegstbill://start" className="server-start-btn">
            Open GST Billing
          </a>
          <div className="server-down-steps">
            <p className="server-down-hint">Or start manually:</p>
            <ol>
              <li>Double-click <strong>ArthSutra</strong> on your Desktop</li>
              <li>Or search <strong>"Free GST Billing"</strong> in Start Menu</li>
            </ol>
          </div>
          <p className="server-down-safe">All your invoices, clients, and data are safely stored on your computer. They are never deleted or shared.</p>
          <div className="server-down-waiting">
            <div className="server-down-spinner" />
            <span>Starting... this page will open automatically.</span>
          </div>
        </div>
      </div>
    );
  }

  if (showWelcome) {
    return (
      <>
        <WelcomeGuide onComplete={(p) => {
          if (p) setProfile(p);
          setShowWelcome(false);
        }} />
        <ToastContainer />
        <ConfirmModalContainer />
      </>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 7. MAIN RENDER
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <div className="app-layout">
      {showWizard && <SetupWizard onClose={() => setShowWizard(false)} />}
      {showResumeSetupPill && (
        <button type="button"
          onClick={() => setShowWizard(true)}
          title="Come back to the setup wizard — pick a business type, paper size, and language."
          style={{
            position: 'fixed', bottom: '1.25rem', right: '1.25rem', zIndex: 9998,
            padding: '0.6rem 1rem', borderRadius: 999,
            background: 'var(--primary)', color: '#fff', border: 'none',
            fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 6px 20px rgba(30,41,59,0.35), 0 2px 4px rgba(0,0,0,0.15)',
            display: 'flex', alignItems: 'center', gap: '0.4rem',
          }}>
          ✨ Finish setup
        </button>
      )}
      <div className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <FileText size={22} />
          </div>
          <div>
            <h2 className="sidebar-title">GST Billing</h2>
            <p className="sidebar-subtitle">by ARTH </p>
          </div>
        </div>

        <div className="profile-switcher" ref={profileMenuRef} style={{ position: 'relative' }}>
          <div className="profile-switcher-row">
            <button
              className="profile-switcher-btn"
              onClick={() => allProfiles.length > 1 && setShowProfileMenu(v => !v)}
              title={allProfiles.length > 1 ? 'Switch business profile' : profile?.businessName || 'My Business'}
              style={{ cursor: allProfiles.length > 1 ? 'pointer' : 'default' }}
            >
              <Building2 size={14} />
              <span className="profile-switcher-name">{profile?.businessName || 'My Business'}</span>
              {allProfiles.length > 1 && <ChevronDown size={13} style={{ marginLeft: 'auto', opacity: 0.6 }} />}
            </button>
            <button
              className="profile-switcher-edit"
              onClick={() => { setShowProfileMenu(false); setCurrentView('settings'); }}
              title="Edit business profile"
            >
              <Pencil size={13} />
            </button>
          </div>
          {showProfileMenu && (
            <div className="profile-switcher-menu">
              {allProfiles.map(bp => (
                <button
                  key={bp.id || bp.businessName}
                  className={`profile-switcher-item${bp.businessName?.trim().toLowerCase() === profile?.businessName?.trim().toLowerCase() ? ' active' : ''}`}
                  onClick={() => handleSwitchProfile(bp)}
                >
                  {bp.businessName}
                </button>
              ))}
              <button
                className="profile-switcher-item profile-switcher-manage"
                onClick={() => { setShowProfileMenu(false); setCurrentView('settings'); }}
              >
                Manage profiles...
              </button>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-btn ${currentView === item.id ? 'nav-btn-active' : ''}`}
              onClick={item.onClick || (() => setCurrentView(item.id))}
            >
              <item.icon size={18} /> {item.label}
            </button>
          ))}
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {updateBannerVisible && (
              <button
                className="nav-btn"
                onClick={() => setShowUpdateModal(true)}
                title={`v${updateInfo.latest} is available`}
                style={{
                  background: 'var(--info-bg)',
                  borderColor: 'var(--info-border)',
                  color: 'var(--info-text)',
                  fontWeight: 600,
                  position: 'relative',
                }}
              >
                <Download size={18} />
                <span style={{ flex: 1, textAlign: 'left' }}>
                  Update to v{updateInfo.latest}
                </span>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: '#f59e0b', boxShadow: '0 0 0 3px rgba(245,158,11,0.25)',
                  flexShrink: 0,
                }} />
              </button>
            )}
            <button
              className="nav-btn"
              onClick={() => setShowNotifs(s => !s)}
              title="Notifications"
              style={{ position: 'relative' }}
            >
              <Bell size={18} />
              Notifications
              {notifTotal > 0 && (
                <span style={{
                  position: 'absolute', top: '8px', right: '12px',
                  minWidth: 18, height: 18, padding: '0 5px', borderRadius: '9px',
                  background: 'var(--danger)', color: '#fff',
                  fontSize: '0.65rem', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{notifTotal > 99 ? '99+' : notifTotal}</span>
              )}
            </button>
            <button
              className="nav-btn"
              onClick={() => setDarkMode(!darkMode)}
              title={darkMode ? 'Light Mode' : 'Dark Mode'}
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
              {darkMode ? 'Light Mode' : 'Dark Mode'}
            </button>
            <button
              className={`nav-btn ${currentView === 'settings' ? 'nav-btn-active' : ''}`}
              onClick={() => setCurrentView('settings')}
              style={updateBannerVisible ? { position: 'relative' } : undefined}
            >
              <Settings size={18} /> Settings
              {updateBannerVisible && (
                <span style={{
                  position: 'absolute', top: '8px', right: '12px',
                  width: 8, height: 8, borderRadius: '50%',
                  background: '#f59e0b',
                }} title="Update available" />
              )}
            </button>
            <div className={`server-status server-status-${serverStatus}`}>
              <span className="server-status-dot" />
              {serverStatus === 'online' ? 'App Ready' : serverStatus === 'offline' ? 'App Not Running' : 'Connecting...'}
            </div>
          </div>
        </nav>
      </div>

      {showInstallBanner && (
        <div className="pwa-install-banner">
          <Download size={18} />
          <span>
            <strong>Install as Desktop App</strong> — own icon, no browser, opens instantly. Right-click the icon for quick-jump to New Invoice / GST Returns.
          </span>
          <button className="pwa-install-btn" onClick={handleInstallPWA}>Install App</button>
          <button className="pwa-dismiss-btn" onClick={dismissInstallBanner} title="Remind me later (re-shows in 14 days)"><X size={16} /></button>
        </div>
      )}

      <div className="main-content">
        {currentView === 'dashboard' && (
          <Dashboard onNew={handleNewInvoice} onEdit={handleEditInvoice} onDuplicate={handleDuplicateInvoice} onConvert={handleConvertToInvoice} />
        )}
        {currentView === 'new' && (
          <InvoiceGenerator
            onBack={() => { setEditingBill(null); setCurrentView('dashboard'); }}
            profile={profile} editingBill={editingBill}
          />
        )}
        <Suspense fallback={<ViewLoading />}>
          {currentView === 'clients' && (
            <ClientsView onNew={handleNewInvoice} onEdit={handleEditInvoice} onDuplicate={handleDuplicateInvoice} />
          )}
          {currentView === 'inventory' && <InventoryView />}
          {currentView === 'expenses' && <ExpenseTracker />}
          {currentView === 'purchases' && <PurchaseBills />}
          {currentView === 'recurring' && <RecurringInvoices onEdit={handleEditInvoice} />}
          {currentView === 'receipts' && <ReceiptVoucher />}
          {currentView === 'reports' && <ReportsView />}
          {currentView === 'filing' && <GSTReturns />}
          {currentView === 'incometax' && <IncomeTax />}
          {currentView === 'guide' && <UserGuideView />}
          {currentView === 'settings' && <SettingsView onSaved={(p) => setProfile(p)} />}
        </Suspense>
      </div>

      {showNotifs && (
        <div className="modal-overlay" onClick={() => setShowNotifs(false)}>
          <div className="modal-content" style={{ maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h3 className="section-title" style={{ margin: 0 }}>Notifications</h3>
              <button className="icon-btn" onClick={() => setShowNotifs(false)} title="Close"><X size={18} /></button>
            </div>
            {notifTotal === 0 ? (
              <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem 0', margin: 0 }}>
                All clear ✨ — nothing needs your attention right now.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {notifications.autoFire?.count > 0 && (
                  <button type="button" className="notice notice-info" onClick={() => { setShowNotifs(false); setCurrentView('dashboard'); }} style={{ cursor: 'pointer', border: 'none', textAlign: 'left' }}>
                    <span className="notice-icon">🔁</span>
                    <div style={{ flex: 1 }}>
                      <strong>{notifications.autoFire.count} recurring invoice{notifications.autoFire.count !== 1 ? 's' : ''} auto-generated today</strong>
                      <div style={{ fontSize: '0.72rem', opacity: 0.85, marginTop: '0.2rem' }}>
                        Check the Dashboard for the new bills · review and download PDFs as needed
                      </div>
                    </div>
                  </button>
                )}
                {notifications.overdue.length > 0 && (
                  <button type="button" className="notice notice-danger" onClick={() => { setShowNotifs(false); setCurrentView('dashboard'); }} style={{ cursor: 'pointer', border: 'none', textAlign: 'left' }}>
                    <span className="notice-icon">⚠</span>
                    <div style={{ flex: 1 }}>
                      <strong>{notifications.overdue.length} overdue invoice{notifications.overdue.length !== 1 ? 's' : ''}</strong>
                      <div style={{ fontSize: '0.72rem', opacity: 0.85, marginTop: '0.2rem' }}>
                        {notifications.overdue.slice(0, 3).map(b => b.invoiceNumber).join(' · ')}{notifications.overdue.length > 3 ? ` · +${notifications.overdue.length - 3} more` : ''}
                      </div>
                    </div>
                  </button>
                )}
                {notifications.dueSoon.length > 0 && (
                  <button type="button" className="notice notice-warn" onClick={() => { setShowNotifs(false); setCurrentView('dashboard'); }} style={{ cursor: 'pointer', border: 'none', textAlign: 'left' }}>
                    <span className="notice-icon">⏰</span>
                    <div style={{ flex: 1 }}>
                      <strong>{notifications.dueSoon.length} invoice{notifications.dueSoon.length !== 1 ? 's' : ''} due in next 3 days</strong>
                      <div style={{ fontSize: '0.72rem', opacity: 0.85, marginTop: '0.2rem' }}>
                        {notifications.dueSoon.slice(0, 3).map(b => `${b.invoiceNumber} (${b.clientName})`).join(' · ')}
                      </div>
                    </div>
                  </button>
                )}
                {notifications.filings.length > 0 && (
                  <button type="button" className="notice notice-info" onClick={() => { setShowNotifs(false); setCurrentView('filing'); }} style={{ cursor: 'pointer', border: 'none', textAlign: 'left' }}>
                    <span className="notice-icon">📋</span>
                    <div style={{ flex: 1 }}>
                      <strong>{notifications.filings.length} GST filing{notifications.filings.length !== 1 ? 's' : ''} due in next 10 days</strong>
                      <div style={{ fontSize: '0.72rem', opacity: 0.85, marginTop: '0.2rem' }}>
                        {notifications.filings.slice(0, 3).map(f => `${f.label} (${f.daysAway === 0 ? 'today' : f.daysAway + 'd'})`).join(' · ')}
                      </div>
                    </div>
                  </button>
                )}
                {notifications.lowStock.length > 0 && (
                  <button type="button" className="notice notice-note" onClick={() => { setShowNotifs(false); setCurrentView('inventory'); }} style={{ cursor: 'pointer', border: 'none', textAlign: 'left' }}>
                    <span className="notice-icon">📦</span>
                    <div style={{ flex: 1 }}>
                      <strong>{notifications.lowStock.length} product{notifications.lowStock.length !== 1 ? 's' : ''} low on stock</strong>
                      <div style={{ fontSize: '0.72rem', opacity: 0.85, marginTop: '0.2rem' }}>
                        {notifications.lowStock.slice(0, 3).map(p => `${p.name} (${p.stock} left)`).join(' · ')}
                      </div>
                    </div>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {showPalette && (
        <div className="modal-overlay" onClick={() => setShowPalette(false)}>
          <div className="modal-content" style={{ maxWidth: '520px', padding: 0, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
              <Search size={16} style={{ color: 'var(--text-muted)' }} />
              <input autoFocus type="text" placeholder="Type a command or page name…"
                value={paletteQuery}
                onChange={e => { setPaletteQuery(e.target.value); setPaletteIdx(0); }}
                className="form-input" style={{ border: 0, background: 'transparent', flex: 1, fontSize: '0.95rem' }} />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Esc</span>
            </div>
            <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
              {filteredPalette.length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.25rem', margin: 0, fontSize: '0.85rem' }}>
                  Nothing matches "{paletteQuery}".
                </p>
              )}
              {filteredPalette.map((a, i) => (
                <button key={a.label} type="button"
                  onClick={() => { a.run(); setShowPalette(false); }}
                  onMouseEnter={() => setPaletteIdx(i)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '0.6rem 1rem', border: 0, cursor: 'pointer',
                    background: i === paletteIdx ? 'var(--bg-tertiary)' : 'transparent',
                    color: 'var(--text-primary)', textAlign: 'left', fontSize: '0.88rem',
                  }}>
                  <span>{a.label}</span>
                  {a.hint && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{a.hint}</span>}
                </button>
              ))}
            </div>
            <div style={{ padding: '0.4rem 1rem', borderTop: '1px solid var(--border-color)', fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span><Command size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Ctrl+K to toggle · ↑↓ navigate · Enter run</span>
              <button type="button" onClick={() => { setShowPalette(false); setShowShortcutsHelp(true); }} style={{ background: 'none', border: 0, color: 'var(--primary)', cursor: 'pointer', fontSize: '0.7rem' }}>
                All shortcuts (Ctrl+/)
              </button>
            </div>
          </div>
        </div>
      )}

      {showShortcutsHelp && (
        <div className="modal-overlay" onClick={() => setShowShortcutsHelp(false)}>
          <div className="modal-content" style={{ maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 className="section-title" style={{ margin: 0 }}>Keyboard Shortcuts</h3>
              <button className="icon-btn" onClick={() => setShowShortcutsHelp(false)} title="Close"><X size={18} /></button>
            </div>
            <table className="kv-list">
              <tbody>
                <tr><td><kbd>Ctrl</kbd>&nbsp;+&nbsp;<kbd>K</kbd></td><td>Open command palette (jump to any page)</td></tr>
                <tr><td><kbd>Ctrl</kbd>&nbsp;+&nbsp;<kbd>N</kbd></td><td>New invoice</td></tr>
                <tr><td><kbd>Ctrl</kbd>&nbsp;+&nbsp;<kbd>S</kbd></td><td>Save current invoice (only when the invoice form is open)</td></tr>
                <tr><td><kbd>Ctrl</kbd>&nbsp;+&nbsp;<kbd>P</kbd></td><td>Download PDF (only when the invoice form is open)</td></tr>
                <tr><td><kbd>Ctrl</kbd>&nbsp;+&nbsp;<kbd>/</kbd></td><td>Toggle this help</td></tr>
                <tr><td><kbd>Esc</kbd></td><td>Close any open modal</td></tr>
              </tbody>
            </table>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.75rem', marginBottom: 0 }}>
              On macOS, use <kbd>⌘</kbd> instead of <kbd>Ctrl</kbd>.
            </p>
          </div>
        </div>
      )}

      {showUpdateModal && updateInfo && (
        <div className="modal-overlay" onClick={() => setShowUpdateModal(false)}>
          <div className="modal-content" style={{ maxWidth: '640px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div>
                <h3 className="section-title" style={{ marginTop: 0, marginBottom: '0.25rem' }}>
                  Update available — v{updateInfo.latest}
                </h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                  You're on v{updateInfo.current}
                  {updateInfo.releasePublishedAt && ` · released ${new Date(updateInfo.releasePublishedAt).toLocaleDateString()}`}
                </p>
              </div>
              <button className="icon-btn" onClick={() => setShowUpdateModal(false)} title="Close"><X size={18} /></button>
            </div>

            <div className="notice notice-info" style={{ marginBottom: '0.85rem' }}>
              <span className="notice-icon">🔒</span>
              <div>
                <strong>Your data is safe.</strong> Updates only refresh the app code and dependencies — your <code>data/</code> folder (invoices, clients, products, settings) and <code>Saved Invoices/</code> PDF archive are <strong>never touched</strong>. The updater pulls the latest source from GitHub and rebuilds, then restarts.
              </div>
            </div>

            <div className="surface-card" style={{ maxHeight: '320px', overflowY: 'auto', whiteSpace: 'pre-wrap', fontSize: '0.82rem', lineHeight: 1.55, marginBottom: '0.85rem' }}>
              {updateInfo.releaseNotes || (
                <span style={{ color: 'var(--text-muted)' }}>
                  No release notes available — see the full changelog at{' '}
                  <a href={updateInfo.releaseUrl || 'https://github.com/IamRamgarhia/Free-GST-Billing-Software/releases'} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>GitHub Releases</a>.
                </span>
              )}
            </div>

            <div className="notice notice-warn" style={{ marginBottom: '1rem' }}>
              <span className="notice-icon">💡</span>
              <div>
                <strong>Recommended:</strong> export a backup before updating, just in case. <button type="button" className="btn-link" onClick={() => { setShowUpdateModal(false); setCurrentView('settings'); }} style={{ background: 'none', border: 0, color: 'var(--primary)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: 0 }}>Open Settings → Data Management</button> and click <em>Export Backup…</em>.
              </div>
            </div>

            <div className="flex gap-2 justify-end" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={dismissUpdate}>
                Skip this version
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowUpdateModal(false)}>
                Remind me later
              </button>
              {updateInfo.releaseUrl && (
                <a href={updateInfo.releaseUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                  View on GitHub
                </a>
              )}
              <a href="freegstbill-update://run" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                <Download size={16} /> Update Now
              </a>
            </div>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.6rem', marginBottom: 0 }}>
              <em>Update Now</em> launches <code>Update FreeGSTBill.bat</code> in a window. Wait for it to finish (~30 seconds), then refresh this page.
            </p>
          </div>
        </div>
      )}

      <ToastContainer />
      <ConfirmModalContainer />
    </div>
  );
}

export default App;