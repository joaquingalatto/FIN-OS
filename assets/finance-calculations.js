import { HOME_SERVICE_CATEGORIES } from "./finance-data.js";
import { convertFromARS, formatMoney, formatPercent, investmentValueToARS, movementToARS, toARS } from "./finance-currency.js";

const NOW = new Date("2026-05-31T12:00:00-03:00");

export function currentMonthKey(date = NOW) {
  return date.toISOString().slice(0, 7);
}

export function previousMonthKey(date = NOW) {
  const previous = new Date(date);
  previous.setMonth(previous.getMonth() - 1);
  return previous.toISOString().slice(0, 7);
}

function isInMonth(item, key) {
  return item.date?.slice(0, 7) === key;
}

function sumARS(items) {
  return items.reduce((sum, item) => sum + movementToARS(item), 0);
}

function monthToIndex(monthKey) {
  const [year, month] = String(monthKey || currentMonthKey()).split("-").map(Number);
  return year * 12 + month - 1;
}

function installmentNumberForMonth(purchase, monthKey) {
  const start = monthToIndex(purchase.firstInstallmentMonth);
  const current = monthToIndex(monthKey);
  const installmentNumber = current - start + 1;
  const total = Number(purchase.totalInstallments || 0);
  return installmentNumber >= 1 && installmentNumber <= total ? installmentNumber : 0;
}

function enrichInstallmentPurchase(purchase, monthKey) {
  const totalInstallments = Number(purchase.totalInstallments || 1);
  const installmentAmount = Number(purchase.installmentAmount || 0);
  const currentInstallment = installmentNumberForMonth(purchase, monthKey);
  const monthsElapsedBeforeCurrent = Math.max(monthToIndex(monthKey) - monthToIndex(purchase.firstInstallmentMonth), 0);
  const installmentsPaid = Math.min(monthsElapsedBeforeCurrent, totalInstallments);
  const installmentsRemaining = Math.max(totalInstallments - installmentsPaid, 0);
  const amountARS = toARS(installmentAmount, purchase.currency, purchase.exchangeRate);
  return {
    ...purchase,
    currentInstallment,
    installmentCurrent: currentInstallment || Math.min(installmentsPaid + 1, totalInstallments),
    installmentTotal: totalInstallments,
    installmentsPaid,
    installmentsRemaining,
    amountARS,
    futureCommittedARS: amountARS * installmentsRemaining,
  };
}

function creditCardStatus(usagePercentage, settings = {}) {
  const dangerThreshold = settings.dangerThreshold || 90;
  if (usagePercentage > 100) return { id: "exceeded", label: "Limite personal superado", tone: "bad" };
  if (usagePercentage >= dangerThreshold) return { id: "very-near", label: "Muy cerca del limite", tone: "bad" };
  if (usagePercentage >= (settings.warningThreshold || 70)) return { id: "near", label: "Cerca del limite", tone: "warn" };
  return { id: "within", label: "Dentro del limite", tone: "good" };
}

function isCreditCardPayment(method) {
  return method === "Tarjeta de credito" || method === "Credito";
}

function calculateCreditCardSummary({ expenses, installmentPurchases = [], rates, settings, creditCardSettings = {}, monthKey }) {
  const rate = rates[settings.defaultExchangeRateType]?.sell || 1;
  const personalLimit = toARS(creditCardSettings.monthlyPersonalLimit || 500000, creditCardSettings.currency || "ARS", rate);
  const activeInstallments = installmentPurchases
    .filter((item) => item.status !== "cancelled")
    .map((item) => enrichInstallmentPurchase(item, monthKey))
    .filter((item) => item.installmentsRemaining > 0 || item.currentInstallment > 0)
    .sort((a, b) => String(a.firstInstallmentMonth).localeCompare(String(b.firstInstallmentMonth)));
  const committedInstallments = activeInstallments.filter((item) => item.currentInstallment > 0);
  const committedInstallmentsTotal = committedInstallments.reduce((sum, item) => sum + item.amountARS, 0);
  const newCreditCardPurchases = expenses.filter((item) => (item.isCreditCard || isCreditCardPayment(item.paymentMethod)) && !item.isInstallment);
  const newCreditCardPurchasesTotal = sumARS(newCreditCardPurchases);
  const estimatedStatementTotal = committedInstallmentsTotal + newCreditCardPurchasesTotal;
  const remainingAvailable = personalLimit - estimatedStatementTotal;
  const usagePercentage = personalLimit ? (estimatedStatementTotal / personalLimit) * 100 : 0;
  const status = creditCardStatus(usagePercentage, creditCardSettings);

  return {
    month: monthKey,
    personalLimit,
    committedInstallmentsTotal,
    newCreditCardPurchasesTotal,
    estimatedStatementTotal,
    remainingAvailable,
    usagePercentage,
    status: status.id,
    statusLabel: status.label,
    statusTone: status.tone,
    committedInstallments,
    activeInstallments,
    newCreditCardPurchases,
    hasCreditCardData: committedInstallments.length > 0 || newCreditCardPurchases.length > 0,
    isLimitConfigured: Boolean(creditCardSettings.month),
    futureCommittedTotal: activeInstallments.reduce((sum, item) => sum + item.futureCommittedARS, 0),
  };
}

