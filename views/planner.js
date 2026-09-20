import { supabase } from './supabaseClient.js';
import Holidays from 'https://esm.sh/date-holidays';
import { getCurrentWeekNumber, toISODate, setupWeekDropdown } from './utils.js';

// --- CONSTANTS ---
const hd = new Holidays('TH');
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTH_NAMES = [
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"
];

const CAT_FRAMES = [
    '../public/image/planner/cat-1.jpg',
    '../public/image/planner/cat-2.png',
    '../public/image/planner/cat-3.jpg',
    '../public/image/planner/cat-4.jpg',
    '../public/image/planner/cat-3.jpg',
    '../public/image/planner/cat-2.png'
];

// --- STATE MANAGEMENT ---
let currentUserId = null;
let currentDate = new Date();
let currentRealWeek = getCurrentWeekNumber(currentDate);
let selectedWeekNumber = currentRealWeek;
let modalCurrentDate = new Date();
let selectedDateForEvent = new Date();
let selectedDayForTodo = '';
let catAnimInterval = null;
let holidaysMap = {};
const dayCardElements = {};

function getDateOfISOWeek(w, y) {
    const simple = new Date(y, 0, 1 + (w - 1) * 7);
    const dow = simple.getDay();
    const ISOweekStart = new Date(simple);
    if (dow <= 4) ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
    else ISOweekStart.setDate(simple.getDate() + (8 - simple.getDay()));
    return ISOweekStart;
}

/* =========================================================
   INIT APP & AUTH
========================================================= */
document.addEventListener('DOMContentLoaded', async () => {
    const user = await getAuthenticatedUser();
    if (!user) return;
    currentUserId = user.id;

    renderDayCards();
    setupModalEvents();
    renderWeekDropdown();
    fetchHolidays(currentDate.getFullYear());

    await Promise.all([updateCalendar(), loadTodos()]);
});

async function getAuthenticatedUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        window.location.replace('./index.html');
        return null;
    }
    return user;
}
document.getElementById('btn-logout-nav')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await supabase.auth.signOut();
    window.location.replace('./index.html');
});

// --- HOLIDAY ENGINE ---
function fetchHolidays(year) {
    try {
        const holidays = hd.getHolidays(year);
        holidaysMap = {};
        holidays.forEach(item => {
            holidaysMap[item.date.substring(0, 10)] = item.name;
        });
    } catch (err) {
        console.error('Calculates holidays error:', err);
    }
}

function isSpecialHoliday(dateString) {
    return Boolean(holidaysMap[dateString]);
}

// --- NAVBAR & WEEK DROPDOWN ---
function renderWeekDropdown() {
    setupWeekDropdown({
        currentWeek: selectedWeekNumber,
        realWeek: currentRealWeek,
        onSelectWeek: (selectedWeek) => selectWeek(selectedWeek)
    });
}

function selectWeek(weekNum) {
    selectedWeekNumber = weekNum;

    const targetYear = currentDate.getFullYear();
    const weekStartDate = getDateOfISOWeek(selectedWeekNumber, targetYear);
    currentDate = new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), 1);

    fetchHolidays(currentDate.getFullYear());
    updateCalendar();

    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
    }

    loadTodos();
    renderWeekDropdown();
}

// --- EVENT LISTENERS ---
function setupModalEvents() {
    document.getElementById('btn-save-todo')?.addEventListener('click', handleSaveTodo);
    document.querySelector('.relative.w-full.bg-\\[\\#9c7356\\]')?.addEventListener('click', openCalendarModal);

    document.getElementById('modal-prev-month')?.addEventListener('click', () => changeModalMonth(-1));
    document.getElementById('modal-next-month')?.addEventListener('click', () => changeModalMonth(1));

    document.getElementById('btn-save-event')?.addEventListener('click', handleSaveEvent);
}

async function changeModalMonth(delta) {
    const prevYear = modalCurrentDate.getFullYear();
    modalCurrentDate.setMonth(modalCurrentDate.getMonth() + delta);

    if (modalCurrentDate.getFullYear() !== prevYear) {
        fetchHolidays(modalCurrentDate.getFullYear());
    }

    renderModalCalendar();
}

// --- TODO HANDLERS ---
async function handleSaveTodo() {
    const input = document.getElementById('todo-input');
    const title = input?.value.trim();
    if (!title) return;

    const { error } = await supabase.from('todos').insert([{
        title,
        day_of_week: selectedDayForTodo,
        week_number: selectedWeekNumber,
        is_completed: false,
        user_id: currentUserId
    }]);

    if (error) {
        alert('บันทึกไม่สำเร็จ');
        console.error(error);
    } else {
        input.value = '';
        document.getElementById('add_task_modal')?.close();
        loadTodos();
    }
}

