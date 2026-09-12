import { formatDateShort, formatToYYYYMMDD, dateShortOptions } from './date.js';

const charts = {};
const SUCCESS_CODES = ['200', '201', '204', '304'];
const ERROR_CODES = ['400', '401', '403', '404', '429', '500', '502', '503', '504'];
const VALID_INTERVALS = [1, 5, 10, 15, 30, 60, 240, 480, 960, 1440];
const VALID_DAYS = [3, 7, 14, 30, 90];
let dataAvailableDays = 0, dataStartDate = null, serverTimeOffset = 0;

const dateFormatCache = new Map();
const MAX_CACHE_SIZE = 500;

const memoizedFormatToYYYYMMDD = date => {
	const timestamp = date instanceof Date ? date.getTime() : new Date(date).getTime();
	if (dateFormatCache.has(timestamp)) return dateFormatCache.get(timestamp);

	if (dateFormatCache.size >= MAX_CACHE_SIZE) {
		const firstKey = dateFormatCache.keys().next().value;
		dateFormatCache.delete(firstKey);
	}

	const result = formatToYYYYMMDD(date);
	dateFormatCache.set(timestamp, result);
	return result;
};

const localStorageBatcher = (() => {
	const pendingWrites = new Map();
	let timeoutId = null;

	const flush = () => {
		pendingWrites.forEach((value, key) => {
			try {
				localStorage.setItem(key, value);
			} catch (err) {
				console.error('localStorage write failed:', key, err);
			}
		});
		pendingWrites.clear();
		timeoutId = null;
	};

	return {
		set: (key, value) => {
			pendingWrites.set(key, String(value));
			if (!timeoutId) timeoutId = setTimeout(flush, 100);
		},
		flush,
	};
})();

const FORMAT_LABELS = {
	hosts: 'hosts 0.0.0.0',
	localhost: 'localhost',
	adguard: 'AdGuard',
	dnsmasq: 'Dnsmasq',
	noip: 'No-IP',
	rpz: 'RPZ',
	unbound: 'Unbound',
};

const FORMAT_LABELS_SHORT = {
	hosts: '0.0.0.0',
	localhost: '127.0.0.1',
	adguard: 'AdGuard',
	dnsmasq: 'Dnsmasq',
	noip: 'No-IP',
	rpz: 'RPZ',
	unbound: 'Unbound',
};
const TIME_RANGE_DEFAULTS = { days: 30, interval: 60 };
let currentInterval = TIME_RANGE_DEFAULTS.interval;

const FONT_FAMILY = '\'Cascadia Mono\', \'Calibri\', sans-serif';

const COLORS = {
	primary: '#0088cc',
	orange: '#ff6b35',
	purple: '#9b59b6',
	green: '#27ae60',
	yellow: '#f39c12',
	red: '#e74c3c',
	teal: '#16a085',
};

const CHART_COLORS = [COLORS.primary, COLORS.green, COLORS.purple, COLORS.orange, COLORS.yellow, COLORS.teal, COLORS.red];

const UI_COLORS = {
	tooltipBg: 'rgba(0, 0, 0, 0.9)',
	tooltipTitle: '#00a8fc',
	tooltipBody: '#fff',
	tooltipBorder: 'rgba(0, 168, 252, 0.5)',
	tooltipFooter: 'rgba(255, 255, 255, 0.6)',
	textPrimary: 'rgba(255, 255, 255, 0.9)',
	textSecondary: 'rgba(255, 255, 255, 0.8)',
	gridLines: 'rgba(255, 255, 255, 0.08)',
	legendText: '#fff',
	borderLight: '#fff',
};

const HEATMAP_COLORS = {
	empty: 'rgba(255, 255, 255, 0.05)',
	low: '39, 174, 96',
	medium: '243, 156, 18',
	high: '230, 126, 34',
	veryHigh: '231, 76, 60',
};

const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));

let loadingElement, loadingKbElement;
const showLoading = () => {
	loadingKbElement.textContent = 'Downloading data...';
	loadingElement.style.display = 'flex';
};
const hideLoading = () => { loadingElement.style.display = 'none'; };