export function getMonthlyTransactions(transactions, key = currentMonthKey()) {
  return transactions.filter((item) => isInMonth(item, key));
}

export function calculateMetrics({ transactions, budgets, recurringExpenses, savings, investments, rates, settings, creditCardSettings, installmentPurchases }) {
  const monthKey = currentMonthKey();
  const previousKey = previousMonthKey();
  const monthTransactions = getMonthlyTransactions(transactions, monthKey);
  const previousTransactions = getMonthlyTransactions(transactions, previousKey);

  const expenses = monthTransactions.filter((item) => item.type === "expense");
  const incomes = monthTransactions.filter((item) => item.type === "income");
  const savingMoves = monthTransactions.filter((item) => item.type === "saving");
  const investmentMoves = monthTransactions.filter((item) => item.type === "investment");
  const previousExpenses = previousTransactions.filter((item) => item.type === "expense");

  const expenseARS = sumARS(expenses);
  const incomeARS = sumARS(incomes);
  const savingARS = sumARS(savingMoves);
  const investedThisMonthARS = sumARS(investmentMoves);
  const previousExpenseARS = sumARS(previousExpenses);
  const fixedExpenseARS = sumARS(expenses.filter((item) => item.isFixed));
  const variableExpenseARS = expenseARS - fixedExpenseARS;
  const totalInvestedARS = investments.reduce((sum, item) => sum + investmentValueToARS(item, rates, settings.defaultExchangeRateType), 0);
  const savingsARS = Number(savings.ars || 0) + toARS(savings.usd || 0, "USD", rates[settings.defaultExchangeRateType]?.sell || 1);
  const balanceARS = incomeARS - expenseARS - savingARS - investedThisMonthARS;

  const daysInMonth = new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0).getDate();
  const dayOfMonth = NOW.getDate();
  const remainingDays = Math.max(daysInMonth - dayOfMonth, 1);
  const dailyAverageARS = expenseARS / dayOfMonth;
  const projectedExpenseARS = dailyAverageARS * daysInMonth;
  const hasCurrentData = monthTransactions.length > 0;
  const availableUntilMonthEndARS = hasCurrentData ? incomeARS - projectedExpenseARS - settings.monthlySavingsGoal - investedThisMonthARS : 0;
  const availablePerDayARS = hasCurrentData ? availableUntilMonthEndARS / remainingDays : 0;
  const expenseVariation = previousExpenseARS ? ((expenseARS - previousExpenseARS) / previousExpenseARS) * 100 : 0;

  const byCategory = expenses.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + movementToARS(item);
    return acc;
  }, {});
  const categoryRows = Object.entries(byCategory)
    .map(([category, amountARS]) => ({ category, amountARS, percentage: expenseARS ? (amountARS / expenseARS) * 100 : 0 }))
    .sort((a, b) => b.amountARS - a.amountARS);

  const previousByCategory = previousExpenses.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + movementToARS(item);
    return acc;
  }, {});

  const categoryGrowth = categoryRows
    .map((row) => {
      const previous = previousByCategory[row.category] || 0;
      return { ...row, growth: previous ? ((row.amountARS - previous) / previous) * 100 : 0 };
    })
    .sort((a, b) => b.growth - a.growth);

  const budgetsWithProgress = budgets.map((budget) => {
    const limitARS = toARS(budget.monthlyLimit, budget.currency, rates[settings.defaultExchangeRateType]?.sell || 1);
    const spentARS = byCategory[budget.category] || 0;
    const percentageUsed = limitARS ? (spentARS / limitARS) * 100 : 0;
    const projectedARS = (spentARS / dayOfMonth) * daysInMonth;
    const status = percentageUsed >= 100 ? "exceeded" : percentageUsed >= 80 ? "near" : "ok";
    return {
      ...budget,
      spent: spentARS,
      remaining: limitARS - spentARS,
      percentageUsed,
      projectedARS,
      status,
    };
  });

  const activeRecurring = recurringExpenses.filter((item) => item.status === "active");
  const fixedMonthlyARS = activeRecurring.reduce((sum, item) => sum + toARS(item.amount, item.currency, item.exchangeRate), 0);
  const creditCardSummary = calculateCreditCardSummary({
    expenses,
    installmentPurchases,
    rates,
    settings,
    creditCardSettings,
    monthKey,
  });
  const activeInstallments = creditCardSummary.activeInstallments;
  const homeServicesARS = expenses
    .filter((item) => HOME_SERVICE_CATEGORIES.includes(item.category))
    .reduce((sum, item) => sum + movementToARS(item), 0);
  const recurringHomeServicesARS = activeRecurring
    .filter((item) => HOME_SERVICE_CATEGORIES.includes(item.category))
    .reduce((sum, item) => sum + toARS(item.amount, item.currency, item.exchangeRate), 0);

  return {
    monthKey,
    monthTransactions,
    hasCurrentData,
    isMonthConfigured: Boolean(settings.monthConfiguredAt || settings.monthlyIncomeTarget || incomeARS || budgets.length),
    expenses,
    incomes,
    savingMoves,
    investmentMoves,
    recentTransactions: [...monthTransactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6),
    expenseARS,
    incomeARS,
    savingARS,
    investedThisMonthARS,
    fixedExpenseARS,
    variableExpenseARS,
    fixedMonthlyARS,
    homeServicesARS,
    recurringHomeServicesARS,
    totalInvestedARS,
    savingsARS,
    balanceARS,
    dailyAverageARS,
    projectedExpenseARS,
    availableUntilMonthEndARS,
    availablePerDayARS,
    expenseVariation,
    categoryRows,
    categoryGrowth,
    budgetsWithProgress,
    creditCardSummary,
    activeInstallments,
    recurringActive: activeRecurring,
    recurringPaused: recurringExpenses.filter((item) => item.status === "paused"),
    ratios: {
      expenses: incomeARS ? (expenseARS / incomeARS) * 100 : 0,
      savings: incomeARS ? (savingARS / incomeARS) * 100 : 0,
      investments: incomeARS ? (investedThisMonthARS / incomeARS) * 100 : 0,
      fixed: incomeARS ? (fixedExpenseARS / incomeARS) * 100 : 0,
      homeServices: incomeARS ? ((homeServicesARS || recurringHomeServicesARS) / incomeARS) * 100 : 0,
    },
  };
}