function openAddModal(day) {
    selectedDayForTodo = day;
    document.getElementById('modal-day-title').innerText = day.toUpperCase();
    document.getElementById('todo-input').value = '';
    document.getElementById('add_task_modal')?.showModal();
}

async function loadTodos() {
    const { data: todos, error } = await supabase
        .from('todos')
        .select('*')
        .eq('user_id', currentUserId)
        .eq('week_number', selectedWeekNumber);

    if (error) {
        console.error('Error loading todos:', error);
        return;
    }

    if (todos) {
        todos.sort((a, b) => (a.is_completed === b.is_completed ? 0 : a.is_completed ? 1 : -1));
    }

    DAYS.forEach(day => {
        if (dayCardElements[day]) dayCardElements[day].innerHTML = '';
    });

    todos?.forEach(todo => {
        const dayKey = todo.day_of_week?.trim().toLowerCase();
        if (dayCardElements[dayKey]) {
            dayCardElements[dayKey].appendChild(createTodoElement(todo));
        }
    });

    DAYS.forEach(day => {
        const listContainer = dayCardElements[day];
        if (listContainer && listContainer.children.length === 0) {
            listContainer.innerHTML = `
                <div class="flex flex-col gap-2 w-full items-center opacity-80 h-full justify-center">
                    <img class="w-35" src="../public/image/cat-sleep.png" alt="cat-sleep">
                    <h1 class="text-[#c1aea8] text-xs font-bold mt-2">NO PLAN.....</h1>
                </div>
            `;
        }
    });
}

function createTodoElement(todo) {
    const label = document.createElement('label');
    label.className = 'group flex gap-3 items-start cursor-pointer';
    label.innerHTML = `
        <input class="hidden" type="checkbox" ${todo.is_completed ? 'checked' : ''}>
        <div class="w-7 h-7 border-2 border-[#9c7356] rounded-full flex items-center justify-center flex-shrink-0">
            <img src="../public/image/paw2.png" alt="paw-brown" class="w-10 ${todo.is_completed ? '' : 'hidden'} group-has-[:checked]:block">
        </div>
        <h1 class="text-lg text-[#9c7356] ${todo.is_completed ? 'line-through text-[#e0bba1]' : ''} group-has-[:checked]:line-through group-has-[:checked]:text-[#e0bba1] min-w-0 break-words">
            ${todo.title}
        </h1>
    `;

    const checkbox = label.querySelector('input');
    checkbox.addEventListener('change', async () => {
        const { error } = await supabase
            .from('todos')
            .update({ is_completed: checkbox.checked })
            .eq('id', todo.id)
            .eq('user_id', currentUserId);

        if (error) checkbox.checked = !checkbox.checked;
        else loadTodos();
    });

    return label;
}

// --- EVENT HANDLERS ---
async function handleSaveEvent() {
    const input = document.getElementById('modal-event-input');
    const eventTitle = input?.value.trim();
    if (!eventTitle) return;

    const dateStr = toISODate(selectedDateForEvent);

    const { error } = await supabase.from('deadlines').insert([{
        title: eventTitle,
        event_date: dateStr,
        user_id: currentUserId
    }]);

    if (error) {
        console.error('Error adding event:', error);
    } else {
        input.value = '';
        await renderModalEventList();
        await updateCalendar();
    }
}

