import { supabase } from './supabaseClient.js';
import {
    formatMoney,
    getCurrentWeekNumber,
    getWeekDates,
    toISODate,
    escapeHtml,
    setText,
    setInputValue,
    setupWeekDropdown
} from './utils.js';

const DEFAULT_WEEKLY_BUDGET = 700;
const MAX_PIGGY_LEVEL = 9;
const PIGGY_LEVEL_THRESHOLDS = [0, 1, 250, 500, 1000, 1500, 2000, 2500, 3000, 3500];

const currentRealWeek = getCurrentWeekNumber();

const state = {
    userId: null,
    year: new Date().getFullYear(),
    week: currentRealWeek,
    selectedDate: toISODate(new Date()),
    budget: null,
    expenses: [],
    installments: [],
    savings: null
};

/* =========================================================
   START
========================================================= */
document.addEventListener('DOMContentLoaded', init);
document.getElementById('btn-logout-nav')?.addEventListener('click', async (e) => {
    e.preventDefault();

    // สั่งออกจากระบบ
    await supabase.auth.signOut();

    // สั่งเด้งไปหน้า Login ทันที
    window.location.replace('./index.html');
});
async function init() {
    const user = await getAuthenticatedUser();
    if (!user) return;
    state.userId = user.id;

    bindEvents();
    renderWeekDropdown();
    await loadWeek(state.week);
    await checkAutoCollectSunday();
}

async function getAuthenticatedUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        window.location.replace('./index.html');
        return null;
    }
    return user;
}

/* =========================================================
   NAVBAR & WEEK DROPDOWN
========================================================= */
function renderWeekDropdown() {
    setupWeekDropdown({
        currentWeek: state.week,
        realWeek: currentRealWeek,
        onSelectWeek: (selectedWeek) => selectWeek(selectedWeek)
    });
}

async function selectWeek(weekNum) {
    state.week = weekNum;
    const weekDates = getWeekDates(state.year, state.week);
    state.selectedDate = weekDates[0];

    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
    }

    renderWeekDropdown();
    await loadWeek(state.week);
}

/* =========================================================
   EVENTS
========================================================= */
function bindEvents() {
    const bindClick = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);

    bindClick('btn-add-expense', () => document.getElementById('add_expense_modal')?.showModal());
    bindClick('btn-add-installment', () => {
        resetInstallmentForm();
        document.getElementById('add_installment_modal')?.showModal();
    });

    bindClick('btn-save-expense', addExpense);
    bindClick('btn-create-installment', addInstallment);
    bindClick('btn-collect-week', () => collectWeek(false));

    const updatePreview = () => {
        const total = Number(document.getElementById('installment-total')?.value);
        const weeks = Number(document.getElementById('installment-weeks')?.value);
        setText('installment-average', (total && weeks > 0) ? `${formatMoney(total / weeks)} .- / Week` : '0 .- / Week');
    };

    document.getElementById('installment-total')?.addEventListener('input', updatePreview);
    document.getElementById('installment-weeks')?.addEventListener('input', updatePreview);
}

/* =========================================================
   CORE LOAD DATA
========================================================= */
async function loadWeek(week) {
    state.week = Number(week);

    await ensureWeeklyBudget();
    await Promise.all([
        loadExpenses(),
        loadInstallments(),
        loadSavings()
    ]);

    renderDayButtons();
    renderExpenses();
    renderInstallments();
    renderSavings();
}