export function generateCreditCardInsights(metrics, settings, rates) {
  const summary = metrics.creditCardSummary;
  if (!summary?.hasCreditCardData) {
    return [
      summary?.isLimitConfigured ? "Cuando cargues consumos con tarjeta, vas a ver tu resumen aca." : "Todavia no configuraste tu limite personal de tarjeta.",
      "Cuando cargues cuotas, vamos a mostrar tus compromisos mensuales.",
    ];
  }

  const currency = settings.displayCurrency;
  const rateType = settings.defaultExchangeRateType;
  const estimated = formatMoney(convertFromARS(summary.estimatedStatementTotal, currency, rates, rateType), currency);
  const remaining = formatMoney(convertFromARS(summary.remainingAvailable, currency, rates, rateType), currency);
  const committed = formatMoney(convertFromARS(summary.committedInstallmentsTotal, currency, rates, rateType), currency);
  const cardFood = summary.newCreditCardPurchases
    .filter((item) => item.category === "Comida / Supermercado" || item.subcategory === "Supermercado grande")
    .reduce((sum, item) => sum + movementToARS(item), 0);
  const cardFoodIsMain = cardFood > 0 && cardFood >= summary.newCreditCardPurchasesTotal * 0.5;

  return [
    `Tu resumen estimado de tarjeta es de ${estimated}.`,
    `Te quedan ${remaining} disponibles para mantenerte dentro de tu limite personal.`,
    summary.committedInstallmentsTotal > 0
      ? `Las cuotas comprometidas representan ${committed} de tu resumen.`
      : "Todavia no cargaste cuotas comprometidas para este mes.",
    cardFoodIsMain
      ? "Supermercado representa la mayor parte de tus consumos con tarjeta este mes."
      : "Cuando supermercado concentre tus consumos con tarjeta, lo vas a ver destacado aca.",
    summary.status === "within"
      ? "Tu resumen de tarjeta sigue dentro del limite personal configurado."
      : "Tu resumen de tarjeta esta cerca del limite personal configurado.",
    summary.committedInstallmentsTotal > 0
      ? "Las cuotas ya comprometidas reducen tu disponible del mes."
      : "Las compras en cuotas se van a separar de los consumos nuevos.",
  ];
}

