import { supabase } from './supabaseClient.js';
import { formatMoney, getCurrentWeekNumber, getWeekDates, setupWeekDropdown } from './utils.js';

const DEFAULT_WEEKLY_BUDGET = 700;
const currentRealWeek = getCurrentWeekNumber();

let selectedWeek = currentRealWeek;
let expenseChart = null;
let currentUserId = null;

/* =========================================================
   INIT
========================================================= */
document.addEventListener('DOMContentLoaded', init);

document.getElementById('btn-logout-nav')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await supabase.auth.signOut();
    window.location.replace('./index.html');
});

async function init() {
    const user = await getAuthenticatedUser();
    if (!user) return;
    currentUserId = user.id;

    renderWeekDropdown();
    await loadDashboardData(selectedWeek);
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
        currentWeek: selectedWeek,
        realWeek: currentRealWeek,
        onSelectWeek: (w) => {
            selectedWeek = w;
            renderWeekDropdown();
            loadDashboardData(selectedWeek);
        }
    });
}

/* =========================================================
   LOAD DASHBOARD DATA
========================================================= */
async function loadDashboardData(weekNum) {
    const [budgetRes, expensesRes, installmentsRes, savingsRes, todosRes, deadlinesRes] = await Promise.all([
        supabase.from('weekly_budgets').select('*').eq('user_id', currentUserId).eq('week_number', weekNum).maybeSingle(),
        supabase.from('daily_expenses').select('*').eq('user_id', currentUserId).eq('week_number', weekNum),
        supabase.from('installments').select('*').eq('user_id', currentUserId).eq('is_completed', false),
        supabase.from('piggy_savings').select('*').eq('user_id', currentUserId).maybeSingle(),
        supabase.from('todos').select('*').eq('user_id', currentUserId).eq('week_number', weekNum),
        supabase.from('deadlines').select('*').eq('user_id', currentUserId).gte('event_date', new Date().toISOString().substring(0, 10)).order('event_date', { ascending: true }).limit(5)
    ]);

    const budget = budgetRes.data?.budget_amount ?? DEFAULT_WEEKLY_BUDGET;
    const expenses = expensesRes.data || [];
    const installments = installmentsRes.data || [];
    const savings = savingsRes.data?.total_savings || 0;
    const todos = todosRes.data || [];
    const upcomingDeadlines = deadlinesRes.data || [];

    const totalDailyExpenses = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalInstallments = installments.reduce((sum, item) => sum + (Number(item.total_amount) / Number(item.total_weeks)), 0);
    const totalSpent = totalDailyExpenses + totalInstallments;
    const remainingBudget = Math.max(budget - totalSpent, 0);

    const completedTodos = todos.filter(t => t.is_completed).length;
    const totalTodos = todos.length;
    const todoProgress = totalTodos > 0 ? Math.round((completedTodos / totalTodos) * 100) : 0;

    renderOverviewCards({ budget, totalSpent, remainingBudget, savings, todoProgress, completedTodos, totalTodos });
    renderExpenseChart(expenses, weekNum);
    renderActiveInstallments(installments);
    renderUpcomingDeadlines(upcomingDeadlines);
}

/* =========================================================
   RENDER OVERVIEW CARDS
========================================================= */
function renderOverviewCards({ budget, totalSpent, remainingBudget, savings, todoProgress, completedTodos, totalTodos }) {
    document.getElementById('dash-budget').innerText = `${formatMoney(budget)} .-`;
    document.getElementById('dash-spent').innerText = `${formatMoney(totalSpent)} .-`;
    document.getElementById('dash-remaining').innerText = `${formatMoney(remainingBudget)} .-`;
    document.getElementById('dash-savings').innerText = `${formatMoney(savings)} .-`;

    document.getElementById('dash-task-percent').innerText = `${todoProgress}%`;
    document.getElementById('dash-task-progress').style.width = `${todoProgress}%`;
    document.getElementById('dash-task-count').innerText = `${completedTodos}/${totalTodos} Tasks Completed`;
}

/* =========================================================
   RENDER CHART (Chart.js)
========================================================= */
function renderExpenseChart(expenses, weekNum) {
    const ctx = document.getElementById('expenseChart')?.getContext('2d');
    if (!ctx) return;

    const daysLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weekDates = getWeekDates(new Date().getFullYear(), weekNum);

    const dailySums = weekDates.map(dateStr => {
        return expenses
            .filter(e => e.expense_date === dateStr)
            .reduce((sum, e) => sum + Number(e.amount || 0), 0);
    });

    if (expenseChart) expenseChart.destroy();

    expenseChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: daysLabels,
            datasets: [{
                label: 'Expenses (THB)',
                data: dailySums,
                backgroundColor: '#e88d67',
                borderRadius: 8,
                hoverBackgroundColor: '#d67b55'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: '#f3e6d8' },
                    ticks: { color: '#8c6d58' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#8c6d58', font: { weight: 'bold' } }
                }
            }
        }
    });
}

/* =========================================================
   RENDER LISTS (Installments & Deadlines)
========================================================= */
function renderActiveInstallments(installments) {
    const list = document.getElementById('dash-installment-list');
    if (!list) return;

    if (!installments.length) {
        list.innerHTML = `<div class="text-center text-xs text-gray-400 py-4">No active installments</div>`;
        return;
    }

    list.innerHTML = installments.map(item => {
        const weekly = Number(item.total_amount) / Number(item.total_weeks);
        return `
            <div class="flex justify-between items-center p-2.5 bg-[#fef8f0] rounded-xl border border-[#fbe4c0]">
                <div>
                    <p class="font-bold text-[15px] tracking-wide text-[#5c3d2e]">• ${item.title}</p>
                    <p class="text-[10px] text-gray-500">Paid ${item.current_week_count}/${item.total_weeks} weeks</p>
                </div>
                <span class="font-bold text-xs text-[#dc7a5d]">${formatMoney(weekly)} .-/W</span>
            </div>
        `;
    }).join('');
}

function renderUpcomingDeadlines(deadlines) {
    const list = document.getElementById('dash-deadline-list');
    if (!list) return;

    if (!deadlines.length) {
        list.innerHTML = `<div class="text-center text-xs text-gray-400 py-4">No upcoming deadlines</div>`;
        return;
    }

    list.innerHTML = deadlines.map(item => `
        <div class="flex items-center gap-3 p-2.5 bg-[#fff5f5] rounded-xl border border-[#ffe0e0]">
            <div class="bg-[#fe9a00] text-white font-bold text-[10px] px-2 py-1 rounded-md">
                ${new Date(item.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
            <span class="font-bold tracking-wider text-[15px] text-[#5c3d2e] truncate flex-1">${item.title}</span>
        </div>
    `).join('');
}