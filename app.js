/**
 * Budget Web App - Main Application Logic
 */

// Data structure
let budgetData = {
  income: {
    spouse1: { name: 'Person 1', paychecks: [] },
    spouse2: { name: 'Person 2', paychecks: [] },
  },
  requiredBills: [],
  otherExpenses: [],
  savings: [],
  debts: [],
  monthlyHistory: [],
};

// Chart instances
let charts = {
  incomeExpenses: null,
  expenseBreakdown: null,
  debtTimeline: null,
  debtPayoffComparison: null,
  predictedActual: null,
};

let debtTimelineMode = 'combined';
let showSecondPersonOverride = false;

// Application state wrapping budgetData with monthly archiving
let appState = {
  activeMonth: null,
  currentViewMonth: null,
  navigatorYear: null,
  monthlyArchives: [],
  budgetData: null,
};

// ============ Utility Functions ============

function deepCloneBudget(data) {
  return JSON.parse(JSON.stringify(data));
}

function extractBudgetFields(data) {
  return {
    income: deepCloneBudget(data.income),
    requiredBills: deepCloneBudget(data.requiredBills),
    otherExpenses: deepCloneBudget(data.otherExpenses),
    savings: deepCloneBudget(data.savings),
    debts: deepCloneBudget(data.debts || []),
    monthlyHistory: deepCloneBudget(data.monthlyHistory || []),
  };
}

function buildBudgetDataFromFields(fields) {
  const legacyDebt = fields.debt;
  const debts = Array.isArray(fields.debts)
    ? fields.debts
    : legacyDebt
      ? [
          {
            id: generateUUID(),
            name: legacyDebt.name || 'Debt',
            principal: legacyDebt.principal || 0,
            interestRate: legacyDebt.interestRate || 0,
            minimumPayment: legacyDebt.minimumPayment || 0,
            extraPayment: legacyDebt.extraPayment || 0,
          },
        ]
      : [];
  return {
    income: deepCloneBudget(fields.income),
    requiredBills: deepCloneBudget(fields.requiredBills),
    otherExpenses: deepCloneBudget(fields.otherExpenses),
    savings: deepCloneBudget(fields.savings),
    debts: deepCloneBudget(debts),
    monthlyHistory: deepCloneBudget(fields.monthlyHistory || []),
  };
}

function calculateNextMonth(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  const date = new Date(year, month, 1); // month is already 0-indexed next month
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function calculatePreviousMonth(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  const date = new Date(year, month - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function getMonthsForYear(year) {
  const months = [];
  for (let month = 1; month <= 12; month += 1) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
  }
  return months;
}

function getAllMonths() {
  const displayMonth = appState.currentViewMonth || appState.activeMonth;
  const displayYear = Number((displayMonth || getCurrentMonth()).split('-')[0]);
  const selectedYear = appState.navigatorYear || displayYear;

  const monthSet = new Set(
    (appState.monthlyArchives || []).map((a) => a.month),
  );

  if (appState.activeMonth) {
    monthSet.add(appState.activeMonth);
  }

  collectHistoryMonthsFromState().forEach((month) => monthSet.add(month));
  getMonthsForYear(selectedYear).forEach((month) => monthSet.add(month));

  const months = [...monthSet].filter(
    (month) =>
      typeof month === 'string' &&
      month.length > 0 &&
      Number(month.split('-')[0]) === selectedYear,
  );
  months.sort();
  return months;
}

function getAvailableYears() {
  const years = new Set();
  const collectYear = (month) => {
    if (!month || typeof month !== 'string') return;
    const [year] = normalizeMonthKey(month).split('-').map(Number);
    if (year) years.add(year);
  };

  collectYear(appState.activeMonth);
  collectYear(appState.currentViewMonth);
  (appState.monthlyArchives || []).forEach((archive) =>
    collectYear(archive.month),
  );
  collectHistoryMonthsFromState().forEach((month) => collectYear(month));

  const currentYear = Number(getCurrentMonth().split('-')[0]);
  years.add(currentYear - 1);
  years.add(currentYear);
  years.add(currentYear + 1);

  return [...years].sort((a, b) => a - b);
}

function isLegacyFormat(parsed) {
  return parsed.income !== undefined && parsed.activeMonth === undefined;
}

function normalizeMonthKey(monthStr) {
  if (typeof monthStr !== 'string') return monthStr;
  const trimmed = monthStr.trim();

  const yearMonth = trimmed.match(/^(\d{4})-(\d{1,2})$/);
  if (yearMonth) {
    const year = yearMonth[1];
    const month = String(Number(yearMonth[2])).padStart(2, '0');
    return `${year}-${month}`;
  }

  const isoLike = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoLike) {
    const year = isoLike[1];
    const month = String(Number(isoLike[2])).padStart(2, '0');
    return `${year}-${month}`;
  }

  const slashFormat = trimmed.match(/^(\d{1,2})\/(\d{4})$/);
  if (slashFormat) {
    const month = String(Number(slashFormat[1])).padStart(2, '0');
    const year = slashFormat[2];
    return `${year}-${month}`;
  }

  const parsedDate = new Date(trimmed);
  if (!Number.isNaN(parsedDate.getTime())) {
    return `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, '0')}`;
  }

  return monthStr;
}

function normalizeMonthlyHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((entry) => ({
      ...entry,
      month: normalizeMonthKey(entry.month),
    }))
    .filter(
      (entry) => typeof entry.month === 'string' && entry.month.length > 0,
    );
}

function collectHistoryMonthsFromState() {
  const months = new Set();

  const addHistoryMonths = (history) => {
    normalizeMonthlyHistory(history).forEach((entry) => {
      if (entry.month) months.add(entry.month);
    });
  };

  addHistoryMonths(appState.budgetData?.monthlyHistory);
  addHistoryMonths(budgetData?.monthlyHistory);
  addHistoryMonths(appState.monthlyHistory);

  if (Array.isArray(appState.monthlyArchives)) {
    appState.monthlyArchives.forEach((archive) => {
      addHistoryMonths(archive.monthlyHistory);
    });
  }

  return months;
}

function getMergedMonthlyHistory() {
  const merged = [];
  const seenKeys = new Set();

  const addHistory = (history) => {
    normalizeMonthlyHistory(history).forEach((entry) => {
      const key = JSON.stringify(entry);
      if (!seenKeys.has(key)) {
        merged.push(entry);
        seenKeys.add(key);
      }
    });
  };

  addHistory(appState.budgetData?.monthlyHistory);
  addHistory(budgetData?.monthlyHistory);
  addHistory(appState.monthlyHistory);

  if (Array.isArray(appState.monthlyArchives)) {
    appState.monthlyArchives.forEach((archive) => {
      addHistory(archive.monthlyHistory);
    });
  }

  return merged;
}

function ensureArchiveForMonth(month) {
  if (!month || month === appState.activeMonth) return;

  const existingArchive = appState.monthlyArchives.find(
    (a) => a.month === month,
  );
  if (existingArchive) return;

  const allHistory = getMergedMonthlyHistory();
  const monthHistory = allHistory.filter((entry) => entry.month === month);
  const fallbackTemplate = deepCloneBudget(appState.budgetData);
  ['spouse1', 'spouse2'].forEach((key) => {
    fallbackTemplate.income[key].paychecks.forEach((paycheck) => {
      paycheck.amount = 0;
    });
  });
  fallbackTemplate.monthlyHistory = [];

  appState.monthlyArchives.push({
    month,
    income: deepCloneBudget(fallbackTemplate.income),
    requiredBills: deepCloneBudget(fallbackTemplate.requiredBills),
    otherExpenses: deepCloneBudget(fallbackTemplate.otherExpenses),
    savings: deepCloneBudget(fallbackTemplate.savings),
    debts: deepCloneBudget(fallbackTemplate.debts),
    monthlyHistory:
      monthHistory.length > 0
        ? deepCloneBudget(monthHistory)
        : deepCloneBudget(fallbackTemplate.monthlyHistory),
  });
  appState.monthlyArchives.sort((a, b) => a.month.localeCompare(b.month));
}