export function generateInsights(metrics, settings, rates) {
  if (!metrics.hasCurrentData) {
    return [
      "Sin datos suficientes. Configura tu mes para empezar a ordenar tus finanzas.",
      "Cuando cargues movimientos, vas a ver tus metricas aca.",
      "Defini tu ingreso mensual para calcular tu objetivo de ahorro.",
      "Tu objetivo sugerido de ahorro se calculara automaticamente como el 40% de tus ingresos.",
    ];
  }

  if (!metrics.expenses.length) {
    return [
      "Todavia no cargaste gastos este mes.",
      "Agrega tu primer gasto para entender en que se va la plata.",
      "Cuando cargues gastos de ocio, vamos a mostrar tu evolucion mensual.",
    ];
  }

  const topCategory = metrics.categoryRows[0];
  const fastestGrowth = metrics.categoryGrowth.find((row) => row.growth > 0);
  const currency = settings.displayCurrency;
  const rateType = settings.defaultExchangeRateType;
  const projected = convertFromARS(metrics.projectedExpenseARS, currency, rates, rateType);
  const availablePerDay = convertFromARS(metrics.availablePerDayARS, currency, rates, rateType);
  const ocio = metrics.categoryRows.find((row) => row.category === "Ocio");
  const ocioSaving = ocio ? ocio.amountARS * 0.15 : metrics.variableExpenseARS * 0.1;

  return [
    metrics.expenseVariation && metrics.expenseVariation > 5
      ? `Estas gastando ${formatPercent(metrics.expenseVariation)} mas que el mes pasado.`
      : "Todavia no hay historial suficiente para comparar contra el mes anterior.",
    topCategory
      ? `${topCategory.category} representa ${topCategory.percentage.toFixed(0)}% de tus gastos del mes.`
      : "Todavia no hay gastos suficientes para detectar categorias fuertes.",
    `Si mantenes este ritmo, terminarias el mes gastando ${formatMoney(projected, currency)}.`,
    `Podrias ahorrar ${formatMoney(convertFromARS(ocioSaving, currency, rates, rateType), currency)} reduciendo 15% tus gastos de ocio.`,
    metrics.incomeARS ? `Tus gastos fijos representan ${metrics.ratios.fixed.toFixed(0)}% de tus ingresos.` : "Carga tus ingresos para calcular que porcentaje ocupan tus gastos fijos.",
    `Te quedan ${formatMoney(availablePerDay, currency)} por dia para mantener tu objetivo de ahorro.`,
    fastestGrowth ? `La categoria que mas crecio fue ${fastestGrowth.category}.` : "No hay una categoria con crecimiento relevante este mes.",
  ];
}

export function generateMonthlyClosing(metrics, settings, rates) {
  const currency = settings.displayCurrency;
  const rateType = settings.defaultExchangeRateType;
  const topExpenses = metrics.expenses
    .map((item) => ({ ...item, amountARS: movementToARS(item) }))
    .sort((a, b) => b.amountARS - a.amountARS)
    .slice(0, 3);
  const biggestDeviation = metrics.budgetsWithProgress.sort((a, b) => b.percentageUsed - a.percentageUsed)[0];
  const variableOpportunity = metrics.variableExpenseARS * 0.1;

  if (!metrics.hasCurrentData) {
    return {
      summary: "Todavia no hay movimientos para cerrar este mes. Cuando cargues ingresos y gastos, el cierre va a mostrar desvio, ahorro y oportunidades.",
      biggestDeviation,
      topExpenses,
      recommendation: "Configura tu mes y carga tus primeros movimientos para recibir una recomendacion accionable.",
      increasedCategory: "Sin datos",
      decreasedCategory: "Sin datos",
      savingsGoalProgress: 0,
    };
  }

  return {
    summary: metrics.incomeARS ? `Este mes cerraste con un ahorro del ${metrics.ratios.savings.toFixed(0)}% de tus ingresos. Tus gastos fijos se mantuvieron controlados y la mejor oportunidad esta en ajustar gastos variables.` : "Este mes tiene movimientos, pero falta cargar ingresos para medir ahorro real y porcentajes.",
    biggestDeviation,
    topExpenses,
    recommendation: `Reduciendo 10% tus gastos variables podrias ahorrar ${formatMoney(convertFromARS(variableOpportunity, currency, rates, rateType), currency)} mas el mes proximo.`,
    increasedCategory: metrics.categoryGrowth[0]?.category || "Sin datos",
    decreasedCategory: metrics.categoryGrowth.filter((item) => item.growth < 0).sort((a, b) => a.growth - b.growth)[0]?.category || "Sin datos",
    savingsGoalProgress: settings.monthlySavingsGoal ? (metrics.savingARS / settings.monthlySavingsGoal) * 100 : 0,
  };
}