const formatBytes = bytes => {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const elementCache = new Map();
const updateElement = (id, value) => {
	let el = elementCache.get(id);
	if (!el) {
		el = document.getElementById(id);
		if (!el) return;
		elementCache.set(id, el);
	}
	el.textContent = value;
};

const clientLanguage = navigator.language || 'en-US';

const localTimeOptions = {
	...dateShortOptions,
	timeZone: undefined,
	second: '2-digit',
};

const utcTimeOptions = { ...dateShortOptions, second: '2-digit' };

const formatTimeUTC = date => date.toLocaleString(clientLanguage, utcTimeOptions);
const formatTimeLocal = date => date.toLocaleString(clientLanguage, localTimeOptions);

const updateServerTimeOffset = serverTime => {
	if (serverTime) {
		const serverDate = new Date(serverTime);
		const clientDate = new Date();
		serverTimeOffset = serverDate.getTime() - clientDate.getTime();
	}
};

const updateClocks = () => {
	const now = new Date();
	updateElement('client-time', formatTimeLocal(now));

	const serverTime = new Date(now.getTime() + serverTimeOffset);
	updateElement('server-time', formatTimeUTC(serverTime));
};

const addUTCFooter = callbacks => ({
	...callbacks,
	footer: callbacks.footer
		? ctx => {
			const customFooter = callbacks.footer(ctx);
			return customFooter ? `${customFooter}\nTime: UTC` : 'Time: UTC';
		}
		: () => 'Time: UTC',
});

const getTooltipConfig = (callbacks = {}) => ({
	enabled: true,
	backgroundColor: UI_COLORS.tooltipBg,
	titleColor: UI_COLORS.tooltipTitle,
	bodyColor: UI_COLORS.tooltipBody,
	borderColor: UI_COLORS.tooltipBorder,
	borderWidth: 1,
	padding: 12,
	displayColors: true,
	titleFont: {
		family: FONT_FAMILY,
		size: 14,
		weight: '600',
	},
	bodyFont: {
		family: FONT_FAMILY,
		size: 13,
	},
	footerFont: {
		family: FONT_FAMILY,
		size: 11,
	},
	footerColor: UI_COLORS.tooltipFooter,
	cornerRadius: 8,
	caretSize: 6,
	callbacks,
});

const getCommonChartOptions = (showLegend = true) => ({
	responsive: true,
	maintainAspectRatio: true,
	interaction: {
		mode: 'nearest',
		intersect: false,
	},
	animation: {
		duration: 750,
		easing: 'easeInOutQuart',
	},
	plugins: {
		legend: {
			display: showLegend,
			labels: {
				color: UI_COLORS.legendText,
				font: { family: FONT_FAMILY, size: 13, weight: '500' },
				padding: 15,
				usePointStyle: true,
				pointStyle: 'circle',
			},
		},
		tooltip: getTooltipConfig(),
	},
	scales: {
		x: {
			ticks: {
				color: UI_COLORS.textSecondary,
				font: { family: FONT_FAMILY, size: 12 },
			},
			grid: {
				color: UI_COLORS.gridLines,
				lineWidth: 1,
				drawBorder: false,
			},
		},
		y: {
			beginAtZero: true,
			ticks: {
				color: UI_COLORS.textSecondary,
				font: { family: FONT_FAMILY, size: 12 },
				callback: value => value.toLocaleString(),
			},
			grid: {
				color: UI_COLORS.gridLines,
				lineWidth: 1,
				drawBorder: false,
			},
		},
	},
});

const calculateSuccessRate = (responses, total) => {
	if (!total) return '0.00';
	const successCount = SUCCESS_CODES.reduce((sum, code) => sum + (responses[code] || 0), 0);
	return ((successCount / total) * 100).toFixed(2);
};

const getMinInterval = days => {
	const effectiveDays = days === 'max' ? dataAvailableDays : days;
	if (effectiveDays > 30) return 1440;
	if (effectiveDays > 14) return 60;
	if (effectiveDays > 5) return 10;
	return 1;
};

let dateFromInputCached, dateToInputCached;
let intervalButtonsCached, quickButtonsCached;

const initDOMCache = () => {
	loadingElement = document.getElementById('loading');
	loadingKbElement = document.getElementById('loading-kb');
	dateFromInputCached = document.getElementById('date-from');
	dateToInputCached = document.getElementById('date-to');
	intervalButtonsCached = document.querySelectorAll('.btn-interval');
	quickButtonsCached = document.querySelectorAll('.btn-quick');
};

const debounce = (fn, delay) => {
	let timeoutId;
	return (...args) => {
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => fn(...args), delay);
	};
};

const updateDateInputLimits = createdAt => {
	const today = new Date();
	const todayStr = memoizedFormatToYYYYMMDD(today);

	let minDate;
	if (createdAt) {
		const createdDate = new Date(createdAt);
		minDate = memoizedFormatToYYYYMMDD(createdDate);
	} else if (dataStartDate) {
		minDate = memoizedFormatToYYYYMMDD(dataStartDate);
	} else {
		return;
	}

	if (dateFromInputCached) {
		dateFromInputCached.setAttribute('min', minDate);
		dateFromInputCached.setAttribute('max', todayStr);
	}

	if (dateToInputCached) {
		dateToInputCached.setAttribute('min', minDate);
		dateToInputCached.setAttribute('max', todayStr);
	}
};

const updateDayButtons = () => {
	quickButtonsCached.forEach(btn => {
		const daysValue = btn.dataset.days;
		const requiredDays = daysValue === 'max' ? 0 : parseInt(daysValue);
		const isDisabled = requiredDays > dataAvailableDays;

		btn.disabled = isDisabled;
		btn.style.opacity = isDisabled ? '0.4' : '1';
		btn.style.cursor = isDisabled ? 'not-allowed' : 'pointer';
	});
};