function ensureBudgetShape(container) {
  if (!container || typeof container !== 'object') {
    return deepCloneBudget(budgetData);
  }
  return {
    income: deepCloneBudget(
      container.income || {
        spouse1: { name: 'Person 1', paychecks: [] },
        spouse2: { name: 'Person 2', paychecks: [] },
      },
    ),
    requiredBills: deepCloneBudget(container.requiredBills || []),
    otherExpenses: deepCloneBudget(container.otherExpenses || []),
    savings: deepCloneBudget(container.savings || []),
    debts: deepCloneBudget(container.debts || []),
    monthlyHistory: normalizeMonthlyHistory(container.monthlyHistory || []),
  };
}

function hasMeaningfulBudgetData(container) {
  if (!container) return false;

  const spouse1Paychecks = container.income?.spouse1?.paychecks || [];
  const spouse2Paychecks = container.income?.spouse2?.paychecks || [];

  const hasPaychecks = [...spouse1Paychecks, ...spouse2Paychecks].some(
    (paycheck) => (parseFloat(paycheck.amount) || 0) !== 0,
  );

  return (
    hasPaychecks ||
    (container.requiredBills || []).length > 0 ||
    (container.otherExpenses || []).length > 0 ||
    (container.savings || []).length > 0 ||
    (container.debts || []).length > 0
  );
}

function normalizeAppState() {
  const currentMonth = getCurrentMonth();

  appState.activeMonth = normalizeMonthKey(
    appState.activeMonth || currentMonth,
  );
  appState.currentViewMonth = appState.currentViewMonth
    ? normalizeMonthKey(appState.currentViewMonth)
    : null;
  appState.navigatorYear = Number(appState.navigatorYear) || null;
  appState.budgetData = ensureBudgetShape(appState.budgetData);

  if (!Array.isArray(appState.monthlyArchives)) {
    appState.monthlyArchives = [];
  }

  appState.monthlyArchives = appState.monthlyArchives
    .map((archive) => {
      const normalizedArchive = ensureBudgetShape(archive);
      return {
        month: normalizeMonthKey(archive.month),
        ...normalizedArchive,
      };
    })
    .filter(
      (archive) =>
        typeof archive.month === 'string' && archive.month.length > 0,
    );

  const knownArchiveMonths = new Set(
    appState.monthlyArchives.map((a) => a.month),
  );
  const historyMonths = collectHistoryMonthsFromState();

  historyMonths.forEach((month) => {
    if (month !== appState.activeMonth && !knownArchiveMonths.has(month)) {
      appState.monthlyArchives.push({
        month,
        income: deepCloneBudget(appState.budgetData.income),
        requiredBills: deepCloneBudget(appState.budgetData.requiredBills),
        otherExpenses: deepCloneBudget(appState.budgetData.otherExpenses),
        savings: deepCloneBudget(appState.budgetData.savings),
        debts: deepCloneBudget(appState.budgetData.debts),
        monthlyHistory: appState.budgetData.monthlyHistory.filter(
          (h) => h.month === month,
        ),
      });
      knownArchiveMonths.add(month);
    }
  });

  appState.monthlyArchives.sort((a, b) => a.month.localeCompare(b.month));

  const hasCurrentOrFutureMonth = [
    appState.activeMonth,
    ...appState.monthlyArchives.map((a) => a.month),
  ].some((month) => month >= currentMonth);

  if (appState.activeMonth < currentMonth && !hasCurrentOrFutureMonth) {
    while (appState.activeMonth < currentMonth) {
      const existingArchiveIndex = appState.monthlyArchives.findIndex(
        (archive) => archive.month === appState.activeMonth,
      );

      if (existingArchiveIndex === -1) {
        appState.monthlyArchives.push({
          month: appState.activeMonth,
          ...deepCloneBudget(appState.budgetData),
        });
      } else {
        appState.monthlyArchives[existingArchiveIndex] = {
          month: appState.activeMonth,
          ...deepCloneBudget(appState.budgetData),
        };
      }

      const nextMonth = calculateNextMonth(appState.activeMonth);
      const newBudget = deepCloneBudget(appState.budgetData);
      ['spouse1', 'spouse2'].forEach((key) => {
        newBudget.income[key].paychecks.forEach((paycheck) => {
          paycheck.amount = 0;
        });
      });
      newBudget.monthlyHistory = [];

      appState.activeMonth = nextMonth;
      appState.budgetData = newBudget;
    }

    appState.monthlyArchives.sort((a, b) => a.month.localeCompare(b.month));
  }

  if (
    appState.monthlyArchives.length === 0 &&
    appState.activeMonth === currentMonth &&
    hasMeaningfulBudgetData(appState.budgetData)
  ) {
    const previousMonth = calculatePreviousMonth(appState.activeMonth);
    if (previousMonth && previousMonth !== appState.activeMonth) {
      appState.monthlyArchives.push({
        month: previousMonth,
        ...deepCloneBudget(appState.budgetData),
      });
      appState.monthlyArchives.sort((a, b) => a.month.localeCompare(b.month));
      knownArchiveMonths.add(previousMonth);
    }
  }

  if (
    appState.currentViewMonth &&
    appState.currentViewMonth !== appState.activeMonth &&
    !knownArchiveMonths.has(appState.currentViewMonth)
  ) {
    appState.currentViewMonth = null;
  }

  const displayMonth =
    appState.currentViewMonth || appState.activeMonth || currentMonth;
  const [displayYear] = displayMonth.split('-').map(Number);
  appState.navigatorYear = appState.navigatorYear || displayYear;
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  initializeEventListeners();
  renderAll();
  updateAllCharts();
});

// ============ Data Persistence ============

function saveData() {
  syncBudgetDataToState();
  localStorage.setItem('budget-webapp-data', JSON.stringify(appState));
}

function loadData() {
  const saved = localStorage.getItem('budget-webapp-data');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (isLegacyFormat(parsed)) {
        migrateFromLegacyFormat(parsed);
      } else {
        appState = parsed;
        normalizeAppState();
        loadMonthIntoBudgetData(appState.activeMonth);
      }
      migrateIncomeData();
      migrateDebtData();
    } catch (e) {
      console.error('Error loading data:', e);
    }
  } else {
    initializeNewAppState();
  }
}

// Migrate old single-amount income format to paychecks array
function migrateIncomeData() {
  let changed = false;
  ['spouse1', 'spouse2'].forEach((key) => {
    const spouse = budgetData.income[key];
    if (spouse && !spouse.paychecks) {
      const amount = spouse.amount || 0;
      spouse.paychecks =
        amount > 0 ? [{ id: generateUUID(), amount: amount }] : [];
      delete spouse.amount;
      changed = true;
    }
  });
  // Also migrate income in all archived months
  appState.monthlyArchives.forEach((archive) => {
    ['spouse1', 'spouse2'].forEach((key) => {
      const spouse = archive.income[key];
      if (spouse && !spouse.paychecks) {
        const amount = spouse.amount || 0;
        spouse.paychecks =
          amount > 0 ? [{ id: generateUUID(), amount: amount }] : [];
        delete spouse.amount;
        changed = true;
      }
    });
  });
  if (changed) saveData();
}

function migrateDebtData() {
  let changed = false;

  const migrateContainer = (container) => {
    if (!container) return;
    if (Array.isArray(container.debts)) return;

    const legacyDebt = container.debt;
    const debts = [];
    if (legacyDebt) {
      debts.push({
        id: generateUUID(),
        name: legacyDebt.name || 'Debt',
        principal: legacyDebt.principal || 0,
        interestRate: legacyDebt.interestRate || 0,
        minimumPayment: legacyDebt.minimumPayment || 0,
        extraPayment: legacyDebt.extraPayment || 0,
      });
    }

    container.debts = debts;
    if (container.debt !== undefined) {
      delete container.debt;
    }
    changed = true;
  };

  migrateContainer(budgetData);
  migrateContainer(appState.budgetData);
  appState.monthlyArchives.forEach((archive) => migrateContainer(archive));

  if (changed) saveData();
}

