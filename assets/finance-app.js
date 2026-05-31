import {
  CATEGORIES,
  EXCHANGE_RATE_TYPES,
  FOOD_SUBCATEGORIES,
  PAYMENT_METHODS,
  defaultCreditCardSettings,
  emptySavings,
  fallbackExchangeRates,
  mockSettings,
} from "./finance-data.js";
import { calculateMetrics, generateCreditCardInsights, generateInsights, generateMonthlyClosing } from "./finance-calculations.js";
import { convertFromARS, formatDate, formatMoney, formatPercent, getRate, movementToARS, toARS } from "./finance-currency.js";
import { fetchExchangeRates, isRateStale, storage } from "./finance-services.js";

const STORAGE_KEY = "finance-app-state-v4";

const NAV = [
  { id: "dashboard", label: "Dashboard", short: "Inicio", mobile: true },
  { id: "expenses", label: "Gastos", mobile: true },
  { id: "income", label: "Ingresos" },
  { id: "recurring", label: "Recurrentes" },
  { id: "credit-card", label: "Tarjeta" },
  { id: "savings", label: "Ahorros" },
  { id: "investments", label: "Inversiones" },
  { id: "budgets", label: "Presupuestos", short: "Presup.", mobile: true },
  { id: "metrics", label: "Metricas", short: "Metricas", mobile: true },
  { id: "closing", label: "Cierre" },
  { id: "settings", label: "Ajustes" },
];

const TYPE_LABELS = {
  expense: "Gasto",
  income: "Ingreso",
  saving: "Ahorro",
  investment: "Inversion",
};

const SAVINGS_RATIO = 0.4;
const FOOD_BUDGET_RATIO = 0.75;
const LEISURE_BUDGET_RATIO = 0.25;

let state = {
  activeView: "dashboard",
  modalOpen: false,
  setupOpen: false,
  mobileMenuOpen: false,
  formStatus: "",
  setupStatus: "",
  ratesStatus: "loading",
  ratesMessage: "Cotizacion en carga",
  modalType: "expense",
  rates: fallbackExchangeRates,
  settings: mockSettings,
  transactions: [],
  budgets: [],
  savings: emptySavings,
  investments: [],
  recurringExpenses: [],
  installmentPurchases: [],
  creditCardSettings: defaultCreditCardSettings,
};

function hydrate() {
  const saved = storage.read(STORAGE_KEY, null);
  if (saved) {
    state = {
      ...state,
      ...saved,
      settings: { ...mockSettings, ...(saved.settings || {}) },
      savings: { ...emptySavings, ...(saved.savings || {}) },
      creditCardSettings: { ...defaultCreditCardSettings, ...(saved.creditCardSettings || {}) },
      installmentPurchases: saved.installmentPurchases || [],
      rates: fallbackExchangeRates,
      ratesStatus: "loading",
      ratesMessage: "Cotizacion en carga",
    };
  }
}

function persist() {
  const { rates, ratesStatus, ratesMessage, activeView, modalOpen, setupOpen, mobileMenuOpen, formStatus, setupStatus, ...persistable } = state;
  storage.write(STORAGE_KEY, persistable);
}

function moneyARS(amountARS, compact = false) {
  const amount = convertFromARS(amountARS, state.settings.displayCurrency, state.rates, state.settings.defaultExchangeRateType);
  return formatMoney(amount, state.settings.displayCurrency, compact);
}