const loadAllTimeStats = async () => {
	try {
		const response = await fetch('/api/v1/stats/alltime');
		if (!response.ok) throw new Error('Failed to fetch all-time stats');

		const { data: stats } = await response.json();

		updateServerTimeOffset(stats.serverTime);

		updateElement('alltime-total', (stats.total || 0).toLocaleString());
		updateElement('alltime-blocklists', (stats.blocklists || 0).toLocaleString());

		const categories = stats.categories || {};
		const topCategory = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];
		const topCategoryName = topCategory ? (FORMAT_LABELS[topCategory[0]] || topCategory[0].toUpperCase()) : 'N/A';
		updateElement('alltime-top-category', topCategoryName);

		let daysSinceStart = 0;
		if (stats.createdAt) {
			const createdDate = new Date(stats.createdAt);
			dataStartDate = createdDate;
			const now = new Date();
			daysSinceStart = Math.max(0, Math.floor((now - createdDate) / (1000 * 60 * 60 * 24)));
			dataAvailableDays = daysSinceStart;
			updateElement('alltime-created', formatDateShort(stats.createdAt));
		}

		const avgPerDay = daysSinceStart > 0 ? Math.floor(stats.total / daysSinceStart) : 0;
		updateElement('alltime-avg', avgPerDay.toLocaleString());

		const successRate = calculateSuccessRate(stats.responses || {}, stats.total);
		updateElement('alltime-success-rate', `${successRate}%`);

		if (stats.updatedAt) updateElement('alltime-updated', formatDateShort(stats.updatedAt));

		updateDayButtons();
		updateDateInputLimits(stats.createdAt);
	} catch (err) {
		console.error('Error loading all-time stats:', err);
	}
};

const setDefaultDates = () => {
	const today = new Date();
	const defaultFrom = new Date(today);
	defaultFrom.setDate(today.getDate() - TIME_RANGE_DEFAULTS.days);

	if (dateFromInputCached) dateFromInputCached.value = memoizedFormatToYYYYMMDD(defaultFrom);
	if (dateToInputCached) dateToInputCached.value = memoizedFormatToYYYYMMDD(today);
};

const fetchMetrics = async (from, to) => {
	try {
		showLoading();

		const response = await fetch(`/api/v1/stats/minute?from=${from}&to=${to}&interval=${currentInterval}`);
		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(errorData.message || 'Failed to fetch metrics');
		}

		const reader = response.body.getReader();
		const chunks = [];
		let received = 0;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			received += value.length;
			loadingKbElement.textContent = `Downloading data... ${formatBytes(received)}`;
		}

		const buffer = new Uint8Array(received);
		let offset = 0;
		for (const chunk of chunks) {
			buffer.set(chunk, offset);
			offset += chunk.length;
		}

		const data = JSON.parse(new TextDecoder().decode(buffer));
		updateServerTimeOffset(data.serverTime);
		return data.data || [];
	} catch (err) {
		console.error('Error fetching metrics:', err);
		alert(err.message || 'Failed to load metrics. Please try again.');
		return [];
	} finally {
		hideLoading();
	}
};

const aggregateData = data => {
	let totalRequests = 0;
	let totalBlocklists = 0;
	let successCount = 0;
	let errorCount = 0;
	const responses = {};
	const categories = {};
	const hourlyData = {};
	const uniqueDates = new Set();
	let minTimestamp = Infinity;
	let maxTimestamp = -Infinity;

	const peakTracker = [
		{ time: '', count: 0 },
		{ time: '', count: 0 },
		{ time: '', count: 0 },
	];

	for (const item of data) {
		const itemTotal = item.total || 0;
		totalRequests += itemTotal;
		totalBlocklists += item.blocklists || 0;
		uniqueDates.add(item.date);

		const timestamp = new Date(item.timestamp).getTime();
		if (timestamp < minTimestamp) minTimestamp = timestamp;
		if (timestamp > maxTimestamp) maxTimestamp = timestamp;

		const intervalTime = `${item.date} ${item.time}`;
		if (itemTotal > peakTracker[2].count) {
			if (itemTotal > peakTracker[0].count) {
				peakTracker[2] = peakTracker[1];
				peakTracker[1] = peakTracker[0];
				peakTracker[0] = { time: intervalTime, count: itemTotal };
			} else if (itemTotal > peakTracker[1].count) {
				peakTracker[2] = peakTracker[1];
				peakTracker[1] = { time: intervalTime, count: itemTotal };
			} else {
				peakTracker[2] = { time: intervalTime, count: itemTotal };
			}
		}

		if (item.responses) {
			for (const [code, count] of Object.entries(item.responses)) {
				responses[code] = (responses[code] || 0) + count;
				if (SUCCESS_CODES.includes(code)) {
					successCount += count;
				} else if (ERROR_CODES.includes(code)) {
					errorCount += count;
				}
			}
		}

		if (item.categories) {
			for (const [cat, count] of Object.entries(item.categories)) {
				if (count > 0) categories[cat] = (categories[cat] || 0) + count;
			}
		}

		const hour = item.time.split(':')[0];
		hourlyData[hour] = (hourlyData[hour] || 0) + itemTotal;
	}

	const top3Peaks = peakTracker.filter(p => p.count > 0);

	const successRate = totalRequests > 0 ? ((successCount / totalRequests) * 100).toFixed(2) : '0.00';
	const errorRate = totalRequests > 0 ? ((errorCount / totalRequests) * 100).toFixed(2) : '0.00';

	const timeRangeHours = data.length > 0 && minTimestamp !== Infinity ? (maxTimestamp - minTimestamp) / (1000 * 60 * 60) : 0;
	const avgPerHour = timeRangeHours > 0 ? Math.floor(totalRequests / timeRangeHours) : 0;
	const avgPerDay = uniqueDates.size > 0 ? Math.floor(totalRequests / uniqueDates.size) : 0;
	const blocklistShare = totalRequests > 0 ? ((totalBlocklists / totalRequests) * 100).toFixed(2) : '0.00';

	let topCategory = 'N/A';
	let maxCategoryCount = 0;
	for (const [cat, count] of Object.entries(categories)) {
		if (count > maxCategoryCount) {
			maxCategoryCount = count;
			topCategory = cat;
		}
	}

	return {
		totalRequests,
		totalBlocklists,
		successRate,
		errorRate,
		top3Peaks,
		responses,
		categories,
		hourlyData,
		avgPerHour,
		avgPerDay,
		blocklistShare,
		uniqueDays: uniqueDates.size,
		topCategory,
	};
};