function migrateFromLegacyFormat(legacyData) {
  const currentMonth = getCurrentMonth();

  const historyForCurrentMonth = (legacyData.monthlyHistory || []).filter(
    (h) => h.month === currentMonth,
  );
  const historyForOtherMonths = (legacyData.monthlyHistory || []).filter(
    (h) => h.month !== currentMonth,
  );

  budgetData = {
    income: legacyData.income || {
      spouse1: { name: 'Person 1', paychecks: [] },
      spouse2: { name: 'Person 2', paychecks: [] },
    },
    requiredBills: legacyData.requiredBills || [],
    otherExpenses: legacyData.otherExpenses || [],
    savings: legacyData.savings || [],
    debts: legacyData.debt
      ? [
          {
            id: generateUUID(),
            name: legacyData.debt.name || 'Debt',
            principal: legacyData.debt.principal || 0,
            interestRate: legacyData.debt.interestRate || 0,
            minimumPayment: legacyData.debt.minimumPayment || 0,
            extraPayment: legacyData.debt.extraPayment || 0,
          },
        ]
      : [],
    monthlyHistory: historyForCurrentMonth,
  };

  appState = {
    activeMonth: currentMonth,
    currentViewMonth: null,
    navigatorYear: Number(currentMonth.split('-')[0]),
    monthlyArchives: [],
    budgetData: deepCloneBudget(budgetData),
  };

  // Preserve monthlyHistory entries from prior months as archive stubs
  const priorMonths = [
    ...new Set(historyForOtherMonths.map((h) => h.month)),
  ].sort();
  priorMonths.forEach((month) => {
    appState.monthlyArchives.push({
      month: month,
      income: deepCloneBudget(budgetData.income),
      requiredBills: deepCloneBudget(budgetData.requiredBills),
      otherExpenses: deepCloneBudget(budgetData.otherExpenses),
      savings: deepCloneBudget(budgetData.savings),
      debts: deepCloneBudget(budgetData.debts),
      monthlyHistory: historyForOtherMonths.filter((h) => h.month === month),
    });
  });

  saveData();
}

function initializeNewAppState() {
  const currentMonth = getCurrentMonth();
  appState = {
    activeMonth: currentMonth,
    currentViewMonth: null,
    navigatorYear: Number(currentMonth.split('-')[0]),
    monthlyArchives: [],
    budgetData: deepCloneBudget(budgetData),
  };
}

// ============ Month Navigation ============

function syncBudgetDataToState() {
  if (
    appState.currentViewMonth === null ||
    appState.currentViewMonth === appState.activeMonth
  ) {
    appState.budgetData = deepCloneBudget(budgetData);
  } else {
    const archiveIndex = appState.monthlyArchives.findIndex(
      (a) => a.month === appState.currentViewMonth,
    );
    if (archiveIndex >= 0) {
      appState.monthlyArchives[archiveIndex] = {
        month: appState.currentViewMonth,
        ...extractBudgetFields(budgetData),
      };
    }
  }
}

function loadMonthIntoBudgetData(month) {
  if (month === appState.activeMonth) {
    budgetData = buildBudgetDataFromFields(appState.budgetData);
    appState.currentViewMonth = null;
  } else {
    ensureArchiveForMonth(month);
    const archive = appState.monthlyArchives.find((a) => a.month === month);
    if (archive) {
      budgetData = buildBudgetDataFromFields(archive);
      appState.currentViewMonth = month;
    }
  }
}

function switchToMonth(month) {
  appState.navigatorYear = Number(month.split('-')[0]);
  syncBudgetDataToState();
  loadMonthIntoBudgetData(month);
  saveData();
  renderAll();
  updateAllCharts();
}

function switchNavigatorYear(year) {
  const selectedYear = Number(year);
  if (!selectedYear) return;

  appState.navigatorYear = selectedYear;
  const displayMonth =
    appState.currentViewMonth || appState.activeMonth || getCurrentMonth();
  const [, monthPart] = displayMonth.split('-');
  const targetMonth = `${selectedYear}-${monthPart}`;
  switchToMonth(targetMonth);
}

function startNewMonth() {
  const nextMonth = calculateNextMonth(appState.activeMonth);
  const activeLabel = formatMonthLabel(appState.activeMonth);
  const nextLabel = formatMonthLabel(nextMonth);

  if (
    !confirm(
      `Archive ${activeLabel} and start ${nextLabel}?\n\nThe current month's budget will be saved and a new month will be created with the same structure but paycheck amounts reset to $0.`,
    )
  ) {
    return;
  }

  syncBudgetDataToState();

  // Archive the current active month
  appState.monthlyArchives.push({
    month: appState.activeMonth,
    ...deepCloneBudget(appState.budgetData),
  });
  appState.monthlyArchives.sort((a, b) => a.month.localeCompare(b.month));

  // Build new month: copy structure, reset paycheck amounts, clear monthlyHistory
  const newBudget = deepCloneBudget(appState.budgetData);
  ['spouse1', 'spouse2'].forEach((key) => {
    newBudget.income[key].paychecks.forEach((p) => {
      p.amount = 0;
    });
  });
  newBudget.monthlyHistory = [];

  appState.activeMonth = nextMonth;
  appState.budgetData = newBudget;
  appState.currentViewMonth = null;

  budgetData = buildBudgetDataFromFields(newBudget);
  saveData();
  renderAll();
  updateAllCharts();
}