function h(strings, ...values) {
  return strings.map((string, index) => `${string}${values[index] ?? ""}`).join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function optionList(items, selected) {
  return items.map((item) => {
    const value = typeof item === "string" ? item : item.value;
    const label = typeof item === "string" ? item : item.label;
    return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function segmented(name, options, active) {
  return `<div class="segmented" role="group" aria-label="${name}">
    ${options.map((option) => `<button type="button" data-action="${name}" data-value="${option}" class="${option === active ? "is-active" : ""}">${option}</button>`).join("")}
  </div>`;
}

function segments(percent, status = "neutral") {
  const count = 20;
  const filled = Math.max(0, Math.min(count, Math.round((percent / 100) * count)));
  return `<div class="bar-track is-${status}" aria-hidden="true">${Array.from({ length: count }, (_, index) => `<i class="${index < filled ? "is-filled" : ""}"></i>`).join("")}</div>`;
}

function appChrome(metrics) {
  const activeLabel = NAV.find((item) => item.id === state.activeView)?.label || "Dashboard";
  const defaultRate = state.rates[state.settings.defaultExchangeRateType];
  const stale = isRateStale(defaultRate);

  return h`
    <div class="app-layout">
      <aside class="sidebar" aria-label="Navegacion principal">
        <div class="brand-mark">
          <strong>FIN//OS</strong>
          <span class="label">Cargar / Entender / Optimizar</span>
        </div>
        <nav class="nav-list">${NAV.map(navButton).join("")}</nav>
        <div class="sidebar-footer">
          <span class="label">Dolar ${escapeHtml(defaultRate.label)}</span>
          <strong class="mono">${formatMoney(defaultRate.sell, "ARS")}</strong>
          <span class="muted">${state.ratesStatus === "error" ? "[ERROR API]" : stale ? "[DESACTUALIZADO]" : "[ONLINE]"}</span>
        </div>
      </aside>
      <section class="main-shell">
        <header class="topbar">
          <div class="topbar-title">
            <div class="topbar-brand" aria-label="FIN OS">
              <strong>FIN//OS</strong>
            </div>
            <span class="label">${escapeHtml(activeLabel)}</span>
            <h1>${topbarTitle(metrics)}</h1>
          </div>
          <div class="topbar-actions">
            ${segmented("currency", ["ARS", "USD"], state.settings.displayCurrency)}
            <label class="select-wrap label" aria-label="Tipo de dolar">
              <select data-action="rateType">${optionList(EXCHANGE_RATE_TYPES.map((item) => ({ value: item.id, label: item.label })), state.settings.defaultExchangeRateType)}</select>
            </label>
            <button class="btn btn-secondary" data-action="openSetup" type="button">Configurar mes</button>
            <button class="btn btn-primary" data-action="openAdd" type="button">Agregar gasto</button>
          </div>
        </header>
        <main class="content">
          ${renderViews(metrics)}
        </main>
      </section>
      <button class="btn btn-primary fab" data-action="openAdd" type="button">+ Gasto</button>
      <nav class="mobile-bottom-nav" aria-label="Navegacion mobile">
        ${NAV.filter((item) => item.mobile).map((item) => mobileNavButton(item)).join("")}
        <button class="mobile-nav-item" data-action="openMobileMenu" type="button">Mas</button>
      </nav>
      ${setupModal()}
      ${addModal()}
      ${mobileMenu()}
    </div>
  `;
}

function topbarTitle(metrics) {
  if (state.activeView === "dashboard") return moneyARS(metrics.availableUntilMonthEndARS);
  if (state.activeView === "expenses") return moneyARS(metrics.expenseARS);
  if (state.activeView === "income") return moneyARS(metrics.incomeARS);
  if (state.activeView === "credit-card") return moneyARS(metrics.creditCardSummary.estimatedStatementTotal);
  if (state.activeView === "savings") return moneyARS(metrics.savingARS || state.savings.ars);
  if (state.activeView === "investments") return moneyARS(metrics.totalInvestedARS);
  return "Finanzas personales";
}

function navButton(item) {
  return `<button class="nav-item ${state.activeView === item.id ? "is-active" : ""}" data-view="${item.id}" type="button">${item.label}</button>`;
}

function mobileNavButton(item) {
  return `<button class="mobile-nav-item ${state.activeView === item.id ? "is-active" : ""}" data-view="${item.id}" type="button">${item.short || item.label}</button>`;
}

function renderViews(metrics) {
  const insights = generateInsights(metrics, state.settings, state.rates);
  const creditCardInsights = generateCreditCardInsights(metrics, state.settings, state.rates);
  const closing = generateMonthlyClosing(metrics, state.settings, state.rates);
  return [
    view("dashboard", dashboardView(metrics, insights)),
    view("expenses", transactionsView("expense", metrics)),
    view("income", transactionsView("income", metrics)),
    view("recurring", recurringView(metrics)),
    view("credit-card", creditCardView(metrics, creditCardInsights)),
    view("savings", savingsView(metrics)),
    view("investments", investmentsView(metrics)),
    view("budgets", budgetsView(metrics)),
    view("metrics", metricsView(metrics, insights)),
    view("closing", closingView(metrics, closing)),
    view("settings", settingsView()),
  ].join("");
}

function view(id, content) {
  return `<section id="view-${id}" class="view ${state.activeView === id ? "is-active" : ""}">${content}</section>`;
}

function dashboardView(metrics, insights) {
  const isZeroState = !metrics.hasCurrentData && !metrics.budgetsWithProgress.length;
  return h`
    <div class="grid dashboard-grid">
      <div class="section-stack">
        <article class="hero-metric">
          <div>
            <span class="label">Disponible estimado hasta fin de mes</span>
            <div class="hero-value">${moneyARS(metrics.availableUntilMonthEndARS, true)}</div>
            <div class="hero-meta">
              <span class="chip">Por dia <strong>${moneyARS(metrics.availablePerDayARS)}</strong></span>
              <span class="chip">Presupuestos <strong>${metrics.budgetsWithProgress.length ? "Configurados" : "Sin configurar"}</strong></span>
              <span class="chip">Dolar ${state.rates[state.settings.defaultExchangeRateType].label} <strong>${formatMoney(getRate(state.rates, state.settings.defaultExchangeRateType), "ARS")}</strong></span>
            </div>
          </div>
          <div class="hero-actions-compact">
            <button class="btn btn-primary" data-action="${isZeroState ? "openSetup" : "openAdd"}" type="button">${isZeroState ? "Configurar mes" : "Agregar gasto"}</button>
            <button class="btn btn-secondary" data-action="openAdd" data-type="income" type="button">Agregar ingreso</button>
          </div>
        </article>
        <div class="grid metrics-grid">
          ${metricCard("Disponible", metrics.availableUntilMonthEndARS)}
          ${metricCard("Gastos", metrics.expenseARS)}
          ${metricCard("Ingresos", metrics.incomeARS)}
          ${metricCard("Ahorro", metrics.savingARS)}
          ${metricCard("Inversiones", metrics.totalInvestedARS)}
          ${statCardText("Presupuestos", metrics.budgetsWithProgress.length ? `${metrics.budgetsWithProgress.length} activos` : "Sin configurar", "Defini limites por categoria.")}
          ${metricCard("Gasto fijo", metrics.fixedExpenseARS)}
          ${metricCard("Gasto variable", metrics.variableExpenseARS)}
        </div>
        ${isZeroState ? zeroStartPanel() : ""}
        ${chartCard(metrics)}
      </div>
      <aside class="section-stack">
        ${dollarWidget()}
        ${creditCardDashboardCard(metrics)}
        ${insightFeatured(metrics.hasCurrentData ? insights[0] : "Sin datos suficientes. Configura tu mes o carga tu primer movimiento.")}
        ${homeServicesNotice(metrics)}
        ${recentTransactions(metrics.recentTransactions)}
      </aside>
    </div>
  `;
}

function creditCardDashboardCard(metrics) {
  const summary = metrics.creditCardSummary;
  return `<section class="insight-card">
    <div class="row-between"><span class="label">Resumen de tarjeta</span><span class="chip"><span class="dot ${summary.statusTone}"></span>${escapeHtml(summary.statusLabel)}</span></div>
    <strong class="value mono">${moneyARS(summary.estimatedStatementTotal)}</strong>
    ${segments(summary.usagePercentage, summary.statusTone)}
    <div class="line-list">
      <div class="line-item"><span>Limite personal</span><strong class="mono">${moneyARS(summary.personalLimit)}</strong></div>
      <div class="line-item"><span>Disponible</span><strong class="mono ${summary.remainingAvailable < 0 ? "status-bad" : ""}">${moneyARS(summary.remainingAvailable)}</strong></div>
    </div>
    <button class="btn btn-secondary" data-view="credit-card" type="button">Ver resumen de tarjeta</button>
  </section>`;
}

function metricCard(label, amountARS, className = "") {
  const compact = Math.abs(amountARS) >= 1000000;
  return `<article class="stat-card">
    <span class="label">${label}</span>
    <strong class="value ${className}">${moneyARS(amountARS, compact)}</strong>
    <span class="hint">Vista en ${state.settings.displayCurrency}</span>
  </article>`;
}

function statCardText(label, value, hint) {
  return `<article class="stat-card">
    <span class="label">${escapeHtml(label)}</span>
    <strong class="value">${escapeHtml(value)}</strong>
    <span class="hint">${escapeHtml(hint)}</span>
  </article>`;
}

function zeroStartPanel() {
  return `<section class="panel">
    <div class="panel-head">
      <div><h2>Configura tu mes</h2><p>Arranca con ingreso, gastos fijos, objetivo sugerido de ahorro y presupuestos variables.</p></div>
    </div>
    <div class="grid three-grid">
      ${actionCard("Configurar mes", "Carga sueldo, alquiler, expensas y servicios. Comida y ocio se sugieren automaticamente.", "openSetup")}
      ${actionCard("Agregar ingreso", "Registra sueldo, freelance, extra u otro ingreso real.", "openAdd", "income")}
      ${actionCard("Agregar gasto", "Carga el primer gasto del mes sin pasos extra.", "openAdd", "expense")}
      ${actionCard("Definir presupuesto", "Crea limites variables para no pasarte durante el mes.", "openSetup")}
    </div>
  </section>`;
}

function actionCard(title, copy, action, type = "") {
  return `<article class="insight-card">
    <span class="label">${escapeHtml(title)}</span>
    <p class="muted">${escapeHtml(copy)}</p>
    <button class="btn btn-secondary" data-action="${action}" ${type ? `data-type="${type}"` : ""} type="button">${escapeHtml(title)}</button>
  </article>`;
}

function chartCard(metrics) {
  const rows = metrics.categoryRows.slice(0, 6);
  return `<section class="panel">
    <div class="panel-head">
      <div><h2>Gastos por categoria</h2><p>${rows.length ? "Las categorias con mayor impacto este mes." : "Cuando cargues movimientos, vas a ver tus metricas aca."}</p></div>
    </div>
    ${rows.length ? `<div class="chart-bars">${rows.map((row) => `
      <div class="chart-row">
        <div class="row-between"><span>${escapeHtml(row.category)}</span><span class="mono">${moneyARS(row.amountARS)}</span></div>
        ${segments(row.percentage, row.percentage > 32 ? "bad" : row.percentage > 22 ? "warn" : "neutral")}
      </div>
    `).join("")}</div>` : emptyState("Agrega tu primer gasto", "Cuando cargues gastos por categoria, vamos a mostrar en que se va la plata.")}
  </section>`;
}

function dollarWidget() {
  const rows = EXCHANGE_RATE_TYPES.map((type) => state.rates[type.id]);
  const selected = state.rates[state.settings.defaultExchangeRateType];
  const statusText = state.ratesStatus === "error" ? state.ratesMessage : isRateStale(selected) ? "Cotizacion desactualizada" : "Cotizacion actualizada";
  return `<section class="panel">
    <div class="panel-head">
      <div><h2>Dolar</h2><p>${escapeHtml(statusText)}</p></div>
      <button class="btn btn-secondary" data-action="refreshRates" type="button">Actualizar</button>
    </div>
    <div class="line-list">
      ${rows.map((rate) => `<div class="line-item">
        <span><span class="dot ${rate.type === state.settings.defaultExchangeRateType ? "bad" : ""}"></span> ${escapeHtml(rate.label)}</span>
        <strong class="mono">${formatMoney(rate.sell, "ARS")}</strong>
      </div>`).join("")}
    </div>
    <p class="inline-status ${state.ratesStatus === "error" ? "is-error" : ""}">[${state.ratesStatus.toUpperCase()}] ${escapeHtml(state.ratesMessage)}</p>
  </section>`;
}

function insightFeatured(text) {
  return `<section class="insight-card">
    <span class="label">Insight destacado</span>
    <strong>${escapeHtml(text)}</strong>
  </section>`;
}

function homeServicesNotice(metrics) {
  if (!metrics.incomeARS || metrics.ratios.homeServices <= 30) return "";
  return `<section class="insight-card">
    <span class="label">Casa y servicios</span>
    <strong>Casa y servicios supera el 30% recomendado para este mes.</strong>
    <p class="muted">Revisa alquiler, expensas y servicios dentro de este grupo.</p>
  </section>`;
}

function recentTransactions(items) {
  return `<section class="panel">
    <div class="panel-head"><div><h2>Movimientos recientes</h2><p>Ultimos registros del mes.</p></div></div>
    ${items.length ? transactionList(items) : emptyState("Mes sin movimientos", "La carga rapida queda siempre accesible.")}
  </section>`;
}

function transactionList(items) {
  return `<div class="transaction-list">${items.map(transactionItem).join("")}</div>`;
}

function transactionItem(item) {
  const amountARS = movementToARS(item);
  const isExpense = item.type === "expense";
  const sign = item.type === "income" ? "+" : isExpense ? "-" : "";
  const className = item.type === "income" ? "status-good" : isExpense ? "status-bad" : "";
  const installmentLabel = item.isInstallment ? ` · cuota ${item.installmentCurrent || 1}/${item.installmentTotal || 1}` : "";
  return `<article class="transaction-item">
    <div class="transaction-main">
      <div class="transaction-title">
        <span class="dot ${isExpense ? "bad" : item.type === "income" ? "good" : "warn"}"></span>
        <strong>${escapeHtml(item.description || item.category || "Sin categoria")}${escapeHtml(installmentLabel)}</strong>
      </div>
      <div class="transaction-meta">${formatDate(item.date)} · ${escapeHtml(TYPE_LABELS[item.type])} · ${escapeHtml(item.category || "Sin categoria")} · ${item.isRecurring ? "Recurrente" : "Unico"}</div>
    </div>
    <div class="transaction-amount ${className}">${sign}${moneyARS(amountARS)}</div>
  </article>`;
}

function transactionsView(type, metrics) {
  const items = state.transactions.filter((item) => item.type === type && item.date.slice(0, 7) === metrics.monthKey).sort((a, b) => b.date.localeCompare(a.date));
  const emptyTitle = type === "expense" ? "Sin gastos cargados" : "Sin ingresos registrados";
  const emptyCopy = type === "expense" ? "Agrega el primer gasto del mes con el boton principal." : "Registra sueldo, freelance o ingresos extra para calcular ratios reales.";
  return `<div class="section-stack">
    <section class="panel">
      <div class="panel-head">
        <div><h2>${type === "expense" ? "Gastos" : "Ingresos"}</h2><p>${type === "expense" ? "Carga simple, categorias y recurrencia." : "Ingresos fijos y variables para medir ahorro."}</p></div>
        <button class="btn btn-primary" data-action="openAdd" data-type="${type}" type="button">${type === "expense" ? "Agregar gasto" : "Agregar ingreso"}</button>
      </div>
      ${items.length ? transactionList(items) : emptyState(emptyTitle, emptyCopy)}
    </section>
  </div>`;
}

function recurringView(metrics) {
  return `<div class="section-stack">
    <div class="grid metrics-grid">
      ${metricCard("Total mensual fijo", metrics.fixedMonthlyARS)}
      ${metricCard("Gastos fijos reales", metrics.fixedExpenseARS)}
      ${metricCard("Gastos variables", metrics.variableExpenseARS)}
      <article class="stat-card"><span class="label">Relacion fijo / variable</span><strong class="value">${metrics.expenseARS ? Math.round((metrics.fixedExpenseARS / metrics.expenseARS) * 100) : 0}%</strong><span class="hint">Del gasto mensual</span></article>
    </div>
    <section class="panel">
      <div class="panel-head"><div><h2>Gastos recurrentes</h2><p>Activos, pausados y proximos vencimientos.</p></div></div>
      <div class="grid two-grid">
        ${state.recurringExpenses.length ? state.recurringExpenses.map((item) => recurringCard(item)).join("") : emptyState("Sin gastos recurrentes", "Configura tu mes o marca un gasto como recurrente para verlo aca.")}
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Cuotas activas</h2><p>Pagos en cuotas que todavia tienen meses pendientes.</p></div></div>
      <div class="grid two-grid">
        ${metrics.activeInstallments.length ? metrics.activeInstallments.map(installmentCard).join("") : emptyState("Sin cuotas cargadas", "Cuando estes pagando una compra en cuotas, marcala al cargar el gasto.")}
      </div>
    </section>
  </div>`;
}

function recurringCard(item) {
  return `<article class="recurring-card">
    <div class="row-between"><span class="label">${escapeHtml(item.category)}</span><span class="chip">${item.status === "active" ? "Activo" : "Pausado"}</span></div>
    <strong class="transaction-title">${escapeHtml(item.name)}</strong>
    <div class="row-between"><span class="muted">Proximo</span><span class="mono">${formatDate(item.nextDueDate)}</span></div>
    <div class="row-between"><span class="muted">Monto</span><strong class="mono">${formatMoney(convertFromARS(toARS(item.amount, item.currency, item.exchangeRate), state.settings.displayCurrency, state.rates, state.settings.defaultExchangeRateType), state.settings.displayCurrency)}</strong></div>
  </article>`;
}

function installmentCard(item) {
  const current = Number(item.installmentCurrent || 1);
  const total = Number(item.installmentTotal || 1);
  const remaining = Number(item.installmentsRemaining ?? Math.max(total - current, 0));
  return `<article class="recurring-card">
    <div class="row-between"><span class="label">Cuota</span><span class="chip">${current}/${total}</span></div>
    <strong class="transaction-title">${escapeHtml(item.description || "Compra en cuotas")}</strong>
    <div class="row-between"><span class="muted">Monto mensual</span><strong class="mono">${moneyARS(item.amountARS || movementToARS(item))}</strong></div>
    <div class="row-between"><span class="muted">Restantes</span><span class="mono">${remaining}</span></div>
  </article>`;
}

function creditCardView(metrics, insights) {
  const summary = metrics.creditCardSummary;
  return `<div class="section-stack">
    <div class="grid metrics-grid">
      ${metricCard("Resumen estimado", summary.estimatedStatementTotal)}
      ${metricCard("Cuotas comprometidas", summary.committedInstallmentsTotal)}
      ${metricCard("Consumos nuevos", summary.newCreditCardPurchasesTotal)}
      <article class="stat-card"><span class="label">Uso del limite</span><strong class="value">${summary.usagePercentage.toFixed(0)}%</strong><span class="hint">${escapeHtml(summary.statusLabel)}</span></article>
    </div>
    <section class="panel">
      <div class="panel-head">
        <div><h2>Resumen de tarjeta</h2><p>Control mensual flexible para no pasarte de tu limite personal.</p></div>
        <span class="chip"><span class="dot ${summary.statusTone}"></span>${escapeHtml(summary.statusLabel)}</span>
      </div>
      <div class="grid two-grid">
        <article class="insight-card">
          <span class="label">${summary.isLimitConfigured ? "Limite personal mensual" : "Limite sugerido mensual"}</span>
          <strong class="value mono">${moneyARS(summary.personalLimit)}</strong>
          ${segments(summary.usagePercentage, summary.statusTone)}
          <div class="row-between"><span class="muted">Disponible restante</span><span class="mono ${summary.remainingAvailable < 0 ? "status-bad" : ""}">${moneyARS(summary.remainingAvailable)}</span></div>
        </article>
        <form class="insight-card" id="credit-card-settings-form">
          <span class="label">Editar limite</span>
          <div class="field">
            <label for="cardLimit">Limite personal ARS</label>
            <input id="cardLimit" name="monthlyPersonalLimit" type="number" inputmode="decimal" min="0" step="0.01" value="${Number(state.creditCardSettings.monthlyPersonalLimit || 500000)}" required>
          </div>
          <button class="btn btn-secondary" type="submit">Guardar limite</button>
        </form>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Cuotas comprometidas</h2><p>Compras anteriores que impactan en el resumen actual.</p></div></div>
      <div class="grid two-grid">
        ${summary.committedInstallments.length ? summary.committedInstallments.map(installmentCard).join("") : emptyState("Sin cuotas comprometidas", "Cuando cargues cuotas, vamos a mostrar tus compromisos mensuales.")}
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Consumos nuevos con tarjeta</h2><p>Compras del mes pagadas con tarjeta de credito.</p></div></div>
      ${summary.newCreditCardPurchases.length ? transactionList(summary.newCreditCardPurchases) : emptyState("Sin consumos con tarjeta", "Cuando cargues consumos con tarjeta, vas a ver tu resumen aca.")}
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Insights de tarjeta</h2><p>Solo se muestran recomendaciones cuando hay datos suficientes.</p></div></div>
      <div class="grid two-grid">${insights.map((text) => `<article class="insight-card"><strong>${escapeHtml(text)}</strong></article>`).join("")}</div>
    </section>
  </div>`;
}

function savingsView(metrics) {
  const totalGoal = state.savings.totalGoal || state.settings.totalSavingsGoal || 0;
  const monthlyGoal = state.savings.monthlyGoal || state.settings.monthlySavingsGoal || 0;
  const totalProgress = totalGoal ? (metrics.savingsARS / totalGoal) * 100 : 0;
  const monthlyProgress = monthlyGoal ? (metrics.savingARS / monthlyGoal) * 100 : 0;
  if (!monthlyGoal && !metrics.savingARS) {
    return `<div class="section-stack">
      <section class="panel">
        <div class="panel-head"><div><h2>Ahorros</h2><p>Defini tu ingreso mensual para calcular tu objetivo de ahorro.</p></div></div>
        ${emptyState("Sin objetivo de ahorro", "Tu objetivo sugerido de ahorro se calculara automaticamente como el 40% de tus ingresos.")}
      </section>
    </div>`;
  }
  return `<div class="section-stack">
    <div class="grid two-grid">
      <article class="hero-metric">
        <div>
          <span class="label">Meta general de ahorro</span>
          <div class="hero-value">${Math.min(totalProgress, 100).toFixed(0)}%</div>
          <div class="hero-meta"><span class="chip">Actual <strong>${moneyARS(metrics.savingsARS)}</strong></span><span class="chip">Meta <strong>${totalGoal ? moneyARS(totalGoal) : "Sin definir"}</strong></span></div>
        </div>
        ${segments(totalProgress, totalProgress >= 80 ? "good" : "neutral")}
      </article>
      <section class="panel">
        <div class="panel-head"><div><h2>Ahorro mensual</h2><p>Porcentaje de ingresos destinado a ahorro.</p></div></div>
        <article class="saving-card">
          <span class="label">Objetivo mensual</span>
          <strong class="value mono">${moneyARS(monthlyGoal)}</strong>
          ${segments(monthlyProgress, monthlyProgress >= 100 ? "good" : monthlyProgress >= 75 ? "warn" : "neutral")}
          <span class="muted">${monthlyProgress.toFixed(0)}% cumplido · ${metrics.ratios.savings.toFixed(0)}% de ingresos</span>
        </article>
      </section>
    </div>
    <section class="panel">
      <div class="panel-head"><div><h2>Historico de ahorro</h2><p>Mes a mes, sin ruido visual.</p></div></div>
      <div class="chart-bars">
        ${state.savings.history.map((row) => `<div class="chart-row"><div class="row-between"><span>${row.month}</span><span class="mono">${moneyARS(row.amount)}</span></div>${segments((row.amount / state.savings.monthlyGoal) * 100, row.amount >= state.savings.monthlyGoal ? "good" : "neutral")}</div>`).join("")}
      </div>
    </section>
  </div>`;
}

function investmentsView(metrics) {
  return `<div class="section-stack">
    <div class="grid metrics-grid">
      ${metricCard("Total invertido", metrics.totalInvestedARS)}
      ${metricCard("Invertido este mes", metrics.investedThisMonthARS)}
      <article class="stat-card"><span class="label">% de ingresos</span><strong class="value">${metrics.ratios.investments.toFixed(0)}%</strong><span class="hint">Destinado a inversion</span></article>
      <article class="stat-card"><span class="label">Tipo principal</span><strong class="value">${state.investments[0]?.type || "Sin datos"}</strong><span class="hint">Seguimiento simple</span></article>
    </div>
    <section class="panel">
      <div class="panel-head"><div><h2>Inversiones simples</h2><p>Registro personal, no plataforma de trading.</p></div></div>
      <div class="grid three-grid">
        ${state.investments.length ? state.investments.map(investmentCard).join("") : emptyState("Sin inversiones cargadas", "Agrega una inversion para seguir valor actual y rendimiento.")}
      </div>
    </section>
  </div>`;
}

function investmentCard(item) {
  const valueARS = toARS(item.currentValue, item.currency, item.exchangeRate || getRate(state.rates, state.settings.defaultExchangeRateType));
  return `<article class="investment-card">
    <div class="row-between"><span class="label">${escapeHtml(item.type)}</span><span class="${item.performance >= 0 ? "status-good" : "status-bad"} mono">${formatPercent(item.performance)}</span></div>
    <strong class="value mono">${moneyARS(valueARS)}</strong>
    <p class="muted">${escapeHtml(item.notes)}</p>
    <span class="label">${formatDate(item.date)}</span>
  </article>`;
}

function budgetsView(metrics) {
  return `<div class="section-stack">
    <section class="panel">
      <div class="panel-head"><div><h2>Presupuestos</h2><p>Disponible, usado, excedido y proyeccion de cierre.</p></div></div>
      <div class="grid two-grid">
        ${metrics.budgetsWithProgress.length ? metrics.budgetsWithProgress.map(budgetCard).join("") : emptyState("Presupuestos sin configurar", "Defini presupuestos variables desde Configurar mes para evitar pasarte.")}
      </div>
    </section>
  </div>`;
}

function budgetCard(budget) {
  const status = budget.status === "exceeded" ? "bad" : budget.status === "near" ? "warn" : "good";
  const statusText = budget.status === "exceeded" ? "Excedido" : budget.status === "near" ? "Cerca del limite" : "Dentro del presupuesto";
  return `<article class="budget-card is-${budget.status}">
    <div class="row-between"><span class="label">${escapeHtml(budget.category)}</span><span class="chip"><span class="dot ${status}"></span>${statusText}</span></div>
    <div class="row-between"><strong class="mono">${moneyARS(budget.spent)}</strong><span class="muted">de ${moneyARS(toARS(budget.monthlyLimit, budget.currency, getRate(state.rates, state.settings.defaultExchangeRateType)))}</span></div>
    ${segments(budget.percentageUsed, status)}
    <div class="row-between"><span class="muted">Disponible</span><span class="mono ${budget.remaining < 0 ? "status-bad" : ""}">${moneyARS(budget.remaining)}</span></div>
    <div class="row-between"><span class="muted">Proyeccion</span><span class="mono">${moneyARS(budget.projectedARS)}</span></div>
  </article>`;
}

function metricsView(metrics, insights) {
  if (!metrics.hasCurrentData) {
    return `<div class="section-stack">
      <section class="panel">
        <div class="panel-head"><div><h2>Metricas</h2><p>Cuando cargues movimientos, vas a ver tus metricas aca.</p></div></div>
        <div class="grid two-grid">${insights.map((text) => `<article class="insight-card"><strong>${escapeHtml(text)}</strong></article>`).join("")}</div>
      </section>
    </div>`;
  }
  return `<div class="section-stack">
    <div class="grid metrics-grid">
      <article class="stat-card"><span class="label">Promedio diario</span><strong class="value">${moneyARS(metrics.dailyAverageARS)}</strong><span class="hint">Gasto por dia</span></article>
      <article class="stat-card"><span class="label">Proyeccion mensual</span><strong class="value">${moneyARS(metrics.projectedExpenseARS)}</strong><span class="hint">Si sigue el ritmo</span></article>
      <article class="stat-card"><span class="label">% gasto / ingreso</span><strong class="value">${metrics.ratios.expenses.toFixed(0)}%</strong><span class="hint">Presion de gasto</span></article>
      <article class="stat-card"><span class="label">Fijo / variable</span><strong class="value">${metrics.expenseARS ? Math.round((metrics.fixedExpenseARS / metrics.expenseARS) * 100) : 0}%</strong><span class="hint">Gasto fijo</span></article>
    </div>
    <section class="panel">
      <div class="panel-head"><div><h2>Insights accionables</h2><p>Simple, directo y sin alarmismo.</p></div></div>
      <div class="grid two-grid">${insights.map((text) => `<article class="insight-card"><strong>${escapeHtml(text)}</strong></article>`).join("")}</div>
    </section>
    ${chartCard(metrics)}
  </div>`;
}

function closingView(metrics, closing) {
  return `<div class="section-stack">
    <section class="panel">
      <div class="panel-head"><div><h2>Cierre mensual</h2><p>Revision del comportamiento financiero del mes.</p></div></div>
      <div class="grid metrics-grid">
        ${metricCard("Ingreso", metrics.incomeARS)}
        ${metricCard("Gasto", metrics.expenseARS, "status-bad")}
        ${metricCard("Ahorro", metrics.savingARS, "status-good")}
        ${metricCard("Inversion", metrics.investedThisMonthARS)}
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Resumen</h2><p>${escapeHtml(closing.summary)}</p></div></div>
      <div class="grid two-grid">
        <article class="insight-card"><span class="label">Mayor desvio</span><strong>${escapeHtml(closing.biggestDeviation?.category || "Sin datos")}</strong><span class="muted">${closing.biggestDeviation ? `${closing.biggestDeviation.percentageUsed.toFixed(0)}% usado` : "Sin presupuestos configurados"}</span></article>
        <article class="insight-card"><span class="label">Recomendacion</span><strong>${escapeHtml(closing.recommendation)}</strong></article>
        <article class="insight-card"><span class="label">Categoria que subio</span><strong>${escapeHtml(closing.increasedCategory)}</strong></article>
        <article class="insight-card"><span class="label">Categoria que bajo</span><strong>${escapeHtml(closing.decreasedCategory)}</strong></article>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Top 3 gastos</h2><p>Movimientos mas grandes del mes.</p></div></div>
      ${closing.topExpenses.length ? transactionList(closing.topExpenses) : emptyState("Mes sin gastos", "No hay gastos para cerrar.")}
    </section>
  </div>`;
}

function settingsView() {
  return `<div class="section-stack">
    <section class="panel">
      <div class="panel-head"><div><h2>Configuracion</h2><p>Moneda, cotizacion por defecto y criterios de visualizacion.</p></div></div>
      <div class="grid two-grid">
        <article class="insight-card"><span class="label">Visualizacion</span><strong>${state.settings.displayCurrency}</strong><p class="muted">El toggle global cambia todos los valores calculados.</p></article>
        <article class="insight-card"><span class="label">Cotizacion default</span><strong>${state.rates[state.settings.defaultExchangeRateType].label}</strong><p class="muted">La arquitectura soporta oficial, blue y MEP.</p></article>
        <article class="insight-card"><span class="label">Tasa historica</span><strong>${state.settings.useSavedRateForHistory ? "Usar guardada" : "Usar actual"}</strong><p class="muted">Cada movimiento conserva moneda original y tipo de cambio.</p></article>
        <article class="insight-card"><span class="label">Limite tarjeta</span><strong>${moneyARS(state.creditCardSettings.monthlyPersonalLimit || 500000)}</strong><p class="muted">Regla personal editable desde Resumen de tarjeta.</p></article>
        <article class="insight-card"><span class="label">API</span><strong>DolarApi</strong><p class="muted">Si falla, se muestra error y se usa fallback local.</p></article>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Casos borde contemplados</h2><p>Estados vacios, error de API, presupuesto excedido, sin ingresos y cotizacion desactualizada.</p></div></div>
      <div class="grid two-grid">
        ${emptyState("Estado vacio", "La UI resuelve secciones sin datos con una accion clara.")}
        ${state.ratesStatus === "error" ? errorState("Error de cotizacion", state.ratesMessage) : emptyState("Cotizacion online", "La cotizacion se actualizo correctamente.")}
      </div>
    </section>
  </div>`;
}

function emptyState(title, copy) {
  return `<div class="empty-state"><span class="label">${escapeHtml(title)}</span><p>${escapeHtml(copy)}</p></div>`;
}

function errorState(title, copy) {
  return `<div class="error-state"><span class="label">[ERROR] ${escapeHtml(title)}</span><p>${escapeHtml(copy)}</p></div>`;
}

function isCreditCardPayment(method) {
  return method === "Tarjeta de credito" || method === "Credito";
}

function setupModal() {
  return `<div class="modal-backdrop ${state.setupOpen ? "is-open" : ""}" role="dialog" aria-modal="true" aria-labelledby="setup-title">
    <form class="modal" id="setup-form">
      <div class="modal-head">
        <div><span class="label">Nuevo mes</span><h2 id="setup-title">Configurar mes</h2></div>
        <button class="btn btn-secondary" data-action="closeSetup" type="button">[ X ]</button>
      </div>
      <div class="modal-body">
        <p class="muted">Carga solo datos reales. El objetivo de ahorro se fija siempre en 40% del sueldo; comida y ocio se calculan con lo que queda despues de alquiler, expensas y servicios.</p>
        <div class="form-grid">
          <div class="field full"><label for="monthlyIncome">Sueldo mensual</label><input id="monthlyIncome" name="monthlyIncome" type="number" inputmode="decimal" min="0" step="0.01" required placeholder="Sueldo real del mes"></div>
          <div class="field"><label for="rent">Alquiler</label><input id="rent" name="rent" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Opcional"></div>
          <div class="field"><label for="buildingFees">Expensas</label><input id="buildingFees" name="buildingFees" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Opcional"></div>
          <div class="field"><label for="utilities">Servicios</label><input id="utilities" name="utilities" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Opcional"></div>
        </div>
        <div class="panel nested-panel">
          <div class="panel-head"><div><h3>Presupuestos sugeridos</h3><p>Comida usa 75% de la bolsa variable y ocio 25%. La bolsa variable es sueldo menos ahorro, alquiler, expensas y servicios.</p></div></div>
          <div class="line-list">
            <div class="line-item"><span>Objetivo de ahorro</span><strong class="mono">40% del sueldo</strong></div>
            <div class="line-item"><span>Comida</span><strong class="mono">75% de variable</strong></div>
            <div class="line-item"><span>Ocio</span><strong class="mono">25% de variable</strong></div>
          </div>
        </div>
        <div class="inline-status ${state.setupStatus.startsWith("[ERROR") ? "is-error" : ""}">${escapeHtml(state.setupStatus || "[GUIA] Ahorro: 40% del sueldo. Comida y ocio se definen automaticamente.")}</div>
        <button class="btn btn-primary" type="submit">Guardar configuracion</button>
      </div>
    </form>
  </div>`;
}

function addModal() {
  const rate = getRate(state.rates, state.settings.defaultExchangeRateType);
  return `<div class="modal-backdrop ${state.modalOpen ? "is-open" : ""}" role="dialog" aria-modal="true" aria-labelledby="add-title">
    <form class="modal" id="transaction-form">
      <div class="modal-head">
        <div><span class="label">Carga rapida</span><h2 id="add-title">Agregar ${TYPE_LABELS[state.modalType].toLowerCase()}</h2></div>
        <button class="btn btn-secondary" data-action="closeAdd" type="button">[ X ]</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="field full"><label for="amount">Monto</label><input id="amount" name="amount" type="number" inputmode="decimal" min="0" step="0.01" required autofocus placeholder="Monto real"></div>
          <div class="field"><label for="type">Tipo</label><select id="type" name="type">${optionList([{ value: "expense", label: "Gasto" }, { value: "income", label: "Ingreso" }, { value: "saving", label: "Ahorro" }, { value: "investment", label: "Inversion" }], state.modalType)}</select></div>
          <div class="field"><label for="currency">Moneda</label><select id="currency" name="currency">${optionList(["ARS", "USD"], "ARS")}</select></div>
          <div class="field"><label for="category">Categoria</label><select id="category" name="category">${optionList(CATEGORIES, "Ocio")}</select></div>
          <div class="field"><label for="subcategory">Subcategoria</label><select id="subcategory" name="subcategory"><option value="">Sin subcategoria</option>${optionList(FOOD_SUBCATEGORIES, "")}</select></div>
          <div class="field"><label for="date">Fecha</label><input id="date" name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required></div>
          <div class="field"><label for="paymentMethod">Metodo</label><select id="paymentMethod" name="paymentMethod"><option value="">Sin metodo</option>${optionList(PAYMENT_METHODS, "")}</select></div>
          <div class="field full"><label for="description">Descripcion opcional</label><textarea id="description" name="description" placeholder="Ej: cena, supermercado, cuota"></textarea></div>
        </div>
        <div class="switch-row">
          <label class="check-pill"><input type="checkbox" name="isFixed"> Gasto fijo</label>
          <label class="check-pill"><input type="checkbox" name="isRecurring"> Recurrente</label>
        </div>
        <div class="panel nested-panel">
          <div class="panel-head"><div><h3>Tarjeta de credito</h3><p>Si el metodo es tarjeta de credito, separa consumo nuevo o compra en cuotas.</p></div></div>
          <div class="form-grid">
            <div class="field"><label for="creditInstallments">Es en cuotas</label><select id="creditInstallments" name="creditInstallments">${optionList([{ value: "no", label: "No" }, { value: "yes", label: "Si" }], "no")}</select></div>
            <div class="field"><label for="purchaseTotalAmount">Monto total compra</label><input id="purchaseTotalAmount" name="purchaseTotalAmount" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Solo si es en cuotas"></div>
            <div class="field"><label for="totalInstallments">Cantidad de cuotas</label><input id="totalInstallments" name="totalInstallments" type="number" inputmode="numeric" min="1" step="1" placeholder="Solo si es en cuotas"></div>
            <div class="field"><label for="firstInstallmentMonth">Primer mes</label><input id="firstInstallmentMonth" name="firstInstallmentMonth" type="month" value="${new Date().toISOString().slice(0, 7)}"></div>
          </div>
        </div>
        <div class="inline-status ${state.formStatus.startsWith("[ERROR") ? "is-error" : ""}">${escapeHtml(state.formStatus || `[TIPO DE CAMBIO ${state.rates[state.settings.defaultExchangeRateType].label.toUpperCase()}: ${formatMoney(rate, "ARS")}]`)}</div>
        <button class="btn btn-primary" type="submit">Guardar</button>
      </div>
    </form>
  </div>`;
}

function mobileMenu() {
  return `<div class="mobile-menu-backdrop ${state.mobileMenuOpen ? "is-open" : ""}">
    <div class="mobile-menu">
      <div class="mobile-menu-head"><h2>Secciones</h2><button class="btn btn-secondary" data-action="closeMobileMenu" type="button">[ X ]</button></div>
      <nav class="mobile-menu-list">${NAV.map((item) => `<button class="mobile-menu-item ${state.activeView === item.id ? "is-active" : ""}" data-view="${item.id}" type="button">${item.label}</button>`).join("")}</nav>
    </div>
  </div>`;
}

function setView(viewId) {
  state.activeView = viewId;
  state.mobileMenuOpen = false;
  render();
}

function handleAction(target) {
  const action = target.dataset.action;
  if (!action) return false;

  if (action === "openAdd") {
    state.modalOpen = true;
    state.setupOpen = false;
    state.modalType = target.dataset.type || "expense";
    state.formStatus = "";
    render();
    return true;
  }
  if (action === "openSetup") {
    state.setupOpen = true;
    state.modalOpen = false;
    state.setupStatus = "";
    render();
    return true;
  }
  if (action === "closeSetup") {
    state.setupOpen = false;
    render();
    return true;
  }
  if (action === "closeAdd") {
    state.modalOpen = false;
    render();
    return true;
  }
  if (action === "currency") {
    state.settings.displayCurrency = target.dataset.value;
    persist();
    render();
    return true;
  }
  if (action === "rateType") {
    state.settings.defaultExchangeRateType = target.value;
    persist();
    render();
    return true;
  }
  if (action === "refreshRates") {
    refreshRates();
    return true;
  }
  if (action === "openMobileMenu") {
    state.mobileMenuOpen = true;
    render();
    return true;
  }
  if (action === "closeMobileMenu") {
    state.mobileMenuOpen = false;
    render();
    return true;
  }
  return false;
}

function handleSubmit(event) {
  event.preventDefault();
  if (event.target.id === "setup-form") {
    handleSetupSubmit(event.target);
    return;
  }
  if (event.target.id === "credit-card-settings-form") {
    handleCreditCardSettingsSubmit(event.target);
    return;
  }
  const form = event.target;
  const formData = new FormData(form);
  const amount = Number(formData.get("amount"));
  const type = formData.get("type");
  if (!amount || amount <= 0) {
    state.formStatus = "[ERROR] Ingresa un monto valido.";
    render();
    return;
  }

  const currency = formData.get("currency");
  const now = new Date().toISOString();
  const rate = getRate(state.rates, state.settings.defaultExchangeRateType);
  const category = normalizeCategory(formData.get("category") || "Otros");
  const paymentMethod = String(formData.get("paymentMethod") || "");
  const isCreditCard = isCreditCardPayment(paymentMethod);
  const isInstallmentPurchase = type === "expense" && isCreditCard && formData.get("creditInstallments") === "yes";
  const description = String(formData.get("description") || "").trim();
  const subcategory = String(formData.get("subcategory") || "").trim();

  if (isInstallmentPurchase) {
    const totalAmount = Number(formData.get("purchaseTotalAmount")) || amount;
    const totalInstallments = readPositiveInteger(formData.get("totalInstallments"), 1);
    const installmentAmount = totalAmount / totalInstallments;
    const firstInstallmentMonth = String(formData.get("firstInstallmentMonth") || monthKeyFromDate(formData.get("date")));
    const purchaseId = `ip-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
    const purchase = {
      id: purchaseId,
      totalAmount,
      currency,
      exchangeRate: rate,
      exchangeRateType: state.settings.defaultExchangeRateType,
      category,
      subcategory,
      description,
      paymentMethod,
      totalInstallments,
      installmentAmount,
      firstInstallmentMonth,
      installmentsPaid: 0,
      installmentsRemaining: totalInstallments,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    const installmentTransactions = Array.from({ length: totalInstallments }, (_, index) => ({
      id: `tx-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}-${index + 1}`,
      type,
      amount: installmentAmount,
      currency,
      exchangeRate: rate,
      exchangeRateType: state.settings.defaultExchangeRateType,
      category,
      subcategory,
      description: description || "Compra en cuotas",
      date: dateFromMonthKey(addMonthsToKey(firstInstallmentMonth, index)),
      paymentMethod,
      isFixed: formData.get("isFixed") === "on",
      isRecurring: false,
      isCreditCard: true,
      isInstallment: true,
      installmentPurchaseId: purchaseId,
      installmentCurrent: index + 1,
      installmentTotal: totalInstallments,
      createdAt: now,
      updatedAt: now,
    }));

    state.installmentPurchases = [purchase, ...state.installmentPurchases];
    state.transactions = [...installmentTransactions, ...state.transactions];
    state.formStatus = "[SAVED]";
    state.modalOpen = false;
    state.activeView = "credit-card";
    persist();
    render();
    return;
  }

  const item = {
    id: `tx-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
    type,
    amount,
    currency,
    exchangeRate: rate,
    exchangeRateType: state.settings.defaultExchangeRateType,
    category,
    subcategory,
    description,
    date: formData.get("date"),
    paymentMethod,
    isFixed: formData.get("isFixed") === "on",
    isRecurring: formData.get("isRecurring") === "on",
    isCreditCard,
    isInstallment: false,
    installmentPurchaseId: "",
    createdAt: now,
    updatedAt: now,
  };

  state.transactions = [item, ...state.transactions];

  if (item.type === "saving") {
    state.savings = {
      ...state.savings,
      ars: item.currency === "ARS" ? state.savings.ars + item.amount : state.savings.ars,
      usd: item.currency === "USD" ? state.savings.usd + item.amount : state.savings.usd,
    };
  }

  if (item.type === "investment") {
    state.investments = [{
      id: `inv-${Date.now()}`,
      type: item.category || "Otros",
      amountInvested: item.amount,
      currentValue: item.amount,
      currency: item.currency,
      performance: 0,
      date: item.date,
      notes: item.description || "Seguimiento personal.",
    }, ...state.investments];
  }

  if (item.isRecurring && item.type === "expense") {
    state.recurringExpenses = [{
      id: `rec-${Date.now()}`,
      name: item.description || item.category,
      amount: item.amount,
      currency: item.currency,
      exchangeRate: item.exchangeRate,
      category: item.category,
      frequency: "monthly",
      nextDueDate: nextMonthDate(item.date),
      status: "active",
      createdAt: now,
      updatedAt: now,
    }, ...state.recurringExpenses];
  }

  state.formStatus = "[SAVED]";
  state.modalOpen = false;
  state.activeView = item.isCreditCard ? "credit-card" : type === "income" ? "income" : type === "expense" ? "expenses" : type === "saving" ? "savings" : "investments";
  persist();
  render();
}

function readAmount(formData, key) {
  const value = Number(formData.get(key));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function readPositiveInteger(value, fallback = 1) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeCategory(value) {
  return String(value || "Otros").replace(/oseo/gi, "Ocio");
}

function monthKeyFromDate(value) {
  return String(value || new Date().toISOString()).slice(0, 7);
}

function monthToIndex(monthKey) {
  const [year, month] = String(monthKey || monthKeyFromDate()).split("-").map(Number);
  return year * 12 + month - 1;
}

function addMonthsToKey(monthKey, offset) {
  const index = monthToIndex(monthKey) + offset;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function dateFromMonthKey(monthKey) {
  return `${monthKey}-01`;
}

function handleCreditCardSettingsSubmit(form) {
  const formData = new FormData(form);
  const monthlyPersonalLimit = Number(formData.get("monthlyPersonalLimit"));
  if (!Number.isFinite(monthlyPersonalLimit) || monthlyPersonalLimit <= 0) {
    state.formStatus = "[ERROR] Ingresa un limite valido.";
    render();
    return;
  }
  state.creditCardSettings = {
    ...state.creditCardSettings,
    monthlyPersonalLimit,
    currency: "ARS",
    month: monthKeyFromDate(),
    warningThreshold: 70,
    dangerThreshold: 90,
  };
  persist();
  render();
}

function makeTransaction({ type, amount, category, description, isFixed = false, isRecurring = false }) {
  const now = new Date().toISOString();
  const rate = getRate(state.rates, state.settings.defaultExchangeRateType);
  return {
    id: `tx-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}-${Math.round(Math.random() * 10000)}`,
    type,
    amount,
    currency: "ARS",
    exchangeRate: rate,
    exchangeRateType: state.settings.defaultExchangeRateType,
    category,
    description,
    date: new Date().toISOString().slice(0, 10),
    paymentMethod: "Transferencia",
    isFixed,
    isRecurring,
    isCreditCard: false,
    isInstallment: false,
    installmentPurchaseId: "",
    createdAt: now,
    updatedAt: now,
  };
}

function makeRecurringFromTransaction(item) {
  return {
    id: `rec-${Date.now()}-${Math.round(Math.random() * 10000)}`,
    name: item.description || item.category,
    amount: item.amount,
    currency: item.currency,
    exchangeRate: item.exchangeRate,
    category: item.category,
    frequency: "monthly",
    nextDueDate: nextMonthDate(item.date),
    status: "active",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function handleSetupSubmit(form) {
  const formData = new FormData(form);
  const income = readAmount(formData, "monthlyIncome");
  if (!income) {
    state.setupStatus = "[ERROR] Carga tu ingreso mensual real para configurar el mes.";
    render();
    return;
  }

  const homeItems = [
    ["rent", "Alquiler", "Alquiler"],
    ["buildingFees", "Expensas", "Expensas"],
    ["utilities", "Servicios", "Servicios"],
  ]
    .map(([key, category, description]) => ({ amount: readAmount(formData, key), category, description }))
    .filter((item) => item.amount > 0);

  const fixedTransactions = homeItems.map((item) => makeTransaction({
    type: "expense",
    amount: item.amount,
    category: item.category,
    description: item.description,
    isFixed: true,
    isRecurring: true,
  }));

  const incomeTransaction = makeTransaction({
    type: "income",
    amount: income,
    category: "Sueldo",
    description: "Ingreso mensual",
    isFixed: true,
    isRecurring: true,
  });

  const homeTotal = homeItems.reduce((sum, item) => sum + item.amount, 0);
  const suggestedSavingsGoal = income * SAVINGS_RATIO;
  const variablePool = Math.max(income - suggestedSavingsGoal - homeTotal, 0);
  const configuredBudgets = [
    {
      id: "bud-comida-supermercado",
      category: "Comida / Supermercado",
      monthlyLimit: Math.round(variablePool * FOOD_BUDGET_RATIO),
      currency: "ARS",
    },
    {
      id: "bud-ocio",
      category: "Ocio",
      monthlyLimit: Math.round(variablePool * LEISURE_BUDGET_RATIO),
      currency: "ARS",
    },
  ].filter((budget) => budget.monthlyLimit > 0);
  state.transactions = [incomeTransaction, ...fixedTransactions, ...state.transactions];
  state.recurringExpenses = [...fixedTransactions.map(makeRecurringFromTransaction), ...state.recurringExpenses];
  state.budgets = configuredBudgets;
  state.settings = {
    ...state.settings,
    monthlyIncomeTarget: income,
    monthlySavingsGoal: suggestedSavingsGoal,
    monthConfiguredAt: new Date().toISOString(),
  };
  state.savings = {
    ...state.savings,
    monthlyGoal: suggestedSavingsGoal,
  };

  const homeRatio = (homeTotal / income) * 100;
  state.setupStatus = homeRatio > 30
    ? "[GUARDADO] Casa y servicios supera el 30% recomendado para este mes."
    : "[GUARDADO] Mes configurado.";
  state.setupOpen = false;
  state.activeView = "dashboard";
  persist();
  render();
}

function nextMonthDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setMonth(date.getMonth() + 1);
  return date.toISOString().slice(0, 10);
}

async function refreshRates() {
  state.ratesStatus = "loading";
  state.ratesMessage = "Cotizacion en carga";
  render();
  const result = await fetchExchangeRates();
  state.rates = result.rates;
  state.ratesStatus = result.status;
  state.ratesMessage = result.message;
  render();
}

function bindEvents(root) {
  root.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (actionTarget && handleAction(actionTarget)) return;

    const viewTarget = event.target.closest("[data-view]");
    if (viewTarget) {
      setView(viewTarget.dataset.view);
    }
  });

  root.addEventListener("change", (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (actionTarget) handleAction(actionTarget);
  });

  root.addEventListener("submit", (event) => {
    if (["transaction-form", "setup-form", "credit-card-settings-form"].includes(event.target.id)) handleSubmit(event);
  });

  root.addEventListener("click", (event) => {
    if (event.target.classList.contains("modal-backdrop")) {
      state.modalOpen = false;
      state.setupOpen = false;
      render();
    }
    if (event.target.classList.contains("mobile-menu-backdrop")) {
      state.mobileMenuOpen = false;
      render();
    }
  });
}

function render() {
  const metrics = calculateMetrics(state);
  const root = document.getElementById("app");
  root.innerHTML = appChrome(metrics);
  document.body.classList.toggle("modal-open", state.modalOpen || state.setupOpen || state.mobileMenuOpen);
}

async function init() {
  hydrate();
  const root = document.getElementById("app");
  bindEvents(root);
  render();
  await refreshRates();
}

init();