async function ensureWeeklyBudget() {
    // 1. เช็กดูก่อนว่ามีงบของสัปดาห์ที่กำลังเลือกดูอยู่หรือยัง
    const { data, error } = await supabase
        .from('weekly_budgets')
        .select('*')
        .eq('user_id', state.userId)
        .eq('week_number', state.week)
        .eq('year', state.year)
        .maybeSingle();

    if (error) console.error('weekly_budgets SELECT:', error);

    // ถ้ามีข้อมูลของสัปดาห์นี้อยู่แล้ว ใช้ได้เลย!
    if (data) {
        state.budget = data;
    } else {
        // 2. ถ้ายังไม่มีข้อมูลของสัปดาห์นี้ ต้องเช็กว่าเป็น "สัปดาห์ปัจจุบัน" หรือไม่
        // ถ้าเป็นสัปดาห์ปัจจุบัน (currentRealWeek) ยอมให้สร้างข้อมูลงบใหม่ทันที เพื่อให้ผู้ใช้ใช้งานได้ปกติ
        if (state.week === currentRealWeek) {
            let fallbackBudget = DEFAULT_WEEKLY_BUDGET;

            // ดึงงบล่าสุดที่เคยตั้งไว้มาเป็นค่าเริ่มต้น
            const { data: latestData } = await supabase
                .from('weekly_budgets')
                .select('budget_amount')
                .eq('user_id', state.userId)
                .order('year', { ascending: false })
                .order('week_number', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (latestData && latestData.budget_amount) {
                fallbackBudget = latestData.budget_amount;
            }

            // บันทึกงบของสัปดาห์ปัจจุบันลง Database ทันที
            const { data: created, error: insertError } = await supabase
                .from('weekly_budgets')
                .insert({
                    user_id: state.userId,
                    week_number: state.week,
                    year: state.year,
                    budget_amount: fallbackBudget,
                    is_collected: false
                })
                .select()
                .single();

            if (insertError) console.error('weekly_budgets INSERT:', insertError);
            state.budget = created;
        } else {
            // 3. แต่ถ้าเป็นสัปดาห์อนาคต (หรือสัปดาห์ถัดไปที่ยังไม่ถึงเวลา) ห้ามสร้างเด็ดขาด! 
            // ให้แสดงค่าเริ่มต้นชั่วคราวไปก่อนจนกว่าจะถึงเวลาจริง
            state.budget = {
                budget_amount: DEFAULT_WEEKLY_BUDGET,
                is_collected: false
            };
        }
    }
}

/* =========================================================
   EXPENSES
========================================================= */
async function loadExpenses() {
    const { data, error } = await supabase
        .from('daily_expenses')
        .select('*')
        .eq('user_id', state.userId)
        .eq('week_number', state.week)
        .order('expense_date', { ascending: true })
        .order('created_at', { ascending: true });

    if (error) console.error('daily_expenses SELECT:', error);

    state.expenses = data || [];
    const weekDates = getWeekDates(state.year, state.week);
    if (!weekDates.includes(state.selectedDate)) {
        state.selectedDate = weekDates[0];
    }
}

async function addExpense() {
    const title = document.getElementById('expense-name')?.value.trim();
    const amount = Number(document.getElementById('expense-amount')?.value);

    if (!title || !Number.isFinite(amount) || amount <= 0) {
        return Swal.fire('Warning', 'Please enter a valid title and amount.', 'warning');
    }

    const { error } = await supabase.from('daily_expenses').insert({
        user_id: state.userId,
        week_number: state.week,
        expense_date: state.selectedDate,
        title,
        amount
    });

    if (error) return Swal.fire('Error', error.message, 'error');

    setInputValue('expense-name', '');
    setInputValue('expense-amount', '');
    document.getElementById('add_expense_modal')?.close();
    await loadWeek(state.week);
}

async function deleteExpense(id) {
    const confirm = await Swal.fire({
        title: 'Are you sure?',
        text: 'Do you want to delete this expense item?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel'
    });

    if (!confirm.isConfirmed) return;

    const { error } = await supabase.from('daily_expenses').delete().eq('id', id).eq('user_id', state.userId);
    if (error) return Swal.fire('Error', error.message, 'error');

    await loadWeek(state.week);
}

function renderExpenses() {
    const list = document.getElementById('expense-list');
    if (!list) return;

    const selectedExpenses = state.expenses.filter(item => item.expense_date === state.selectedDate);
    const weekDates = getWeekDates(state.year, state.week);
    const isMonday = state.selectedDate === weekDates[0];
    const activeInstallments = isMonday ? state.installments.filter(item => !item.is_completed) : [];

    list.innerHTML = '';

    if (!selectedExpenses.length && !activeInstallments.length) {
        list.innerHTML = `<div class="text-center text-sm text-gray-400 py-8">No expenses for today</div>`;
    }

    activeInstallments.forEach(item => {
        const weeklyAmount = Number(item.total_amount) / Number(item.total_weeks);
        const row = document.createElement('div');
        row.className = 'flex justify-between items-center p-2.5 bg-[#f3e8ff] rounded-2xl border border-[#d8b4fe]';
        row.innerHTML = `
            <div class="flex items-center gap-1.5">
                <span class="text-xs bg-[#9333ea] text-white px-2 py-0.5 rounded-md font-bold">Installment</span>
                <span class="font-bold text-[#581c87]">• ${escapeHtml(item.title)}</span>
            </div>
            <span class="text-[#7e22ce] font-bold">${formatMoney(weeklyAmount)}.-</span>
        `;
        list.appendChild(row);
    });

    selectedExpenses.forEach(expense => {
        const row = document.createElement('div');
        row.className = 'flex justify-between items-center p-2.5 bg-[#fef8f0] rounded-2xl border border-[#fbe4c0]';
        row.innerHTML = `
            <span class="font-bold">• ${escapeHtml(expense.title)}</span>
            <div class="flex items-center gap-3">
                <span class="text-[#dc7a5d] font-bold">${formatMoney(expense.amount)}.-</span>
                <button type="button" class="btn-delete text-xs text-gray-400 hover:text-red-400">
                    <img width="20" src="../public/image/bank/delete.png" alt="delete">
                </button>
            </div>
        `;
        row.querySelector('.btn-delete')?.addEventListener('click', () => deleteExpense(expense.id));
        list.appendChild(row);
    });

    const dailyExpenseTotal = selectedExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const dailyInstallmentTotal = activeInstallments.reduce((sum, item) => sum + (Number(item.total_amount) / Number(item.total_weeks)), 0);

    setText('daily-expense-total', `${formatMoney(dailyExpenseTotal + dailyInstallmentTotal)}.-`);
    setText('day-remaining-budget', `${formatMoney(getRemainingThisWeek())}.-`);
}

/* =========================================================
   INSTALLMENTS
========================================================= */
async function loadInstallments() {
    const { data, error } = await supabase
        .from('installments')
        .select('*')
        .eq('user_id', state.userId)
        .order('created_at', { ascending: true });

    if (error) console.error('installments SELECT:', error);
    state.installments = data || [];
}

async function addInstallment() {
    const title = document.getElementById('installment-name')?.value.trim();
    const totalAmount = Number(document.getElementById('installment-total')?.value);
    const totalWeeks = Number(document.getElementById('installment-weeks')?.value);

    if (!title || !Number.isFinite(totalAmount) || totalAmount <= 0 || !Number.isInteger(totalWeeks) || totalWeeks <= 0) {
        return Swal.fire('Warning', 'Please enter valid installment details.', 'warning');
    }

    const { error } = await supabase.from('installments').insert({
        user_id: state.userId,
        title,
        total_amount: totalAmount,
        total_weeks: totalWeeks,
        start_week: state.week,
        current_week_count: 0,
        is_completed: false
    });

    if (error) return Swal.fire('Error', `Failed to create installment: ${error.message}`, 'error');

    document.getElementById('add_installment_modal')?.close();
    resetInstallmentForm();
    await loadWeek(state.week);
}

function renderInstallments() {
    const list = document.getElementById('installment-list');
    if (!list) return;

    const active = state.installments.filter(item => !item.is_completed);
    list.innerHTML = active.length ? '' : `<div class="text-center text-sm text-gray-400 py-8">No active installments</div>`;

    active.forEach(item => {
        const row = document.createElement('div');
        const paidWeeks = Number(item.current_week_count || 0);
        const totalWeeks = Number(item.total_weeks || 1);
        const weeklyAmount = Number(item.total_amount) / totalWeeks;
        const paidAmount = Math.min(paidWeeks * weeklyAmount, item.total_amount);

        row.className = 'bg-[#fef8f0] p-3 rounded-2xl border border-[#fbe4c0] flex flex-col gap-1';
        row.innerHTML = `
            <div class="flex justify-between items-center">
                <p class="font-bold text-sm text-[#5c3d2e]">• ${escapeHtml(item.title)}</p>
                <div class="flex items-center gap-1.5">
                    <span class="text-[11px] text-gray-500 font-medium">(${formatMoney(weeklyAmount)} .-/W)</span>
                    <span class="font-bold text-xs text-[#dc7a5d]">${formatMoney(item.total_amount)}.-</span>
                </div>
            </div>
            <div class="flex justify-between items-center text-[11px] text-gray-500">
                <span>Paid: ${formatMoney(paidAmount)}.-</span>
                <span>(${paidWeeks}/${totalWeeks} Weeks)</span>
            </div>
        `;
        list.appendChild(row);
    });

    setText('weekly-installment-total', `${formatMoney(getWeeklyInstallmentTotal())}.-`);
}

function resetInstallmentForm() {
    setInputValue('installment-name', '');
    setInputValue('installment-total', '');
    setInputValue('installment-weeks', '');
    setText('installment-average', '0 .- / Week');
}

/* =========================================================
   PIGGY & SAVINGS
========================================================= */
async function loadSavings() {
    const { data, error } = await supabase.from('piggy_savings').select('*').eq('user_id', state.userId).maybeSingle();
    if (error) console.error('piggy_savings SELECT:', error);

    if (data) {
        state.savings = data;
    } else {
        const { data: created } = await supabase.from('piggy_savings').insert({
            user_id: state.userId,
            total_savings: 0,
            unlocked_level: 0,
            updated_at: new Date().toISOString()
        }).select().single();
        state.savings = created;
    }
}

function calculatePiggyLevel(totalSavings) {
    if (totalSavings <= 0) return 0;
    let level = 1;
    for (let i = 1; i < PIGGY_LEVEL_THRESHOLDS.length; i++) {
        if (totalSavings >= PIGGY_LEVEL_THRESHOLDS[i]) level = i;
    }
    return Math.min(level, MAX_PIGGY_LEVEL);
}

function renderSavings() {
    const total = Number(state.savings?.total_savings || 0);
    const level = calculatePiggyLevel(total);

    setText('total-savings', `${formatMoney(total)}.-`);
    setText('piggy-level', level);

    const image = document.getElementById('piggy-image');
    if (image) {
        image.src = `../public/image/bank/pig-${level}.png`;
        image.className = 'w-full h-full object-contain scale-170 transition-transform duration-300';
    }
}

/* =========================================================
   COLLECT MONEY
========================================================= */
async function collectWeek(isAuto = false) {
    const { data: latestBudget, error } = await supabase
        .from('weekly_budgets')
        .select('*')
        .eq('user_id', state.userId)
        .eq('week_number', state.week)
        .eq('year', state.year)
        .maybeSingle();

    if (error) {
        if (!isAuto) Swal.fire('Error', 'Failed to fetch weekly budget data.', 'error');
        return;
    }

    let activeBudget = latestBudget;
    if (!activeBudget) {
        const { data: created } = await supabase.from('weekly_budgets').insert({
            user_id: state.userId,
            week_number: state.week,
            year: state.year,
            budget_amount: DEFAULT_WEEKLY_BUDGET,
            is_collected: false
        }).select().single();
        activeBudget = created;
    }

    if (activeBudget && activeBudget.is_collected) {
        if (!isAuto) Swal.fire('Notice', 'This week\'s budget has already been collected!', 'info');
        return;
    }

    const remaining = getRemainingThisWeek();
    const activeInstallments = state.installments.filter(item => !item.is_completed);
    const currentSavings = Number(state.savings?.total_savings || 0);
    const newSavings = currentSavings + remaining;
    const newLevel = calculatePiggyLevel(newSavings);

    const { error: savingsErr } = await supabase.from('piggy_savings').update({
        total_savings: newSavings,
        unlocked_level: newLevel,
        updated_at: new Date().toISOString()
    }).eq('id', state.savings.id).eq('user_id', state.userId);

    if (savingsErr) return Swal.fire('Error', savingsErr.message, 'error');

    await supabase.from('weekly_budgets').update({ is_collected: true }).eq('id', activeBudget.id);

    for (const item of activeInstallments) {
        const nextCount = Number(item.current_week_count || 0) + 1;
        await supabase.from('installments').update({
            current_week_count: nextCount,
            is_completed: nextCount >= Number(item.total_weeks)
        }).eq('id', item.id);
    }

    if (typeof showCoinAnimation === 'function') window.showCoinAnimation();

    Swal.fire({
        title: isAuto ? '🔔 Sunday Auto-Collect' : '🎉 Piggy Bank Saved!',
        html: `
            <p class="text-lg font-semibold text-gray-700">Added Savings: <span class="text-green-600">${formatMoney(remaining)} .-</span></p>
            <p class="text-sm text-gray-500 mt-1">Total Savings: ${formatMoney(newSavings)} .-</p>
            <p class="text-sm font-bold text-purple-600 mt-2">Piggy Level: ${newLevel}</p>
        `,
        icon: 'success',
        confirmButtonText: 'OK'
    });

    await loadWeek(state.week);
}

async function checkAutoCollectSunday() {
    const today = new Date();
    if (today.getDay() === 0 && today.getHours() === 23 && today.getMinutes() >= 59) {
        const { data: currentBudget } = await supabase
            .from('weekly_budgets')
            .select('is_collected')
            .eq('user_id', state.userId)
            .eq('week_number', state.week)
            .eq('year', state.year)
            .maybeSingle();

        if (currentBudget && !currentBudget.is_collected) {
            await collectWeek(true);
        }
    }
}

/* =========================================================
   HELPERS & CALCULATIONS
========================================================= */
function getWeeklyExpenseTotal() {
    return state.expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function getWeeklyInstallmentTotal() {
    return state.installments.filter(item => !item.is_completed).reduce((sum, item) => {
        return sum + (Number(item.total_amount) / Number(item.total_weeks));
    }, 0);
}

function getRemainingThisWeek() {
    const budget = Number(state.budget?.budget_amount ?? DEFAULT_WEEKLY_BUDGET);
    return Math.max(budget - getWeeklyExpenseTotal() - getWeeklyInstallmentTotal(), 0);
}

function renderDayButtons() {
    const container = document.getElementById('day-buttons');
    if (!container) return;

    const labels = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const dates = getWeekDates(state.year, state.week);
    container.innerHTML = '';

    labels.forEach((label, index) => {
        const date = dates[index];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `flex-1 py-1 rounded-xl transition-colors ${date === state.selectedDate ? 'bg-white text-[#5c3d2e] font-bold shadow-xs' : 'hover:bg-white/40'}`;
        button.innerHTML = `<span class="block">${label}</span><span class="text-[10px]">${new Date(`${date}T00:00:00`).getDate()}</span>`;

        button.addEventListener('click', () => {
            state.selectedDate = date;
            renderDayButtons();
            renderExpenses();
        });
        container.appendChild(button);
    });

    if (state.selectedDate) {
        const date = new Date(`${state.selectedDate}T00:00:00`);
        setText('selected-day-label', date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }).toUpperCase());
    }
}