function exportData() {
  syncBudgetDataToState();
  const dataStr = JSON.stringify(appState, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `budget-data-${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (isLegacyFormat(parsed)) {
        migrateFromLegacyFormat(parsed);
      } else {
        appState = parsed;
        normalizeAppState();
        loadMonthIntoBudgetData(appState.activeMonth);
      }
      migrateIncomeData();
      migrateDebtData();
      saveData();
      renderAll();
      updateAllCharts();
      alert('Data imported successfully!');
    } catch (err) {
      alert('Error importing data. Please check the file format.');
    }
  };
  reader.readAsText(file);
}

function clearAllData() {
  if (
    confirm(
      'Are you sure you want to clear ALL data for ALL months? This cannot be undone.',
    )
  ) {
    budgetData = {
      income: {
        spouse1: { name: 'Person 1', paychecks: [] },
        spouse2: { name: 'Person 2', paychecks: [] },
      },
      requiredBills: [],
      otherExpenses: [],
      savings: [],
      debts: [],
      monthlyHistory: [],
    };
    showSecondPersonOverride = false;
    initializeNewAppState();
    saveData();
    renderAll();
    updateAllCharts();
  }
}

// ============ UUID Generator ============

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============ CRUD Operations ============

// Income
function updateSpouseName(spouseKey) {
  const inputId = spouseKey === 'spouse1' ? 'spouse1Name' : 'spouse2Name';
  budgetData.income[spouseKey].name =
    document.getElementById(inputId).value ||
    (spouseKey === 'spouse1' ? 'Person 1' : 'Person 2');
  if (spouseKey === 'spouse2') {
    showSecondPersonOverride = true;
  }
  saveData();
  renderIncomeTotal();
}

function shouldShowSecondPerson() {
  const person = budgetData.income.spouse2;
  if (!person) return false;
  const name = (person.name || '').trim();
  const hasCustomName = name && name.toLowerCase() !== 'person 2';
  const hasPaychecks =
    Array.isArray(person.paychecks) && person.paychecks.length > 0;
  const hasPaycheckAmount = hasPaychecks
    ? person.paychecks.some((paycheck) => (paycheck.amount || 0) > 0)
    : false;
  return (
    showSecondPersonOverride ||
    hasCustomName ||
    hasPaychecks ||
    hasPaycheckAmount
  );
}

function setSecondPersonVisibility(show) {
  const container = document.getElementById('person2Container');
  const addButton = document.getElementById('addPersonBtn');
  const columns = document.getElementById('incomeColumns');
  if (!container || !addButton || !columns) return;

  container.classList.toggle('is-hidden', !show);
  addButton.classList.toggle('is-hidden', show);
  columns.classList.toggle('single-person', !show);
}

function addSecondPerson() {
  showSecondPersonOverride = true;
  if (!budgetData.income.spouse2.name) {
    budgetData.income.spouse2.name = 'Person 2';
  }
  setSecondPersonVisibility(true);
  renderIncome();
}

function addPaycheck(spouseKey) {
  budgetData.income[spouseKey].paychecks.push({
    id: generateUUID(),
    amount: 0,
  });
  renderPaychecks(spouseKey);
  saveData();
}

function updatePaycheck(spouseKey, id, value) {
  const paycheck = budgetData.income[spouseKey].paychecks.find(
    (p) => p.id === id,
  );
  if (paycheck) {
    paycheck.amount = parseFloat(value) || 0;
    saveData();
    renderIncomeTotal();
    updateSummary();
    updateAllCharts();
  }
}

function deletePaycheck(spouseKey, id) {
  budgetData.income[spouseKey].paychecks = budgetData.income[
    spouseKey
  ].paychecks.filter((p) => p.id !== id);
  renderPaychecks(spouseKey);
  saveData();
  renderIncomeTotal();
  updateSummary();
  updateAllCharts();
}

// Required Bills
function addRequiredBill() {
  const bill = {
    id: generateUUID(),
    name: '',
    amount: 0,
  };
  budgetData.requiredBills.push(bill);
  renderRequiredBills();
  saveData();
}

function updateRequiredBill(id, field, value) {
  const bill = budgetData.requiredBills.find((b) => b.id === id);
  if (bill) {
    bill[field] = field === 'amount' ? parseFloat(value) || 0 : value;
    saveData();
    updateSummary();
    updateAllCharts();
  }
}

function deleteRequiredBill(id) {
  if (confirm('Delete this bill?')) {
    budgetData.requiredBills = budgetData.requiredBills.filter(
      (b) => b.id !== id,
    );
    renderRequiredBills();
    saveData();
    updateSummary();
    updateAllCharts();
  }
}

// Other Expenses
function addOtherExpense() {
  const expense = {
    id: generateUUID(),
    name: '',
    amount: 0,
  };
  budgetData.otherExpenses.push(expense);
  renderOtherExpenses();
  saveData();
}

function updateOtherExpense(id, field, value) {
  const expense = budgetData.otherExpenses.find((e) => e.id === id);
  if (expense) {
    expense[field] = field === 'amount' ? parseFloat(value) || 0 : value;
    saveData();
    updateSummary();
    updateAllCharts();
  }
}

function deleteOtherExpense(id) {
  if (confirm('Delete this expense?')) {
    budgetData.otherExpenses = budgetData.otherExpenses.filter(
      (e) => e.id !== id,
    );
    renderOtherExpenses();
    saveData();
    updateSummary();
    updateAllCharts();
  }
}

// Savings
function addSavings() {
  const savings = {
    id: generateUUID(),
    name: '',
    amount: 0,
  };
  budgetData.savings.push(savings);
  renderSavings();
  saveData();
}

function updateSavings(id, field, value) {
  const saving = budgetData.savings.find((s) => s.id === id);
  if (saving) {
    saving[field] = field === 'amount' ? parseFloat(value) || 0 : value;
    saveData();
    updateSummary();
    updateAllCharts();
  }
}

function deleteSavings(id) {
  if (confirm('Delete this savings?')) {
    budgetData.savings = budgetData.savings.filter((s) => s.id !== id);
    renderSavings();
    saveData();
    updateSummary();
    updateAllCharts();
  }
}

// Debt
function addDebt() {
  const debt = {
    id: generateUUID(),
    name: '',
    principal: 0,
    interestRate: 0,
    minimumPayment: 0,
    extraPayment: 0,
  };
  budgetData.debts.push(debt);
  renderDebts();
  saveData();
}

function updateDebtItem(id, field, value) {
  const debt = budgetData.debts.find((d) => d.id === id);
  if (debt) {
    if (
      ['principal', 'interestRate', 'minimumPayment', 'extraPayment'].includes(
        field,
      )
    ) {
      debt[field] = parseFloat(value) || 0;
    } else {
      debt[field] = value;
    }
    saveData();
    updateDebtSummary();
    updateSummary();
    updateAllCharts();
  }
}

function deleteDebt(id) {
  if (confirm('Delete this debt?')) {
    budgetData.debts = budgetData.debts.filter((d) => d.id !== id);
    renderDebts();
    saveData();
    updateDebtSummary();
    updateSummary();
    updateAllCharts();
  }
}

// ============ Calculations ============

function calculateTotalIncome() {
  const s1 = budgetData.income.spouse1.paychecks.reduce(
    (sum, p) => sum + p.amount,
    0,
  );
  const s2 = budgetData.income.spouse2.paychecks.reduce(
    (sum, p) => sum + p.amount,
    0,
  );
  return s1 + s2;
}

function calculateSpouseIncome(spouseKey) {
  return budgetData.income[spouseKey].paychecks.reduce(
    (sum, p) => sum + p.amount,
    0,
  );
}

function calculateTotalRequiredBills() {
  return budgetData.requiredBills.reduce((sum, bill) => sum + bill.amount, 0);
}

function calculateTotalOtherExpenses() {
  return budgetData.otherExpenses.reduce(
    (sum, expense) => sum + expense.amount,
    0,
  );
}

function calculateTotalSavings() {
  return budgetData.savings.reduce((sum, saving) => sum + saving.amount, 0);
}

function calculateTotalDebtPayment() {
  return budgetData.debts.reduce((sum, debt) => {
    return sum + (debt.minimumPayment + debt.extraPayment);
  }, 0);
}

function calculateRemainingBalance() {
  const income = calculateTotalIncome();
  const bills = calculateTotalRequiredBills();
  const expenses = calculateTotalOtherExpenses();
  const savings = calculateTotalSavings();
  const debt = calculateTotalDebtPayment();
  return income - bills - expenses - savings - debt;
}

// ============ Rendering ============

function renderAll() {
  renderMonthNavigator();
  renderIncome();
  renderRequiredBills();
  renderOtherExpenses();
  renderSavings();
  renderDebts();
  updateDebtSummary();
  updateSummary();
  renderMonthlyComparison();
}

function renderMonthNavigator() {
  const container = document.getElementById('monthNavigator');
  if (!container) return;

  const allMonths = getAllMonths();
  const displayMonth = appState.currentViewMonth || appState.activeMonth;
  const availableYears = getAvailableYears();
  const selectedYear =
    appState.navigatorYear || Number(displayMonth.split('-')[0]);

  let html = '';

  const currentIndex = allMonths.indexOf(displayMonth);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < allMonths.length - 1;

  html += '<select id="yearSelector" class="month-selector">';
  availableYears.forEach((year) => {
    const selected = year === selectedYear ? 'selected' : '';
    html += `<option value="${year}" ${selected}>${year}</option>`;
  });
  html += '</select>';

  html += `<button class="month-nav-btn" id="prevMonthBtn" ${hasPrev ? '' : 'disabled'}>&#9664;</button>`;

  html += '<select id="monthSelector" class="month-selector">';
  allMonths.forEach((month) => {
    const label = formatMonthLabel(month);
    const isActive = month === appState.activeMonth;
    const suffix = isActive ? ' (Current)' : '';
    const selected = month === displayMonth ? 'selected' : '';
    html += `<option value="${month}" ${selected}>${label}${suffix}</option>`;
  });
  html += '</select>';

  html += `<button class="month-nav-btn" id="nextMonthBtn" ${hasNext ? '' : 'disabled'}>&#9654;</button>`;

  if (displayMonth === appState.activeMonth) {
    html +=
      '<button class="btn-primary month-new-btn" id="startNewMonthBtn">Start New Month</button>';
  } else if (displayMonth > appState.activeMonth) {
    html += '<span class="viewing-archive-label">Viewing future month</span>';
  } else {
    html += '<span class="viewing-archive-label">Viewing archived month</span>';
  }

  container.innerHTML = html;

  document.getElementById('yearSelector').addEventListener('change', (e) => {
    switchNavigatorYear(e.target.value);
  });

  document.getElementById('monthSelector').addEventListener('change', (e) => {
    switchToMonth(e.target.value);
  });
  document.getElementById('prevMonthBtn').addEventListener('click', () => {
    if (hasPrev) switchToMonth(allMonths[currentIndex - 1]);
  });
  document.getElementById('nextMonthBtn').addEventListener('click', () => {
    if (hasNext) switchToMonth(allMonths[currentIndex + 1]);
  });
  const startBtn = document.getElementById('startNewMonthBtn');
  if (startBtn) {
    startBtn.addEventListener('click', startNewMonth);
  }
}

function renderIncome() {
  document.getElementById('spouse1Name').value = budgetData.income.spouse1.name;
  document.getElementById('spouse2Name').value = budgetData.income.spouse2.name;
  renderPaychecks('spouse1');
  renderPaychecks('spouse2');
  setSecondPersonVisibility(shouldShowSecondPerson());
  renderIncomeTotal();
}

function renderPaychecks(spouseKey) {
  const container = document.getElementById(spouseKey + 'Paychecks');
  container.innerHTML = '';

  budgetData.income[spouseKey].paychecks.forEach((paycheck) => {
    const row = document.createElement('div');
    row.className = 'paycheck-row';
    row.innerHTML = `
            <input type="number" placeholder="0.00" step="0.01" min="0" value="${paycheck.amount}"
                onchange="updatePaycheck('${spouseKey}', '${paycheck.id}', this.value)">
            <button class="btn-delete" onclick="deletePaycheck('${spouseKey}', '${paycheck.id}')">Delete</button>
        `;
    container.appendChild(row);
  });

  const spouseTotal = calculateSpouseIncome(spouseKey);
  document.getElementById(spouseKey + 'Total').textContent =
    formatCurrency(spouseTotal);
}

function renderIncomeTotal() {
  ['spouse1', 'spouse2'].forEach((key) => {
    document.getElementById(key + 'Total').textContent = formatCurrency(
      calculateSpouseIncome(key),
    );
  });
  document.getElementById('totalIncome').textContent = formatCurrency(
    calculateTotalIncome(),
  );
}

function renderRequiredBills() {
  const container = document.getElementById('requiredBillsList');
  container.innerHTML = '';

  budgetData.requiredBills.forEach((bill) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
            <input type="text" placeholder="Bill name" value="${bill.name}"
                onchange="updateRequiredBill('${bill.id}', 'name', this.value)">
            <input type="number" placeholder="0.00" step="0.01" min="0" value="${bill.amount}"
                onchange="updateRequiredBill('${bill.id}', 'amount', this.value)">
            <button class="btn-delete" onclick="deleteRequiredBill('${bill.id}')">Delete</button>
        `;
    container.appendChild(row);
  });

  const total = calculateTotalRequiredBills();
  document.getElementById('totalBills').textContent = formatCurrency(total);
}

function renderOtherExpenses() {
  const container = document.getElementById('otherExpensesList');
  container.innerHTML = '';

  budgetData.otherExpenses.forEach((expense) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
            <input type="text" placeholder="Expense name" value="${expense.name}"
                onchange="updateOtherExpense('${expense.id}', 'name', this.value)">
            <input type="number" placeholder="0.00" step="0.01" min="0" value="${expense.amount}"
                onchange="updateOtherExpense('${expense.id}', 'amount', this.value)">
            <button class="btn-delete" onclick="deleteOtherExpense('${expense.id}')">Delete</button>
        `;
    container.appendChild(row);
  });

  const total = calculateTotalOtherExpenses();
  document.getElementById('totalExpenses').textContent = formatCurrency(total);
}