const updateSummary = aggregated => {
	updateElement('total-requests', aggregated.totalRequests.toLocaleString());
	updateElement('blocklist-requests', aggregated.totalBlocklists.toLocaleString());

	const topFormat = aggregated.topCategory;
	const topFormatCount = topFormat !== 'N/A' ? (aggregated.categories[topFormat] || 0) : 0;
	const topFormatName = topFormat !== 'N/A' ? (FORMAT_LABELS[topFormat] || topFormat.toUpperCase()) : 'N/A';

	updateElement('period-top-category', topFormatName);
	updateElement('top-format-title', topFormatName);
	updateElement('top-format-downloads', topFormatCount.toLocaleString());
	updateElement('top-format-label', 'Most downloaded');

	updateElement('success-rate', `${aggregated.successRate}%`);
	updateElement('error-rate', `${aggregated.errorRate}%`);
	updateElement('avg-per-hour', aggregated.avgPerHour.toLocaleString());
	updateElement('avg-per-day', aggregated.avgPerDay.toLocaleString());
	updateElement('blocklist-share', `${aggregated.blocklistShare}%`);
	updateElement('unique-days', aggregated.uniqueDays);

	const peakTimesContainer = document.getElementById('peak-times');
	if (peakTimesContainer) {
		if (aggregated.top3Peaks.length > 0) {
			peakTimesContainer.innerHTML = aggregated.top3Peaks
				.map((peak, index) => {
					const medal = ['🥇', '🥈', '🥉'][index];
					return `<span class="peak-item">${medal} ${peak.time} - ${peak.count.toLocaleString()} requests</span>`;
				})
				.join('');
		} else {
			peakTimesContainer.innerHTML = '<span class="peak-item">N/A</span>';
		}
	}
};

const createRequestsChart = data => {
	const ctx = document.getElementById('requests-chart')?.getContext('2d');
	if (!ctx) return;

	const labels = data.map(d => `${d.date} ${d.time}`);

	const options = getCommonChartOptions();
	options.scales.x.ticks.maxTicksLimit = 20;
	options.scales.x.ticks.autoSkip = true;
	options.interaction = { mode: 'index', intersect: false };
	options.plugins.tooltip.callbacks = addUTCFooter({
		title: tooltipCtx => tooltipCtx[0].label,
		label: tooltipCtx => `${tooltipCtx.dataset.label}: ${tooltipCtx.parsed.y.toLocaleString()} requests`,
	});

	if (charts.requests) {
		charts.requests.data.labels = labels;
		charts.requests.data.datasets[0].data = data.map(d => d.total || 0);
		charts.requests.data.datasets[1].data = data.map(d => d.blocklists || 0);
		charts.requests.update('none');
	} else {
		charts.requests = new Chart(ctx, {
			type: 'line',
			data: {
				labels,
				datasets: [
					{
						label: 'Total Requests',
						data: data.map(d => d.total || 0),
						borderColor: COLORS.primary,
						backgroundColor: COLORS.primary + '20',
						borderWidth: 2,
						fill: false,
						tension: 0.4,
						pointRadius: 0,
						pointBackgroundColor: COLORS.primary,
						pointBorderColor: COLORS.primary,
						pointHoverRadius: 5,
						pointHoverBackgroundColor: COLORS.primary,
						pointHoverBorderColor: COLORS.primary,
						pointHoverBorderWidth: 2,
						pointBorderWidth: 1,
					},
					{
						label: 'Blocklist Requests',
						data: data.map(d => d.blocklists || 0),
						borderColor: COLORS.purple,
						backgroundColor: COLORS.purple + '20',
						borderWidth: 2,
						fill: false,
						tension: 0.4,
						pointRadius: 0,
						pointBackgroundColor: COLORS.purple,
						pointBorderColor: COLORS.purple,
						pointHoverRadius: 5,
						pointHoverBackgroundColor: COLORS.purple,
						pointHoverBorderColor: COLORS.purple,
						pointHoverBorderWidth: 2,
						pointBorderWidth: 1,
					},
				],
			},
			options,
		});
	}
};

const getHttpCodeColor = code => {
	const codeNum = parseInt(code);
	if (codeNum >= 200 && codeNum < 300) return COLORS.green;
	if (codeNum >= 300 && codeNum < 400) return COLORS.primary;
	if (codeNum >= 400 && codeNum < 500) return COLORS.orange;
	if (codeNum >= 500 && codeNum < 600) return COLORS.red;
	return COLORS.purple;
};

