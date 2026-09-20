// utils.js

// 1. ฟังก์ชันจัด Format เงิน
export function formatMoney(val) {
    return Number(val || 0).toLocaleString('en-US', { 
        minimumFractionDigits: 0, 
        maximumFractionDigits: 2 
    });
}

// 2. ฟังก์ชันคำนวณสัปดาห์ปัจจุบัน (ISO Week Number)
export function getCurrentWeekNumber(d = new Date()) {
    const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - day);
    return Math.ceil((((target - new Date(Date.UTC(target.getUTCFullYear(), 0, 1))) / 86400000) + 1) / 7);
}

// 3. ฟังก์ชันแปลง Date เป็น YYYY-MM-DD
export function toISODate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 4. ฟังก์ชันหาช่วงวันที่ของสัปดาห์ (Mon - Sun)
export function getWeekDates(year, week) {
    const jan4 = new Date(year, 0, 4);
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1 + ((week - 1) * 7));

    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return toISODate(d);
    });
}

// 5. ฟังก์ชัน Escape HTML ป้องกัน XSS
export function escapeHtml(val) {
    return String(val).replace(/[&<>"']/g, m => ({ 
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' 
    }[m]));
}

// 6. ฟังก์ชันจัดการ DOM Text / Input
export function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

export function setInputValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

/**
 * 7. Navbar Week Dropdown Component กลาง
 */
export function setupWeekDropdown({ currentWeek, realWeek, onSelectWeek }) {
    const dropdownList = document.getElementById('week-dropdown-list');
    const label = document.getElementById('current-week-label');
    if (!dropdownList || !label) return;

    label.innerText = `WEEK ${currentWeek}/52`;
    dropdownList.innerHTML = '';

    // ช่องค้นหาเลือกสัปดาห์
    const searchLi = document.createElement('li');
    searchLi.className = 'p-2 border-b border-[#f3e6d8]';
    searchLi.innerHTML = `
        <div class="flex gap-1.5 items-center bg-[#fef8ed] p-1.5 rounded-lg border border-[#f0d8c2]">
            <input type="number" min="1" max="52" id="week-search-input" 
                placeholder="Jump to week (1-52)..." 
                class="w-full text-xs px-2 py-1 bg-transparent border-none focus:outline-none focus:ring-0 text-[#5c3d2e] font-semibold placeholder-[#c5a898]" />
            <button id="btn-go-week" class="btn btn-xs bg-[#e88d67] hover:bg-[#d67b55] text-white border-none rounded-md px-3 font-bold">GO</button>
        </div>
    `;
    dropdownList.appendChild(searchLi);

    const searchInput = searchLi.querySelector('#week-search-input');
    const goBtn = searchLi.querySelector('#btn-go-week');

    const handleJump = () => {
        const val = parseInt(searchInput.value, 10);
        if (val >= 1 && val <= 52) {
            onSelectWeek(val);
        } else {
            if (typeof Swal !== 'undefined') {
                Swal.fire('Warning', 'กรุณากรอกสัปดาห์ระหว่าง 1 - 52 ครับ', 'warning');
            } else {
                alert('กรุณากรอกสัปดาห์ระหว่าง 1 - 52 ครับ');
            }
        }
    };

    goBtn?.addEventListener('click', handleJump);
    searchInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleJump();
    });

    // ปุ่มลัดไปสัปดาห์ปัจจุบัน
    const todayLi = document.createElement('li');
    todayLi.innerHTML = `
        <a class="font-bold text-[#d66d4b] bg-[#fef2e6] hover:bg-[#fde2cf] flex justify-between my-1 rounded-lg">
            <span>CURRENT WEEK</span>
            <span class="badge badge-sm badge-warning">W${realWeek}</span>
        </a>
    `;
    todayLi.addEventListener('click', () => onSelectWeek(realWeek));
    dropdownList.appendChild(todayLi);

    const divider = document.createElement('div');
    divider.className = 'divider my-0 opacity-30';
    dropdownList.appendChild(divider);

    // รายการสัปดาห์ใกล้เคียง ±2
    const minWeek = Math.max(1, currentWeek - 2);
    const maxWeek = Math.min(52, currentWeek + 2);

    for (let w = minWeek; w <= maxWeek; w++) {
        const li = document.createElement('li');
        const isSelected = w === currentWeek;
        const isCurrent = w === realWeek;

        li.innerHTML = `
            <a class="${isSelected ? 'active font-bold bg-[#e88d67] text-white hover:bg-[#d67b55]' : 'text-[#5c3d2e] hover:bg-[#fef2e6]'} flex justify-between rounded-lg">
                <span>Week ${w}/52</span>
                ${isCurrent ? `<span class="text-xs ${isSelected ? 'text-amber-100' : 'text-[#e88d67]'}">(This week)</span>` : ''}
            </a>
        `;
        li.addEventListener('click', () => onSelectWeek(w));
        dropdownList.appendChild(li);
    }
}