// --- CALENDAR RENDER ENGINE ---
function generateCalendarDaysHTML(targetDate, deadlineDates, isModal = false, selectedWeekNum = null) {
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

    let startOfWeek, endOfWeek;
    if (selectedWeekNum) {
        startOfWeek = getDateOfISOWeek(selectedWeekNum, year);
        startOfWeek.setHours(0, 0, 0, 0);
        endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);
    } else {
        startOfWeek = new Date(today);
        const dayDiff = today.getDay() === 0 ? 6 : today.getDay() - 1;
        startOfWeek.setDate(today.getDate() - dayDiff);
        startOfWeek.setHours(0, 0, 0, 0);

        endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);
    }

    const firstDayIndex = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const daysHTML = Array(firstDayIndex).fill('<div></div>');

    for (let day = 1; day <= lastDate; day++) {
        const thisDayDate = new Date(year, month, day);
        const dayOfWeek = thisDayDate.getDay();
        const dateString = toISODate(thisDayDate);

        const isThisWeek = thisDayDate >= startOfWeek && thisDayDate <= endOfWeek;
        const isToday = isCurrentMonth && day === today.getDate();
        const hasDeadline = deadlineDates.includes(dateString);
        const isHoliday = isSpecialHoliday(dateString);

        let weekBgClass = '';
        if (isThisWeek) {
            const bgStyle = 'bg-[#fff3d1] text-[#5c3d2e]';
            if (dayOfWeek === 0) weekBgClass = `${bgStyle} rounded-md font-semibold`;
            else if (dayOfWeek === 1 || day === 1) weekBgClass = `${bgStyle} rounded-l-md font-semibold`;
            else if (dayOfWeek === 6 || day === lastDate) weekBgClass = `${bgStyle} rounded-r-md font-semibold`;
            else weekBgClass = `${bgStyle} rounded-none font-semibold`;
        }

        let textColorClass = 'text-[#5c3d2e]';
        if (isHoliday) textColorClass = 'text-red-600 font-extrabold';
        else if (hasDeadline) textColorClass = 'text-amber-600 font-extrabold';
        else if (dayOfWeek === 0 || dayOfWeek === 6) textColorClass = 'text-red-500 font-bold';

        const itemClass = isModal ? 'modal-day-item' : '';
        const pawSize = isModal ? 'w-7 h-7' : 'w-9 h-9';

        let dotHTML = '';
        if (isHoliday && hasDeadline) {
            dotHTML = `<div class="flex gap-0.5 absolute bottom-0.5 pointer-events-none z-10">
                <span class="w-1.5 h-1.5 bg-red-500 rounded-full"></span>
                <span class="w-1.5 h-1.5 bg-amber-500 rounded-full"></span>
            </div>`;
        } else if (isHoliday) {
            dotHTML = `<span class="w-1.5 h-1.5 bg-red-500 rounded-full absolute bottom-0.5 pointer-events-none z-10"></span>`;
        } else if (hasDeadline) {
            dotHTML = `<span class="w-1.5 h-1.5 bg-amber-500 rounded-full absolute bottom-0.5 pointer-events-none z-10"></span>`;
        }

        if (isToday) {
            daysHTML.push(`
                <div class="${itemClass} relative flex items-center justify-center p-0.5 cursor-pointer ${weekBgClass}" data-day="${day}">
                    <img src="../public/image/paw.png" class="absolute ${pawSize} object-contain z-0 animate-pulse pointer-events-none" alt="Today">
                    <span class="relative z-10 ${textColorClass} pointer-events-none">${day}</span>
                </div>
            `);
        } else {
            daysHTML.push(`
                <div class="${itemClass} relative flex flex-col items-center justify-center p-0.5 cursor-pointer hover:bg-amber-100/50 ${weekBgClass}" data-day="${day}">
                    <span class="${textColorClass} pointer-events-none z-10">${day}</span>
                    ${dotHTML}
                </div>
            `);
        }
    }
    return daysHTML.join('');
}

// --- MAIN CALENDAR LOGIC ---
async function fetchDeadlineDates() {
    const { data } = await supabase.from('deadlines').select('event_date').eq('user_id', currentUserId);
    return data?.map(item => item.event_date?.substring(0, 10)).filter(Boolean) || [];
}

async function updateCalendar() {
    const deadlineDates = await fetchDeadlineDates();
    renderCalendar(deadlineDates);
}