const createResponsesChart = responses => {
	const ctx = document.getElementById('responses-chart')?.getContext('2d');
	if (!ctx) return;

	const total = Object.values(responses).reduce((sum, val) => sum + val, 0);
	if (total === 0) return;

	const codes = Object.keys(responses);
	const colorValues = codes.map(getHttpCodeColor);

	if (charts.responses) {
		charts.responses.data.labels = codes;
		charts.responses.data.datasets[0].data = Object.values(responses);
		charts.responses.data.datasets[0].backgroundColor = colorValues;
		charts.responses.data.datasets[0].hoverBackgroundColor = colorValues.map(c => c + 'dd');
		charts.responses.data.datasets[0].borderColor = colorValues.map(c => c + 'aa');
		charts.responses.data.datasets[0].hoverBorderColor = colorValues;
		charts.responses.update('none');
		return;
	}

	charts.responses = new Chart(ctx, {
		type: 'doughnut',
		data: {
			labels: codes,
			datasets: [{
				data: Object.values(responses),
				backgroundColor: colorValues,
				hoverBackgroundColor: colorValues.map(c => c + 'dd'),
				borderWidth: 0,
				borderColor: colorValues.map(c => c + 'aa'),
				hoverBorderColor: colorValues,
				hoverBorderWidth: 2,
			}],
		},
		options: {
			responsive: true,
			maintainAspectRatio: true,
			animation: {
				animateRotate: true,
				animateScale: true,
				duration: 1000,
				easing: 'easeInOutQuart',
			},
			plugins: {
				legend: {
					display: true,
					position: 'right',
					labels: {
						color: UI_COLORS.legendText,
						font: { family: FONT_FAMILY, size: 13, weight: '500' },
						padding: 15,
						usePointStyle: true,
						pointStyle: 'circle',
					},
				},
				tooltip: getTooltipConfig({
					label: tooltipCtx => {
						const value = tooltipCtx.parsed;
						const percentage = ((value / total) * 100).toFixed(2);
						return `HTTP ${tooltipCtx.label}: ${value.toLocaleString()} (${percentage}%)`;
					},
				}),
			},
		},
	});
};

const createCategoriesChart = categories => {
	const ctx = document.getElementById('categories-chart')?.getContext('2d');
	if (!ctx) return;

	if (charts.categories) {
		charts.categories.data.labels = Object.keys(categories).map(key => FORMAT_LABELS_SHORT[key] || key.toUpperCase());
		charts.categories.data.datasets[0].data = Object.values(categories);
		charts.categories.update('none');
		return;
	}

	const options = getCommonChartOptions(false);
	options.plugins.tooltip.callbacks = addUTCFooter({
		title: tooltipCtx => tooltipCtx[0].label,
		label: tooltipCtx => `Downloads: ${tooltipCtx.parsed.y.toLocaleString()}`,
	});
	options.scales.x.title = {
		display: true,
		text: 'Format',
		color: UI_COLORS.textPrimary,
		font: { family: FONT_FAMILY, size: 13, weight: '600' },
	};

	charts.categories = new Chart(ctx, {
		type: 'bar',
		data: {
			labels: Object.keys(categories).map(key => FORMAT_LABELS_SHORT[key] || key.toUpperCase()),
			datasets: [{
				label: 'Downloads',
				data: Object.values(categories),
				backgroundColor: COLORS.green,
				hoverBackgroundColor: COLORS.green,
				borderWidth: 0,
				borderRadius: {
					topLeft: 6,
					topRight: 6,
					bottomLeft: 0,
					bottomRight: 0,
				},
				borderSkipped: 'bottom',
			}],
		},
		options,
	});
};

const createHourlyChart = (hourlyData, dateRange) => {
	const ctx = document.getElementById('hourly-chart')?.getContext('2d');
	if (!ctx) return;

	if (charts.hourly) {
		charts.hourly.data.datasets[0].data = HOURS_24.map(h => hourlyData[h] || 0);
		charts.hourly.update('none');
		return;
	}

	const options = getCommonChartOptions(false);
	options.plugins.tooltip.callbacks = addUTCFooter({
		title: tooltipCtx => tooltipCtx[0].label,
		label: tooltipCtx => `Requests: ${tooltipCtx.parsed.y.toLocaleString()}`,
		afterLabel: () => `Range: ${dateRange.from} → ${dateRange.to}`,
	});
	options.scales.x.title = {
		display: true,
		text: 'Hour of Day',
		color: UI_COLORS.textPrimary,
		font: { family: FONT_FAMILY, size: 13, weight: '600' },
	};

	charts.hourly = new Chart(ctx, {
		type: 'bar',
		data: {
			labels: HOURS_24.map(h => `${h}:00`),
			datasets: [{
				label: 'Requests',
				data: HOURS_24.map(h => hourlyData[h] || 0),
				backgroundColor: COLORS.teal,
				hoverBackgroundColor: COLORS.teal,
				borderWidth: 0,
				borderRadius: {
					topLeft: 6,
					topRight: 6,
					bottomLeft: 0,
					bottomRight: 0,
				},
				borderSkipped: 'bottom',
			}],
		},
		options,
	});
};