function renderSavings() {
  const container = document.getElementById('savingsList');
  container.innerHTML = '';

  budgetData.savings.forEach((saving) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
            <input type="text" placeholder="Savings name" value="${saving.name}"
                onchange="updateSavings('${saving.id}', 'name', this.value)">
            <input type="number" placeholder="0.00" step="0.01" min="0" value="${saving.amount}"
                onchange="updateSavings('${saving.id}', 'amount', this.value)">
            <button class="btn-delete" onclick="deleteSavings('${saving.id}')">Delete</button>
        `;
    container.appendChild(row);
  });

  const total = calculateTotalSavings();
  document.getElementById('totalSavings').textContent = formatCurrency(total);
}

function renderDebts() {
  const container = document.getElementById('debtsList');
  container.innerHTML = '';

  budgetData.debts.forEach((debt) => {
    const row = document.createElement('div');
    row.className = 'debt-row';
    row.innerHTML = `
            <input type="text" placeholder="Debt name" value="${debt.name}"
                onchange="updateDebtItem('${debt.id}', 'name', this.value)">
            <input type="number" placeholder="Principal" step="0.01" min="0" value="${debt.principal}"
                onchange="updateDebtItem('${debt.id}', 'principal', this.value)">
            <input type="number" placeholder="Interest %" step="0.01" min="0" value="${debt.interestRate}"
                onchange="updateDebtItem('${debt.id}', 'interestRate', this.value)">
            <input type="number" placeholder="Min payment" step="0.01" min="0" value="${debt.minimumPayment}"
                onchange="updateDebtItem('${debt.id}', 'minimumPayment', this.value)">
            <input type="number" placeholder="Extra payment" step="0.01" min="0" value="${debt.extraPayment}"
                onchange="updateDebtItem('${debt.id}', 'extraPayment', this.value)">
            <button class="btn-delete" onclick="deleteDebt('${debt.id}')">Delete</button>
        `;
    container.appendChild(row);
  });
}

function updateDebtSummary() {
  const debts = budgetData.debts;
  const monthlyPayment = calculateTotalDebtPayment();
  document.getElementById('monthlyPayment').textContent =
    formatCurrency(monthlyPayment);

  let minTotalInterest = 0;
  let extraTotalInterest = 0;
  let maxMinPayoff = null;
  let maxExtraPayoff = null;
  let minHasWarning = false;
  let extraHasWarning = false;
  const warningNames = [];
  let hasActiveDebt = false;

  debts.forEach((debt) => {
    if (debt.principal <= 0 || debt.minimumPayment <= 0) {
      return;
    }

    hasActiveDebt = true;
    const comparison = comparePayoffScenarios(
      debt.principal,
      debt.interestRate,
      debt.minimumPayment,
      debt.extraPayment,
    );

    if (comparison.minimum.warning) {
      minHasWarning = true;
      warningNames.push(debt.name || 'Unnamed debt');
    } else if (comparison.minimum.payoffDate) {
      minTotalInterest += comparison.minimum.totalInterest;
      if (!maxMinPayoff || comparison.minimum.payoffDate > maxMinPayoff) {
        maxMinPayoff = comparison.minimum.payoffDate;
      }
    }

    if (comparison.withExtra.warning) {
      extraHasWarning = true;
    } else if (comparison.withExtra.payoffDate) {
      extraTotalInterest += comparison.withExtra.totalInterest;
      if (!maxExtraPayoff || comparison.withExtra.payoffDate > maxExtraPayoff) {
        maxExtraPayoff = comparison.withExtra.payoffDate;
      }
    }
  });

  if (!hasActiveDebt) {
    document.getElementById('payoffDateMin').textContent = '-';
    document.getElementById('payoffDateExtra').textContent = '-';
    document.getElementById('totalInterestMin').textContent = '$0.00';
    document.getElementById('totalInterestExtra').textContent = '$0.00';
    document.getElementById('interestSaved').textContent = '$0.00';
  } else {
    document.getElementById('payoffDateMin').textContent = minHasWarning
      ? 'Never'
      : maxMinPayoff
        ? formatDate(maxMinPayoff)
        : '-';
    document.getElementById('payoffDateExtra').textContent = extraHasWarning
      ? 'Never'
      : maxExtraPayoff
        ? formatDate(maxExtraPayoff)
        : '-';
    document.getElementById('totalInterestMin').textContent = minHasWarning
      ? 'N/A'
      : formatCurrency(minTotalInterest);
    document.getElementById('totalInterestExtra').textContent = extraHasWarning
      ? 'N/A'
      : formatCurrency(extraTotalInterest);
    if (minHasWarning || extraHasWarning) {
      document.getElementById('interestSaved').textContent = 'N/A';
    } else {
      document.getElementById('interestSaved').textContent = formatCurrency(
        minTotalInterest - extraTotalInterest,
      );
    }
  }

  const summaryDiv = document.getElementById('debtSummary');
  const existingWarning = summaryDiv.querySelector('.warning');
  if (warningNames.length > 0) {
    const warningText = `⚠️ Warning: Monthly payment is less than monthly interest for: ${warningNames.join(', ')}.`;
    if (existingWarning) {
      existingWarning.textContent = warningText;
    } else {
      const warning = document.createElement('div');
      warning.className = 'warning';
      warning.textContent = warningText;
      summaryDiv.appendChild(warning);
    }
  } else if (existingWarning) {
    existingWarning.remove();
  }
}

function updateSummary() {
  const income = calculateTotalIncome();
  const bills = calculateTotalRequiredBills();
  const expenses = calculateTotalOtherExpenses();
  const savings = calculateTotalSavings();
  const debt = calculateTotalDebtPayment();
  const remaining = calculateRemainingBalance();

  document.getElementById('summaryIncome').textContent = formatCurrency(income);
  document.getElementById('summaryBills').textContent = formatCurrency(bills);
  document.getElementById('summaryExpenses').textContent =
    formatCurrency(expenses);
  document.getElementById('summarySavings').textContent =
    formatCurrency(savings);
  document.getElementById('summaryDebt').textContent = formatCurrency(debt);
  document.getElementById('summaryRemaining').textContent =
    formatCurrency(remaining);

  // Color code remaining balance
  const remainingEl = document.getElementById('summaryRemaining');
  remainingEl.style.color = remaining >= 0 ? 'var(--success)' : 'var(--danger)';
}

// ============ Monthly Tracking ============

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function recordMonthlyActuals() {
  const modal = document.getElementById('endMonthModal');
  const modalBody = document.getElementById('modalBody');

  // Update modal header to show which month
  const displayMonth = appState.currentViewMonth || appState.activeMonth;
  document.querySelector('.modal-header h2').textContent =
    `Record Actual Expenses - ${formatMonthLabel(displayMonth)}`;

  // Build modal content with current predicted values
  let content = '';

  // Required Bills
  if (budgetData.requiredBills.length > 0) {
    content += '<div class="modal-section"><h3>Required Bills</h3>';
    budgetData.requiredBills.forEach((bill) => {
      content += `
                <div class="modal-item">
                    <div class="input-group">
                        <label>${bill.name || 'Unnamed Bill'} (Predicted)</label>
                        <input type="number" value="${bill.amount}" disabled>
                    </div>
                    <div class="input-group">
                        <label>Actual Amount</label>
                        <input type="number" class="actual-input" data-category="requiredBills"
                            data-id="${bill.id}" data-name="${bill.name}"
                            value="${bill.amount}" step="0.01" min="0">
                    </div>
                </div>
            `;
    });
    content += '</div>';
  }

  // Other Expenses
  if (budgetData.otherExpenses.length > 0) {
    content += '<div class="modal-section"><h3>Other Expenses</h3>';
    budgetData.otherExpenses.forEach((expense) => {
      content += `
                <div class="modal-item">
                    <div class="input-group">
                        <label>${expense.name || 'Unnamed Expense'} (Predicted)</label>
                        <input type="number" value="${expense.amount}" disabled>
                    </div>
                    <div class="input-group">
                        <label>Actual Amount</label>
                        <input type="number" class="actual-input" data-category="otherExpenses"
                            data-id="${expense.id}" data-name="${expense.name}"
                            value="${expense.amount}" step="0.01" min="0">
                    </div>
                </div>
            `;
    });
    content += '</div>';
  }

  // Savings
  if (budgetData.savings.length > 0) {
    content += '<div class="modal-section"><h3>Savings</h3>';
    budgetData.savings.forEach((saving) => {
      content += `
                <div class="modal-item">
                    <div class="input-group">
                        <label>${saving.name || 'Unnamed Savings'} (Predicted)</label>
                        <input type="number" value="${saving.amount}" disabled>
                    </div>
                    <div class="input-group">
                        <label>Actual Amount</label>
                        <input type="number" class="actual-input" data-category="savings"
                            data-id="${saving.id}" data-name="${saving.name}"
                            value="${saving.amount}" step="0.01" min="0">
                    </div>
                </div>
            `;
    });
    content += '</div>';
  }

  modalBody.innerHTML = content;
  modal.classList.add('show');
}

function saveMonthlyActuals() {
  const currentMonth = appState.currentViewMonth || appState.activeMonth;
  const actualInputs = document.querySelectorAll('.actual-input');

  const monthData = {
    month: currentMonth,
    predicted: {
      requiredBills: {},
      otherExpenses: {},
      savings: {},
    },
    actual: {
      requiredBills: {},
      otherExpenses: {},
      savings: {},
    },
  };

  // Collect predicted values
  budgetData.requiredBills.forEach((bill) => {
    monthData.predicted.requiredBills[bill.id] = {
      name: bill.name,
      amount: bill.amount,
    };
  });
  budgetData.otherExpenses.forEach((expense) => {
    monthData.predicted.otherExpenses[expense.id] = {
      name: expense.name,
      amount: expense.amount,
    };
  });
  budgetData.savings.forEach((saving) => {
    monthData.predicted.savings[saving.id] = {
      name: saving.name,
      amount: saving.amount,
    };
  });

  // Collect actual values from inputs
  actualInputs.forEach((input) => {
    const category = input.dataset.category;
    const id = input.dataset.id;
    const name = input.dataset.name;
    const amount = parseFloat(input.value) || 0;
    monthData.actual[category][id] = { name: name, amount: amount };
  });

  // Check if month already exists and update, otherwise add
  const existingIndex = budgetData.monthlyHistory.findIndex(
    (m) => m.month === currentMonth,
  );
  if (existingIndex >= 0) {
    budgetData.monthlyHistory[existingIndex] = monthData;
  } else {
    budgetData.monthlyHistory.push(monthData);
  }

  saveData();
  closeModal();
  renderMonthlyComparison();
  updateAllCharts();
  alert('Monthly actuals saved successfully!');
}

function renderMonthlyComparison() {
  const container = document.getElementById('monthlyComparison');

  if (budgetData.monthlyHistory.length === 0) {
    container.innerHTML =
      '<p>No monthly history yet. Click "End of Month" to start tracking.</p>';
    return;
  }

  // Show most recent month
  const latestMonth =
    budgetData.monthlyHistory[budgetData.monthlyHistory.length - 1];

  let html = `<h3>Latest Month: ${latestMonth.month}</h3>`;
  html +=
    '<table class="comparison-table"><thead><tr><th>Category</th><th>Item</th><th>Predicted</th><th>Actual</th><th>Variance</th></tr></thead><tbody>';

  // Required Bills
  for (const id in latestMonth.predicted.requiredBills) {
    const predicted = latestMonth.predicted.requiredBills[id];
    const actual = latestMonth.actual.requiredBills[id];
    const variance = actual.amount - predicted.amount;
    const varianceClass =
      variance > 0 ? 'variance-negative' : 'variance-positive';

    html += `<tr>
            <td>Required Bill</td>
            <td>${predicted.name}</td>
            <td>${formatCurrency(predicted.amount)}</td>
            <td>${formatCurrency(actual.amount)}</td>
            <td class="${varianceClass}">${formatCurrency(Math.abs(variance))}</td>
        </tr>`;
  }

  // Other Expenses
  for (const id in latestMonth.predicted.otherExpenses) {
    const predicted = latestMonth.predicted.otherExpenses[id];
    const actual = latestMonth.actual.otherExpenses[id];
    const variance = actual.amount - predicted.amount;
    const varianceClass =
      variance > 0 ? 'variance-negative' : 'variance-positive';

    html += `<tr>
            <td>Other Expense</td>
            <td>${predicted.name}</td>
            <td>${formatCurrency(predicted.amount)}</td>
            <td>${formatCurrency(actual.amount)}</td>
            <td class="${varianceClass}">${formatCurrency(Math.abs(variance))}</td>
        </tr>`;
  }

  // Savings
  for (const id in latestMonth.predicted.savings) {
    const predicted = latestMonth.predicted.savings[id];
    const actual = latestMonth.actual.savings[id];
    const variance = actual.amount - predicted.amount;
    const varianceClass =
      variance < 0 ? 'variance-negative' : 'variance-positive';

    html += `<tr>
            <td>Savings</td>
            <td>${predicted.name}</td>
            <td>${formatCurrency(predicted.amount)}</td>
            <td>${formatCurrency(actual.amount)}</td>
            <td class="${varianceClass}">${formatCurrency(Math.abs(variance))}</td>
        </tr>`;
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ============ Charts ============

function updateAllCharts() {
  updateIncomeExpensesChart();
  updateExpenseBreakdownChart();
  updateDebtTimelineChart();
  updateDebtPayoffComparisonChart();
  updatePredictedActualChart();
}

function updateIncomeExpensesChart() {
  const ctx = document.getElementById('incomeExpensesChart');

  const income = calculateTotalIncome();
  const bills = calculateTotalRequiredBills();
  const expenses = calculateTotalOtherExpenses();
  const savings = calculateTotalSavings();
  const debt = calculateTotalDebtPayment();
  const remaining = calculateRemainingBalance();

  if (charts.incomeExpenses) {
    charts.incomeExpenses.destroy();
  }

  charts.incomeExpenses = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: [
        'Income',
        'Required Bills',
        'Other Expenses',
        'Savings',
        'Debt Payment',
        'Remaining',
      ],
      datasets: [
        {
          data: [
            income,
            bills,
            expenses,
            savings,
            debt,
            Math.max(0, remaining),
          ],
          backgroundColor: [
            'rgba(16, 185, 129, 0.8)',
            'rgba(59, 130, 246, 0.8)',
            'rgba(245, 158, 11, 0.8)',
            'rgba(139, 92, 246, 0.8)',
            'rgba(239, 68, 68, 0.8)',
            'rgba(16, 185, 129, 0.3)',
          ],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
        },
      },
    },
  });
}

function updateExpenseBreakdownChart() {
  const ctx = document.getElementById('expenseBreakdownChart');

  const labels = [];
  const data = [];
  const colors = [];

  budgetData.requiredBills.forEach((bill) => {
    labels.push(bill.name || 'Unnamed Bill');
    data.push(bill.amount);
    colors.push('rgba(59, 130, 246, 0.8)');
  });

  budgetData.otherExpenses.forEach((expense) => {
    labels.push(expense.name || 'Unnamed Expense');
    data.push(expense.amount);
    colors.push('rgba(245, 158, 11, 0.8)');
  });

  budgetData.savings.forEach((saving) => {
    labels.push(saving.name || 'Unnamed Savings');
    data.push(saving.amount);
    colors.push('rgba(139, 92, 246, 0.8)');
  });

  budgetData.debts.forEach((debt) => {
    const payment = debt.minimumPayment + debt.extraPayment;
    if (payment > 0) {
      labels.push(debt.name || 'Debt Payment');
      data.push(payment);
      colors.push('rgba(239, 68, 68, 0.8)');
    }
  });

  if (charts.expenseBreakdown) {
    charts.expenseBreakdown.destroy();
  }

  charts.expenseBreakdown = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [
        {
          data: data,
          backgroundColor: colors,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
        },
      },
    },
  });
}

function getDebtColor(index, alpha) {
  const hue = (index * 47) % 360;
  return `hsla(${hue}, 70%, 45%, ${alpha})`;
}

function buildAggregateDebtSchedule(debts, useExtraPayment) {
  const totals = [];
  let maxMonths = 0;

  debts.forEach((debt) => {
    if (debt.principal <= 0 || debt.minimumPayment <= 0) return;

    const scenario = calculatePayoffDate(
      debt.principal,
      debt.interestRate,
      debt.minimumPayment,
      useExtraPayment ? debt.extraPayment : 0,
    );

    if (scenario.warning || scenario.schedule.length === 0) return;

    maxMonths = Math.max(maxMonths, scenario.schedule.length);
    scenario.schedule.forEach((entry, idx) => {
      totals[idx] = (totals[idx] || 0) + entry.balance;
    });
  });

  const labels = Array.from({ length: maxMonths }, (_, idx) => String(idx + 1));
  const data = labels.map((_, idx) => totals[idx] || 0);
  return { labels, data, hasData: data.some((value) => value > 0) };
}

function updateDebtTimelineChart() {
  const ctx = document.getElementById('debtTimelineChart');
  const debts = budgetData.debts;

  if (charts.debtTimeline) {
    charts.debtTimeline.destroy();
  }

  if (debtTimelineMode === 'per-debt') {
    const series = [];
    let maxMonths = 0;

    debts.forEach((debt, index) => {
      if (debt.principal <= 0 || debt.minimumPayment <= 0) return;

      const minScenario = calculatePayoffDate(
        debt.principal,
        debt.interestRate,
        debt.minimumPayment,
        0,
      );
      const extraScenario = calculatePayoffDate(
        debt.principal,
        debt.interestRate,
        debt.minimumPayment,
        debt.extraPayment,
      );

      const minData = minScenario.warning
        ? []
        : minScenario.schedule.map((entry) => entry.balance);
      const extraData = extraScenario.warning
        ? []
        : extraScenario.schedule.map((entry) => entry.balance);

      if (minData.length === 0 && extraData.length === 0) return;

      maxMonths = Math.max(maxMonths, minData.length, extraData.length);
      series.push({
        name: debt.name || 'Debt',
        minData,
        extraData,
        index,
      });
    });

    if (series.length === 0) {
      charts.debtTimeline = new Chart(ctx, {
        type: 'line',
        data: {
          labels: ['0'],
          datasets: [
            {
              label: 'No debt data',
              data: [0],
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
        },
      });
      return;
    }

    const labels = Array.from({ length: maxMonths }, (_, idx) =>
      String(idx + 1),
    );
    const datasets = [];

    series.forEach((item) => {
      if (item.minData.length > 0) {
        datasets.push({
          label: `${item.name} (Min)`,
          data: labels.map((_, idx) => item.minData[idx] || 0),
          borderColor: getDebtColor(item.index, 0.9),
          backgroundColor: getDebtColor(item.index, 0.15),
          tension: 0.1,
        });
      }
      if (item.extraData.length > 0) {
        datasets.push({
          label: `${item.name} (Extra)`,
          data: labels.map((_, idx) => item.extraData[idx] || 0),
          borderColor: getDebtColor(item.index, 0.6),
          backgroundColor: getDebtColor(item.index, 0.08),
          borderDash: [6, 4],
          tension: 0.1,
        });
      }
    });

    charts.debtTimeline = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'bottom',
          },
        },
        scales: {
          x: {
            title: {
              display: true,
              text: 'Months',
            },
          },
          y: {
            title: {
              display: true,
              text: 'Balance ($)',
            },
            ticks: {
              callback: function (value) {
                return '$' + value.toLocaleString();
              },
            },
          },
        },
      },
    });
    return;
  }

  const minSchedule = buildAggregateDebtSchedule(debts, false);
  const extraSchedule = buildAggregateDebtSchedule(debts, true);
  const hasData = minSchedule.hasData || extraSchedule.hasData;

  if (!hasData) {
    charts.debtTimeline = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['0'],
        datasets: [
          {
            label: 'No debt data',
            data: [0],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
      },
    });
    return;
  }

  const maxLabelCount = Math.max(
    minSchedule.labels.length,
    extraSchedule.labels.length,
  );
  const labels = Array.from({ length: maxLabelCount }, (_, idx) =>
    String(idx + 1),
  );
  const minData = labels.map((_, idx) => minSchedule.data[idx] || 0);
  const extraData = labels.map((_, idx) => extraSchedule.data[idx] || 0);

  charts.debtTimeline = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Minimum Payment Only',
          data: minData,
          borderColor: 'rgba(239, 68, 68, 1)',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          tension: 0.1,
        },
        {
          label: 'With Extra Payment',
          data: extraData,
          borderColor: 'rgba(16, 185, 129, 1)',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          tension: 0.1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: 'Months',
          },
        },
        y: {
          title: {
            display: true,
            text: 'Balance ($)',
          },
          ticks: {
            callback: function (value) {
              return '$' + value.toLocaleString();
            },
          },
        },
      },
    },
  });
}

function updateDebtPayoffComparisonChart() {
  const ctx = document.getElementById('debtPayoffComparisonChart');
  const debts = budgetData.debts;

  if (charts.debtPayoffComparison) {
    charts.debtPayoffComparison.destroy();
  }

  if (debts.length === 0) {
    charts.debtPayoffComparison = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['No data'],
        datasets: [
          {
            label: 'No debt data',
            data: [0],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
      },
    });
    return;
  }

  const labels = debts.map((debt) => debt.name || 'Debt');
  const minMonths = [];
  const extraMonths = [];

  debts.forEach((debt) => {
    if (debt.principal <= 0 || debt.minimumPayment <= 0) {
      minMonths.push(null);
      extraMonths.push(null);
      return;
    }

    const comparison = comparePayoffScenarios(
      debt.principal,
      debt.interestRate,
      debt.minimumPayment,
      debt.extraPayment,
    );

    minMonths.push(
      comparison.minimum.warning ? null : comparison.minimum.months,
    );
    extraMonths.push(
      comparison.withExtra.warning ? null : comparison.withExtra.months,
    );
  });

  charts.debtPayoffComparison = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Minimum Payment',
          data: minMonths,
          backgroundColor: 'rgba(239, 68, 68, 0.75)',
        },
        {
          label: 'With Extra Payment',
          data: extraMonths,
          backgroundColor: 'rgba(16, 185, 129, 0.75)',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              const value = context.raw;
              const label = context.dataset.label;
              return value === null ? `${label}: N/A` : `${label}: ${value}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: 'Debt',
          },
        },
        y: {
          title: {
            display: true,
            text: 'Months to Payoff',
          },
          beginAtZero: true,
        },
      },
    },
  });
}