function renderCalendar(deadlineDates = []) {
    const calendarDays = document.getElementById('calendar-days');
    const monthTitle = document.getElementById('month-title');
    if (!calendarDays) return;

    if (monthTitle) {
        monthTitle.innerText = `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    }

    calendarDays.innerHTML = generateCalendarDaysHTML(currentDate, deadlineDates, false, selectedWeekNumber);
}

// --- MODAL CALENDAR LOGIC ---
async function openCalendarModal() {
    modalCurrentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    selectedDateForEvent = new Date();

    updateModalSelectedDateText();
    await renderModalCalendar();
    document.getElementById('calendar_modal')?.showModal();
}

function updateModalSelectedDateText() {
    const options = { weekday: 'long', day: 'numeric', month: 'short' };
    document.getElementById('modal-selected-date').innerText = selectedDateForEvent.toLocaleDateString('en-US', options).toLowerCase();
}

async function renderModalCalendar() {
    const calendarDays = document.getElementById('modal-calendar-days');
    const monthTitle = document.getElementById('modal-month-title');
    if (!calendarDays) return;

    const deadlineDates = await fetchDeadlineDates();

    if (monthTitle) {
        monthTitle.innerText = `${MONTH_NAMES[modalCurrentDate.getMonth()]} ${modalCurrentDate.getFullYear()}`;
    }

    calendarDays.innerHTML = generateCalendarDaysHTML(modalCurrentDate, deadlineDates, true, selectedWeekNumber);

    calendarDays.querySelectorAll('.modal-day-item').forEach(el => {
        el.addEventListener('click', (e) => {
            const dayNum = parseInt(e.currentTarget.dataset.day, 10);
            selectedDateForEvent = new Date(modalCurrentDate.getFullYear(), modalCurrentDate.getMonth(), dayNum);

            updateModalSelectedDateText();
            renderModalEventList();
        });
    });

    renderModalEventList();
}

// --- ANIMATION ENGINE ---
function startCatTailAnimation() {
    stopCatTailAnimation();
    const catImg = document.getElementById('animated-cat-img');
    if (!catImg) return;

    let frameIndex = 0;
    catAnimInterval = setInterval(() => {
        frameIndex = (frameIndex + 1) % CAT_FRAMES.length;
        catImg.src = CAT_FRAMES[frameIndex];
    }, 500);
}

function stopCatTailAnimation() {
    if (catAnimInterval) {
        clearInterval(catAnimInterval);
        catAnimInterval = null;
    }
}

// --- RENDER EVENT LIST IN MODAL ---
async function renderModalEventList() {
    const eventList = document.getElementById('modal-event-list');
    if (!eventList) return;

    stopCatTailAnimation();

    const dateStr = toISODate(selectedDateForEvent);
    const holidayName = holidaysMap[dateStr];
    const isSpecial = isSpecialHoliday(dateStr);

    const { data: events, error } = await supabase
        .from('deadlines')
        .select('*')
        .eq('user_id', currentUserId)
        .eq('event_date', dateStr);

    if (error) {
        console.error('Error fetching events:', error);
        return;
    }

    const hasEvents = events && events.length > 0;

    if (!isSpecial && !hasEvents) {
        eventList.innerHTML = `
            <div class="flex flex-col items-center justify-center gap-2 py-2">
                <img id="animated-cat-img" src="${CAT_FRAMES[0]}" class="w-20 h-20 object-contain" alt="Cat Animation">
                <span class="font-bold text-[#5c3d2e] tracking-wide">No events today ~</span>
            </div>
        `;
        startCatTailAnimation();
        return;
    }

    let itemsHTML = '';

    if (isSpecial) {
        itemsHTML += `
            <div class="flex items-center gap-2 text-xs py-1 px-1">
                <span class="w-2 h-2 rounded-full bg-red-500 flex-shrink-0"></span>
                <span class="truncate text-red-600 font-bold">${holidayName}</span>
            </div>
        `;
    }

    if (hasEvents) {
        itemsHTML += events.map(e => `
            <div class="flex items-center gap-2 text-xs py-1 px-1">
                <span class="w-2 h-2 rounded-full bg-[#fe9a00] flex-shrink-0"></span>
                <span class="truncate text-[#5c3d2e] font-medium text-[15px]">${e.title}</span>
            </div>
        `).join('');
    }

    eventList.innerHTML = itemsHTML;
}

// --- TODO CARDS LOGIC ---
function renderDayCards() {
    const container = document.getElementById('todo-container');
    if (!container) return;
    container.innerHTML = '';

    DAYS.forEach(day => {
        const dayCard = document.createElement('div');
        dayCard.className = 'flex flex-col w-full h-full';
        
        dayCard.innerHTML = `
            <div class="bg-[#fbe4c0] rounded-t-3xl p-2 flex justify-center">
                <h1 class="text-[#dc7a5d] text-2xl font-bold pt-2 uppercase">${day}</h1>
            </div>
            <div class="bg-white rounded-b-3xl py-6 px-5 flex flex-col gap-5 shadow-xs h-[300px] justify-between">
                <div class="todo-list flex flex-col gap-2 max-h-[220px] overflow-y-auto custom-scrollbar pr-1"></div>
                <div class="w-full flex justify-center mt-auto">
                    <button class="add-btn text-[#9c7356] bg-[#fbe4c0] p-1 px-5 rounded-2xl active:scale-95 shadow-xs hover:bg-[#f5ddb7] cursor-pointer">ADD</button>
                </div>
            </div>
        `;

        dayCard.querySelector('.add-btn')?.addEventListener('click', () => openAddModal(day));
        container.appendChild(dayCard);

        dayCardElements[day] = dayCard.querySelector('.todo-list');
    });
}