const createDailyChart = data => {
	const ctx = document.getElementById('daily-chart')?.getContext('2d');
	if (!ctx) return;

	const dailyData = {};
	for (const item of data) {
		if (!dailyData[item.date]) dailyData[item.date] = { total: 0, blocklists: 0 };
		dailyData[item.date].total += item.total || 0;
		dailyData[item.date].blocklists += item.blocklists || 0;
	}

	const dates = Object.keys(dailyData).sort();

	if (charts.daily) {
		charts.daily.data.labels = dates;
		charts.daily.data.datasets[0].data = dates.map(d => dailyData[d].total);
		charts.daily.data.datasets[1].data = dates.map(d => dailyData[d].blocklists);
		charts.daily.update('none');
		return;
	}

	const options = getCommonChartOptions();
	options.plugins.tooltip.callbacks = addUTCFooter({
		title: tooltipCtx => tooltipCtx[0].label,
		label: tooltipCtx => `${tooltipCtx.dataset.label}: ${tooltipCtx.parsed.y.toLocaleString()}`,
	});

	charts.daily = new Chart(ctx, {
		type: 'bar',
		data: {
			labels: dates,
			datasets: [
				{
					label: 'Total Requests',
					data: dates.map(d => dailyData[d].total),
					backgroundColor: COLORS.primary,
					hoverBackgroundColor: COLORS.primary,
					borderWidth: 0,
					borderRadius: {
						topLeft: 6,
						topRight: 6,
						bottomLeft: 0,
						bottomRight: 0,
					},
					borderSkipped: 'bottom',
				},
				{
					label: 'Blocklist Downloads',
					data: dates.map(d => dailyData[d].blocklists),
					backgroundColor: COLORS.purple,
					hoverBackgroundColor: COLORS.purple,
					borderWidth: 0,
					borderRadius: {
						topLeft: 6,
						topRight: 6,
						bottomLeft: 0,
						bottomRight: 0,
					},
					borderSkipped: 'bottom',
				},
			],
		},
		options,
	});
};

const createPeakHoursChart = data => {
	const ctx = document.getElementById('peak-hours-chart')?.getContext('2d');
	if (!ctx) return;

	const hourlyData = {};
	for (const item of data) {
		const hour = item.time.split(':')[0];
		const key = `${item.date} ${hour}:00`;
		hourlyData[key] = (hourlyData[key] || 0) + (item.total || 0);
	}

	const sorted = Object.entries(hourlyData)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10);

	if (charts.peakHours) {
		charts.peakHours.data.labels = sorted.map(([key]) => key);
		charts.peakHours.data.datasets[0].data = sorted.map(([, val]) => val);
		charts.peakHours.update('none');
		return;
	}

	const options = getCommonChartOptions(false);
	options.indexAxis = 'y';
	options.plugins.tooltip.callbacks = addUTCFooter({
		title: tooltipCtx => tooltipCtx[0].label,
		label: tooltipCtx => `Peak: ${tooltipCtx.parsed.x.toLocaleString()} requests`,
	});
	options.scales.x.title = {
		display: true,
		text: 'Number of Requests',
		color: UI_COLORS.textPrimary,
		font: { family: FONT_FAMILY, size: 13, weight: '600' },
	};

	charts.peakHours = new Chart(ctx, {
		type: 'bar',
		data: {
			labels: sorted.map(([key]) => key),
			datasets: [{
				label: 'Requests',
				data: sorted.map(([, val]) => val),
				backgroundColor: COLORS.orange,
				hoverBackgroundColor: COLORS.orange,
				borderColor: COLORS.orange,
				borderWidth: 0,
				borderRadius: {
					topLeft: 0,
					topRight: 6,
					bottomLeft: 0,
					bottomRight: 6,
				},
				borderSkipped: 'left',
			}],
		},
		options,
	});
};

const createFormatDistributionChart = data => {
	const ctx = document.getElementById('format-distribution-chart')?.getContext('2d');
	if (!ctx) return;

	const labels = data.map(d => `${d.date} ${d.time}`);

	if (charts.formatDist) {
		charts.formatDist.data.labels = labels;
		Object.keys(FORMAT_LABELS_SHORT).forEach((key, idx) => {
			charts.formatDist.data.datasets[idx].data = data.map(d => d.categories?.[key] || 0);
		});
		charts.formatDist.update('none');
		return;
	}
	const datasets = Object.keys(FORMAT_LABELS_SHORT).map((key, idx) => {
		const color = CHART_COLORS[idx % CHART_COLORS.length];
		return {
			label: FORMAT_LABELS_SHORT[key],
			data: data.map(d => d.categories?.[key] || 0),
			borderColor: color,
			backgroundColor: color + '33',
			borderWidth: 2,
			fill: false,
			tension: 0.4,
			pointRadius: 0,
			pointBackgroundColor: color,
			pointBorderColor: color,
			pointHoverRadius: 6,
			pointHoverBackgroundColor: color,
			pointHoverBorderColor: UI_COLORS.borderLight,
			pointHoverBorderWidth: 2,
			pointBorderWidth: 1,
		};
	});

	const options = getCommonChartOptions();
	options.interaction = { mode: 'index', intersect: false };
	options.plugins.legend.position = 'bottom';
	options.plugins.tooltip.callbacks = addUTCFooter({
		title: tooltipCtx => tooltipCtx[0].label,
		label: tooltipCtx => `${tooltipCtx.dataset.label}: ${tooltipCtx.parsed.y.toLocaleString()} downloads`,
		afterBody: tooltipCtx => {
			const total = tooltipCtx.reduce((sum, item) => sum + item.parsed.y, 0);
			return `\nTotal: ${total.toLocaleString()} downloads`;
		},
	});
	options.scales.x.ticks.maxTicksLimit = 20;
	options.scales.x.ticks.autoSkip = true;

	charts.formatDist = new Chart(ctx, {
		type: 'line',
		data: { labels, datasets },
		options,
	});
};