function updatePredictedActualChart() {
  const ctx = document.getElementById('predictedActualChart');

  if (charts.predictedActual) {
    charts.predictedActual.destroy();
  }

  if (budgetData.monthlyHistory.length === 0) {
    charts.predictedActual = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['No data'],
        datasets: [
          {
            label: 'No monthly history',
            data: [0],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
      },
    });
    return;
  }

  // Aggregate data from all months
  const months = budgetData.monthlyHistory.map((m) => m.month);
  const predictedTotals = [];
  const actualTotals = [];

  budgetData.monthlyHistory.forEach((month) => {
    let predictedSum = 0;
    let actualSum = 0;

    // Sum all categories
    for (const id in month.predicted.requiredBills) {
      predictedSum += month.predicted.requiredBills[id].amount;
    }
    for (const id in month.predicted.otherExpenses) {
      predictedSum += month.predicted.otherExpenses[id].amount;
    }
    for (const id in month.predicted.savings) {
      predictedSum += month.predicted.savings[id].amount;
    }

    for (const id in month.actual.requiredBills) {
      actualSum += month.actual.requiredBills[id].amount;
    }
    for (const id in month.actual.otherExpenses) {
      actualSum += month.actual.otherExpenses[id].amount;
    }
    for (const id in month.actual.savings) {
      actualSum += month.actual.savings[id].amount;
    }

    predictedTotals.push(predictedSum);
    actualTotals.push(actualSum);
  });

  charts.predictedActual = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        {
          label: 'Predicted',
          data: predictedTotals,
          backgroundColor: 'rgba(59, 130, 246, 0.8)',
        },
        {
          label: 'Actual',
          data: actualTotals,
          backgroundColor: 'rgba(245, 158, 11, 0.8)',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: 'Month',
          },
        },
        y: {
          title: {
            display: true,
            text: 'Total Amount ($)',
          },
          ticks: {
            callback: function (value) {
              return '$' + value.toLocaleString();
            },
          },
        },
      },
    },
  });
}

