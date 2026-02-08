/**
 * Debt Calculator Module
 * Handles debt payoff calculations with interest rates
 */

/**
 * Calculate monthly interest for a given balance and annual rate
 * @param {number} balance - Current debt balance
 * @param {number} annualRate - Annual interest rate as percentage (e.g., 5 for 5%)
 * @returns {number} Monthly interest amount
 */
function calculateMonthlyInterest(balance, annualRate) {
    const monthlyRate = annualRate / 100 / 12;
    return balance * monthlyRate;
}

/**
 * Calculate debt payoff timeline with interest
 * @param {number} principal - Initial debt balance
 * @param {number} interestRate - Annual interest rate as percentage (e.g., 5 for 5%)
 * @param {number} minimumPayment - Minimum monthly payment
 * @param {number} extraPayment - Additional monthly payment (default 0)
 * @returns {Object} Payoff details including months, date, total interest, and monthly schedule
 */
function calculatePayoffDate(principal, interestRate, minimumPayment, extraPayment = 0) {
    // Handle edge cases
    if (principal <= 0) {
        return {
            months: 0,
            payoffDate: new Date(),
            totalInterest: 0,
            schedule: [],
            warning: null
        };
    }

    const totalPayment = minimumPayment + extraPayment;
    const monthlyRate = interestRate / 100 / 12;
    const monthlyInterest = principal * monthlyRate;

    // Check if payment is less than interest (debt will never be paid off)
    if (totalPayment <= monthlyInterest) {
        return {
            months: Infinity,
            payoffDate: null,
            totalInterest: Infinity,
            schedule: [],
            warning: 'Monthly payment must be greater than monthly interest to pay off debt'
        };
    }

    // Calculate number of months using amortization formula
    // n = -log(1 - (r * P) / A) / log(1 + r)
    // Where: n = months, r = monthly rate, P = principal, A = payment
    let months;
    if (monthlyRate === 0) {
        // No interest case
        months = Math.ceil(principal / totalPayment);
    } else {
        const numerator = Math.log(1 - (monthlyRate * principal) / totalPayment);
        const denominator = Math.log(1 + monthlyRate);
        months = Math.ceil(-numerator / denominator);
    }

    // Generate monthly payment schedule
    const schedule = [];
    let balance = principal;
    let totalInterestPaid = 0;

    for (let month = 1; month <= months && balance > 0; month++) {
        const interestPayment = balance * monthlyRate;
        const principalPayment = Math.min(totalPayment - interestPayment, balance);
        const payment = interestPayment + principalPayment;

        totalInterestPaid += interestPayment;
        balance -= principalPayment;

        schedule.push({
            month: month,
            payment: payment,
            principal: principalPayment,
            interest: interestPayment,
            balance: Math.max(0, balance)
        });
    }

    // Calculate payoff date
    const payoffDate = new Date();
    payoffDate.setMonth(payoffDate.getMonth() + months);

    return {
        months: months,
        payoffDate: payoffDate,
        totalInterest: totalInterestPaid,
        schedule: schedule,
        warning: null
    };
}

/**
 * Compare two payoff scenarios (minimum vs with extra payment)
 * @param {number} principal - Initial debt balance
 * @param {number} interestRate - Annual interest rate as percentage
 * @param {number} minimumPayment - Minimum monthly payment
 * @param {number} extraPayment - Additional monthly payment
 * @returns {Object} Comparison of both scenarios
 */
function comparePayoffScenarios(principal, interestRate, minimumPayment, extraPayment) {
    const minScenario = calculatePayoffDate(principal, interestRate, minimumPayment, 0);
    const extraScenario = calculatePayoffDate(principal, interestRate, minimumPayment, extraPayment);

    return {
        minimum: minScenario,
        withExtra: extraScenario,
        interestSaved: minScenario.totalInterest - extraScenario.totalInterest,
        monthsSaved: minScenario.months - extraScenario.months
    };
}

/**
 * Format currency for display
 * @param {number} amount - Amount to format
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount) {
    if (amount === Infinity || isNaN(amount)) {
        return 'N/A';
    }
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
}

/**
 * Format date for display
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDate(date) {
    if (!date || !(date instanceof Date) || isNaN(date)) {
        return 'N/A';
    }
    return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }).format(date);
}