const buildHeatmapMatrix = data => {
	const heatmapData = {};
	for (const item of data) {
		const hour = item.time.split(':')[0];
		if (!heatmapData[item.date]) heatmapData[item.date] = {};
		heatmapData[item.date][hour] = (heatmapData[item.date][hour] || 0) + (item.total || 0);
	}

	const dates = Object.keys(heatmapData).sort();
	const matrix = [];
	for (const date of dates) {
		for (const [hourIndex, hour] of HOURS_24.entries()) {
			matrix.push({ x: hourIndex, y: date, v: heatmapData[date]?.[hour] || 0, hour });
		}
	}

	return { dates, matrix };
};

const getHeatmapColor = (value, maxValue) => {
	if (value === 0 || maxValue === 0) return HEATMAP_COLORS.empty;
	const intensity = value / maxValue;
	if (intensity < 0.2) return `rgba(${HEATMAP_COLORS.low}, ${0.3 + intensity * 0.3})`;
	if (intensity < 0.5) return `rgba(${HEATMAP_COLORS.medium}, ${0.4 + intensity * 0.3})`;
	if (intensity < 0.8) return `rgba(${HEATMAP_COLORS.high}, ${0.5 + intensity * 0.3})`;
	return `rgba(${HEATMAP_COLORS.veryHigh}, ${0.6 + intensity * 0.4})`;
};

const createHeatmapChart = data => {
	const ctx = document.getElementById('heatmap-chart')?.getContext('2d');
	if (!ctx) return;

	const { dates, matrix } = buildHeatmapMatrix(data);
	const maxValue = Math.max(...matrix.map(d => d.v), 1);
	const colors = matrix.map(d => getHeatmapColor(d.v, maxValue));
	const chartData = matrix.map(d => ({
		x: d.x,
		y: dates.indexOf(d.y),
		r: maxValue > 0 ? Math.sqrt(d.v / maxValue) * 15 + 3 : 3,
		value: d.v,
		hour: d.hour,
		date: d.y,
	}));

	if (charts.heatmap) {
		charts.heatmap.data.datasets[0].data = chartData;
		charts.heatmap.data.datasets[0].backgroundColor = colors;
		charts.heatmap.data.datasets[0].borderColor = colors;
		charts.heatmap.options.scales.y.max = dates.length - 0.5;
		charts.heatmap.options.scales.y.ticks.callback = value => dates[value] || '';
		charts.heatmap.update('none');
		return;
	}

	charts.heatmap = new Chart(ctx, {
		type: 'bubble',
		data: {
			datasets: [{
				label: 'Traffic Intensity',
				data: chartData,
				backgroundColor: colors,
				borderColor: colors,
			}],
		},
		options: {
			responsive: true,
			maintainAspectRatio: true,
			plugins: {
				legend: { display: false },
				tooltip: getTooltipConfig({
					title: tooltipCtx => `${tooltipCtx[0].raw.date} ${tooltipCtx[0].raw.hour}:00`,
					label: tooltipCtx => `Requests: ${tooltipCtx.raw.value.toLocaleString()}`,
					footer: () => 'Time: UTC',
				}),
			},
			scales: {
				x: {
					type: 'linear',
					min: -0.5,
					max: 23.5,
					ticks: {
						stepSize: 1,
						callback: value => {
							const hour = HOURS_24[Math.round(value)];
							return hour ? `${hour}:00` : '';
						},
						color: UI_COLORS.textSecondary,
						font: { family: FONT_FAMILY, size: 11 },
					},
					grid: { color: UI_COLORS.gridLines, lineWidth: 1 },
					title: {
						display: true,
						text: 'Hour of Day (UTC)',
						color: UI_COLORS.textPrimary,
						font: { family: FONT_FAMILY, size: 13, weight: '600' },
					},
				},
				y: {
					type: 'linear',
					min: -0.5,
					max: dates.length - 0.5,
					reverse: true,
					ticks: {
						stepSize: 1,
						callback: value => dates[value] || '',
						color: UI_COLORS.textSecondary,
						font: { family: FONT_FAMILY, size: 11 },
					},
					grid: { color: UI_COLORS.gridLines, lineWidth: 1 },
					title: {
						display: true,
						text: 'Date',
						color: UI_COLORS.textPrimary,
						font: { family: FONT_FAMILY, size: 13, weight: '600' },
					},
				},
			},
		},
	});
};

const loadData = async () => {
	const from = dateFromInputCached.value;
	const to = dateToInputCached.value;
	if (!from || !to) {
		alert('Please select both start and end dates');
		return;
	}

	const fromDate = new Date(from + 'T00:00:00');
	const toDate = new Date(to + 'T00:00:00');
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	if (fromDate > toDate) {
		alert('Start date cannot be after end date');
		return;
	}

	if (toDate > today) {
		alert('End date cannot be in the future');
		return;
	}

	const daysDiff = Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24));
	const minInterval = getMinInterval(daysDiff);
	if (currentInterval < minInterval) {
		alert(`For ${daysDiff} days range, minimum interval is ${minInterval >= 60 ? `${minInterval / 60}h` : `${minInterval}m`}. Please select a larger interval.`);
		return;
	}

	const data = await fetchMetrics(from, to);
	if (!data.length) {
		alert('No data available for selected date range');
		return;
	}

	const aggregated = aggregateData(data);
	updateSummary(aggregated);

	createRequestsChart(data);
	createResponsesChart(aggregated.responses);
	createCategoriesChart(aggregated.categories);
	createHourlyChart(aggregated.hourlyData, { from, to });
	createDailyChart(data);
	createPeakHoursChart(data);
	createHeatmapChart(data);
	createFormatDistributionChart(data);
};