function setDebtTimelineMode(mode) {
  debtTimelineMode = mode;
  document.querySelectorAll('[data-debt-timeline-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.debtTimelineMode === mode);
  });
  updateDebtTimelineChart();
}

// ============ Event Listeners ============

function initializeEventListeners() {
  // Income
  document
    .getElementById('spouse1Name')
    .addEventListener('change', () => updateSpouseName('spouse1'));
  document
    .getElementById('spouse2Name')
    .addEventListener('change', () => updateSpouseName('spouse2'));
  document
    .getElementById('addPaycheck1Btn')
    .addEventListener('click', () => addPaycheck('spouse1'));
  document
    .getElementById('addPaycheck2Btn')
    .addEventListener('click', () => addPaycheck('spouse2'));
  document
    .getElementById('addPersonBtn')
    .addEventListener('click', addSecondPerson);

  // Required Bills
  document
    .getElementById('addBillBtn')
    .addEventListener('click', addRequiredBill);

  // Other Expenses
  document
    .getElementById('addExpenseBtn')
    .addEventListener('click', addOtherExpense);

  // Savings
  document
    .getElementById('addSavingsBtn')
    .addEventListener('click', addSavings);

  // Debt
  document.getElementById('addDebtBtn').addEventListener('click', addDebt);
  document.querySelectorAll('[data-debt-timeline-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      setDebtTimelineMode(button.dataset.debtTimelineMode);
    });
  });
  setDebtTimelineMode(debtTimelineMode);

  // Monthly Tracking
  document
    .getElementById('endMonthBtn')
    .addEventListener('click', recordMonthlyActuals);

  // Modal
  document.querySelector('.close').addEventListener('click', closeModal);
  document.getElementById('cancelModal').addEventListener('click', closeModal);
  document
    .getElementById('saveActuals')
    .addEventListener('click', saveMonthlyActuals);

  // Data Management
  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      importData(e.target.files[0]);
    }
  });
  document.getElementById('clearBtn').addEventListener('click', clearAllData);
}

function closeModal() {
  document.getElementById('endMonthModal').classList.remove('show');
}

// Close modal when clicking outside
window.addEventListener('click', (e) => {
  const modal = document.getElementById('endMonthModal');
  if (e.target === modal) {
    closeModal();
  }
});