const updateIntervalButtons = days => {
	const minInterval = getMinInterval(days);
	const needsActiveUpdate = currentInterval < minInterval;
	let activeSet = false;

	intervalButtonsCached.forEach(btn => {
		const interval = parseInt(btn.dataset.interval);
		const isDisabled = interval < minInterval;

		btn.disabled = isDisabled;
		btn.style.opacity = isDisabled ? '0.4' : '1';
		btn.style.cursor = isDisabled ? 'not-allowed' : 'pointer';

		if (needsActiveUpdate && !activeSet && interval === minInterval) {
			intervalButtonsCached.forEach(b => b.classList.remove('active'));
			btn.classList.add('active');
			currentInterval = minInterval;
			localStorageBatcher.set('metrics_interval', currentInterval);
			activeSet = true;
		}
	});
};

const loadQuickData = async days => {
	const to = new Date();
	let from;
	if (days === 'max' && dataStartDate) {
		from = new Date(dataStartDate);
	} else if (days === 'max') {
		console.warn('Cannot load MAX range: dataStartDate not available');
		return;
	} else {
		from = new Date(to);
		from.setDate(to.getDate() - days);
	}

	if (dateFromInputCached) dateFromInputCached.value = memoizedFormatToYYYYMMDD(from);
	if (dateToInputCached) dateToInputCached.value = memoizedFormatToYYYYMMDD(to);

	updateIntervalButtons(days);
	await loadData();
};

const updateIntervalsForCustomRange = () => {
	const from = dateFromInputCached.value;
	if (from) dateToInputCached.setAttribute('min', from);

	const to = dateToInputCached.value;
	if (!from || !to) return;

	const fromDate = new Date(from + 'T00:00:00');
	const toDate = new Date(to + 'T00:00:00');
	if (fromDate > toDate) {
		dateToInputCached.value = from;
		return;
	}

	const daysDiff = Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24));
	updateIntervalButtons(daysDiff);
};

const initializeEventListeners = () => {
	const debouncedUpdate = debounce(updateIntervalsForCustomRange, 300);
	if (dateFromInputCached) dateFromInputCached.addEventListener('change', debouncedUpdate);
	if (dateToInputCached) dateToInputCached.addEventListener('change', debouncedUpdate);

	const loadDataBtn = document.getElementById('load-data');
	if (loadDataBtn) {
		loadDataBtn.addEventListener('click', () => {
			quickButtonsCached.forEach(btn => btn.classList.remove('active'));
			void loadData();
		});
	}
};

const initializeButtonListeners = () => {
	quickButtonsCached.forEach(btn => {
		btn.addEventListener('click', async e => {
			if (e.target.disabled) return;

			quickButtonsCached.forEach(b => b.classList.remove('active'));
			e.target.classList.add('active');

			const daysValue = e.target.dataset.days;
			const days = daysValue === 'max' ? 'max' : parseInt(daysValue);
			localStorageBatcher.set('metrics_days', days);
			await loadQuickData(days);
		});
	});

	intervalButtonsCached.forEach(btn => {
		btn.addEventListener('click', async e => {
			if (e.target.disabled) return;

			intervalButtonsCached.forEach(b => b.classList.remove('active'));
			e.target.classList.add('active');

			currentInterval = parseInt(e.target.dataset.interval) || 1;
			localStorageBatcher.set('metrics_interval', currentInterval);
			await loadData();
		});
	});
};

const initializeMetrics = () => {
	initDOMCache();

	const savedDaysRaw = localStorage.getItem('metrics_days');
	let savedDays = savedDaysRaw === 'max' ? 'max' : parseInt(savedDaysRaw);
	let savedInterval = parseInt(localStorage.getItem('metrics_interval'));
	if (!VALID_INTERVALS.includes(savedInterval)) {
		savedInterval = TIME_RANGE_DEFAULTS.interval;
		localStorageBatcher.set('metrics_interval', savedInterval);
	}

	if (savedDays !== 'max' && !VALID_DAYS.includes(savedDays)) {
		savedDays = TIME_RANGE_DEFAULTS.days;
		localStorageBatcher.set('metrics_days', savedDays);
	}

	quickButtonsCached.forEach(btn => {
		const btnDays = btn.dataset.days === 'max' ? 'max' : parseInt(btn.dataset.days);
		if (btnDays === savedDays) {
			btn.classList.add('active');
		} else {
			btn.classList.remove('active');
		}
	});

	intervalButtonsCached.forEach(btn => {
		if (parseInt(btn.dataset.interval) === savedInterval) {
			btn.classList.add('active');
		} else {
			btn.classList.remove('active');
		}
	});

	currentInterval = savedInterval;

	initializeEventListeners();
	initializeButtonListeners();
	setDefaultDates();
	updateIntervalButtons(savedDays);

	updateClocks();
	setInterval(updateClocks, 1000);

	loadAllTimeStats()
		.then(() => loadQuickData(savedDays))
		.catch(err => {
			console.error('Failed to initialize metrics:', err);
			hideLoading();
			alert('Failed to load metrics. Please refresh the page.');
		});
};

initializeMetrics();
