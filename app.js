const TECHNICAL_FLOOR = 243000;
const FULL_CAPACITY = 714000;
const DRAWDOWN_DEGRADATION_ONSET = 300000;
const FLOOR_CHART_PADDING = 0.05;
const EIA_API_KEY = '35d2c04d0a266f0cc2ca8ce655d4ee45';
const EIA_SERIES_ID = 'PET.WCSSTUS1.W';
const EIA_SOURCE_URL = 'https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=WCSSTUS1&f=W';
const EIA_API_URL = `https://api.eia.gov/v2/seriesid/${EIA_SERIES_ID}?api_key=${EIA_API_KEY}`;
const MAX_CHART_EXTENSION_DAYS = 150;
const CHART_PROJECTION_PADDING_DAYS = 30;
const MAX_X_LABELS = 6;
const MS_PER_DAY = 86400000;
const MS_PER_WEEK = MS_PER_DAY * 7;
const MAX_LEVEL_PROJECTION_WEEKS = 104;
const CHART_START = new Date('2026-03-01T00:00:00');
const REFILL_SPAN = FULL_CAPACITY - TECHNICAL_FLOOR;
const DRAWDOWN_SPAN = DRAWDOWN_DEGRADATION_ONSET - TECHNICAL_FLOOR;

const DRAWDOWN_BAND_RATIO = 0.26;
const DRAWDOWN_BAND_GAP = 8;

const CHART = {
    historical: '#1668dc',
    latestDot: '#1677ff',
    floor: '#f5222d',
    drawdownAccelerating: 'rgba(245, 34, 45, 0.62)',
    drawdownSteady: 'rgba(245, 34, 45, 0.38)',
    drawdownMild: 'rgba(245, 34, 45, 0.22)'
};

const PROJECTION_METHODS = [
    { id: 'recent8', label: '8W Endpoint', color: '#faad14', type: 'endpoint', weeks: 8 },
    { id: 'regression12', label: '12W Regression', color: '#9254de', type: 'regression', weeks: 12 },
    { id: 'avgWeekly', label: '8W Avg Delta', color: '#52c41a', type: 'avgDelta', weeks: 8 },
    { id: 'annual', label: '12M Regression', color: '#eb2f96', type: 'regression', weeks: null },
    { id: 'quadratic', label: 'Quadratic Trend', color: '#ff4d4f', type: 'quadratic', weeks: 12 },
    { id: 'levelRate', label: 'Level-Dependent Rate', color: '#597ef7', type: 'levelRate' },
    { id: 'weighted26', label: '26W Weighted Regression', color: '#f759ab', type: 'weightedRegression', weeks: 26, alpha: 0.2 }
];

window.addEventListener('DOMContentLoaded', loadEIAData);

async function loadEIAData() {
    const sources = [
        { url: EIA_API_URL },
        { url: `https://api.cors.syrins.tech/?url=${encodeURIComponent(EIA_API_URL)}` }
    ];

    for (const source of sources) {
        try {
            const response = await fetch(source.url);
            if (!response.ok) continue;
            parseEIAData(await response.json());
            return;
        } catch (error) {
            console.warn(`Fetch failed for ${source.url}:`, error);
        }
    }
}

function parseEIAData(payload) {
    const rows = payload?.response?.data;
    if (!Array.isArray(rows) || rows.length === 0) return;

    const parsedRecords = rows
        .map(row => ({
            date: new Date(`${row.period}T00:00:00`),
            value: Number(row.value)
        }))
        .filter(row => !isNaN(row.date.getTime()) && !isNaN(row.value));

    if (parsedRecords.length === 0) return;

    parsedRecords.sort((a, b) => a.date - b.date);
    applyChartData(parsedRecords);
}

const chartState = { chartData: null, projections: null };

function applyChartData(parsedRecords) {
    const chartData = parsedRecords.filter(item => item.date >= CHART_START);
    if (chartData.length === 0) return;

    const latestRecord = chartData[chartData.length - 1];
    const projections = computeProjections(parsedRecords);

    const fillPct = ((latestRecord.value / FULL_CAPACITY) * 100).toFixed(1);
    document.getElementById('stat-fill-pct').textContent = `${fillPct}% of 714M capacity`;

    document.getElementById('stat-current').textContent = formatVolume(latestRecord.value);
    updateSourceMeta(latestRecord.date);
    updateHeaderStats(projections, chartData);
    chartState.chartData = chartData;
    chartState.projections = projections;
    renderChart(chartData, projections);
}

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (chartState.chartData && chartState.projections) {
            renderChart(chartState.chartData, chartState.projections);
        }
    }, 150);
});

function getChartLayout() {
    const narrow = window.matchMedia('(max-width: 400px)').matches;
    const mobile = window.matchMedia('(max-width: 600px)').matches;
    const container = document.querySelector('.chart-viewport') || document.querySelector('.chart-panel');
    const containerWidth = container ? container.clientWidth : 800;
    const width = mobile ? Math.max(300, containerWidth) : 800;
    const height = mobile ? Math.round(width * 0.78) : 450;

    return {
        width,
        height,
        paddingLeft: narrow ? 40 : mobile ? 44 : 56,
        paddingRight: mobile ? 10 : 16,
        paddingTop: mobile ? 18 : 24,
        paddingBottom: mobile ? 36 : 48,
        maxXLabels: mobile ? 4 : MAX_X_LABELS,
        axisFontSize: narrow ? 9 : mobile ? 10 : 11,
        dotRadius: mobile ? 3 : 4,
        floorDotRadius: mobile ? 2.5 : 3
    };
}

function formatVolume(value) {
    return `${(value / 1000).toFixed(0)}M`;
}

function formatDate(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function toISODate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function updateSourceMeta(latestDate) {
    const sourceLink = document.getElementById('source-link');
    const updatedEl = document.getElementById('stat-updated');

    sourceLink.href = EIA_SOURCE_URL;
    updatedEl.dateTime = toISODate(latestDate);
    updatedEl.textContent = formatDate(latestDate);
}

function regressionSlope(points) {
    const n = points.length;
    if (n < 2) return null;

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    for (const point of points) {
        const x = point.date.getTime();
        const y = point.value;
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
    }

    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) return null;

    return (n * sumXY - sumX * sumY) / denominator;
}

function endpointSlope(points, weeks) {
    const latest = points[points.length - 1];
    const start = points[Math.max(0, points.length - weeks)];
    const elapsedMs = latest.date.getTime() - start.date.getTime();

    if (elapsedMs <= 0) return null;

    return (latest.value - start.value) / elapsedMs;
}

function averageWeeklySlope(points, weeks) {
    const slice = points.slice(-Math.min(weeks + 1, points.length));
    if (slice.length < 2) return null;

    let totalSlope = 0;
    let count = 0;

    for (let i = 1; i < slice.length; i++) {
        const elapsedMs = slice[i].date.getTime() - slice[i - 1].date.getTime();
        if (elapsedMs <= 0) continue;
        totalSlope += (slice[i].value - slice[i - 1].value) / elapsedMs;
        count++;
    }

    return count === 0 ? null : totalSlope / count;
}

function fitQuadratic(points) {
    const n = points.length;
    if (n < 3) return null;

    let sumX = 0;
    let sumX2 = 0;
    let sumX3 = 0;
    let sumX4 = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2Y = 0;
    const t0 = points[0].date.getTime();

    for (const point of points) {
        const x = (point.date.getTime() - t0) / MS_PER_DAY;
        const y = point.value;
        const x2 = x * x;

        sumX += x;
        sumX2 += x2;
        sumX3 += x2 * x;
        sumX4 += x2 * x2;
        sumY += y;
        sumXY += x * y;
        sumX2Y += x2 * y;
    }

    const det = n * (sumX2 * sumX4 - sumX3 * sumX3) - sumX * (sumX * sumX4 - sumX2 * sumX3) + sumX2 * (sumX * sumX3 - sumX2 * sumX2);
    if (det === 0) return null;

    const a = (sumY * (sumX2 * sumX4 - sumX3 * sumX3) - sumX * (sumXY * sumX4 - sumX3 * sumX2Y) + sumX2 * (sumXY * sumX3 - sumX2 * sumX2Y)) / det;
    const b = (n * (sumXY * sumX4 - sumX3 * sumX2Y) - sumY * (sumX * sumX4 - sumX2 * sumX3) + sumX2 * (sumX * sumX2Y - sumXY * sumX2)) / det;
    const c = (n * (sumX2 * sumX2Y - sumXY * sumX3) - sumX * (sumX * sumX2Y - sumXY * sumX2) + sumY * (sumX * sumX3 - sumX2 * sumX2)) / det;

    return { a, b, c, t0 };
}

function quadraticValueAt(coeffs, date) {
    const x = (date.getTime() - coeffs.t0) / MS_PER_DAY;
    return coeffs.a * x * x + coeffs.b * x + coeffs.c;
}

function quadraticSlopePerMs(coeffs, date) {
    const x = (date.getTime() - coeffs.t0) / MS_PER_DAY;
    return (2 * coeffs.a * x + coeffs.b) / MS_PER_DAY;
}

function findQuadraticFloorDays(coeffs, latest) {
    const xLatest = (latest.date.getTime() - coeffs.t0) / MS_PER_DAY;
    const a = coeffs.a;
    const b = coeffs.b;
    const c = coeffs.c - TECHNICAL_FLOOR;

    if (Math.abs(a) < 1e-12) {
        if (Math.abs(b) < 1e-12) return null;
        const x = -c / b;
        return x > xLatest ? x - xLatest : null;
    }

    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;

    const sqrtD = Math.sqrt(discriminant);
    const roots = [(-b - sqrtD) / (2 * a), (-b + sqrtD) / (2 * a)].filter(x => x > xLatest);
    if (roots.length === 0) return null;

    return Math.min(...roots) - xLatest;
}

function weightedRegressionSlope(points, alpha = 0.2) {
    if (points.length < 2) return null;

    let weightSum = 0;
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;

    for (let i = points.length - 1; i >= 0; i--) {
        const ageWeeks = (points[points.length - 1].date - points[i].date) / (MS_PER_DAY * 7);
        const weight = Math.pow(1 - alpha, ageWeeks);
        const x = points[i].date.getTime();
        const y = points[i].value;

        weightSum += weight;
        sumX += weight * x;
        sumY += weight * y;
        sumXX += weight * x * x;
        sumXY += weight * x * y;
    }

    const denominator = weightSum * sumXX - sumX * sumX;
    if (denominator === 0) return null;

    return (weightSum * sumXY - sumX * sumY) / denominator;
}

function calculateLevelRateProjection(points, drawdownModel, refillModel, regime) {
    const latest = points[points.length - 1];
    const empty = {
        declining: false,
        rising: false,
        daysUntilFloor: null,
        floorHitDate: null,
        daysUntilCapacity: null,
        capacityHitDate: null,
        simulatedPath: null,
        slopePerMs: 0,
        regime
    };

    const direction = regime === 'drawdown' ? 'drawdown' : regime === 'refill' ? 'refill' : null;
    if (!direction) return empty;

    const model = direction === 'drawdown' ? drawdownModel : refillModel;
    if (!model) return empty;

    if (direction === 'drawdown' && latest.value <= TECHNICAL_FLOOR) {
        return {
            ...empty,
            atOrBelowFloor: true,
            declining: true,
            daysUntilFloor: 0,
            floorHitDate: latest.date,
            slopePerMs: weeklyLevelRate(latest.value, model, direction) / MS_PER_WEEK
        };
    }

    if (direction === 'refill' && latest.value >= FULL_CAPACITY) {
        return {
            ...empty,
            atOrAboveCapacity: true,
            rising: true,
            daysUntilCapacity: 0,
            capacityHitDate: latest.date,
            slopePerMs: weeklyLevelRate(latest.value, model, direction) / MS_PER_WEEK
        };
    }

    const initialRate = weeklyLevelRate(latest.value, model, direction);
    if (initialRate === 0 || (direction === 'drawdown' && initialRate >= 0) || (direction === 'refill' && initialRate <= 0)) {
        return { ...empty, slopePerMs: initialRate / MS_PER_WEEK };
    }

    let weeks = 0;
    let simulatedValue = latest.value;
    const simulatedPath = [{ date: new Date(latest.date), value: simulatedValue }];

    while (weeks < MAX_LEVEL_PROJECTION_WEEKS) {
        const rate = weeklyLevelRate(simulatedValue, model, direction);
        if (Math.abs(rate) < 1e-6) break;

        weeks++;
        simulatedValue += rate;

        if (direction === 'drawdown') {
            simulatedValue = Math.max(TECHNICAL_FLOOR, simulatedValue);
        } else {
            simulatedValue = Math.min(FULL_CAPACITY, simulatedValue);
        }

        simulatedPath.push({
            date: new Date(latest.date.getTime() + weeks * MS_PER_WEEK),
            value: simulatedValue
        });

        if (direction === 'drawdown' ? simulatedValue <= TECHNICAL_FLOOR : simulatedValue >= FULL_CAPACITY) {
            break;
        }
    }

    const reached = direction === 'drawdown'
        ? simulatedValue <= TECHNICAL_FLOOR
        : simulatedValue >= FULL_CAPACITY;

    if (!reached) {
        return {
            ...empty,
            simulatedPath,
            slopePerMs: initialRate / MS_PER_WEEK
        };
    }

    const hitDate = new Date(latest.date.getTime() + weeks * MS_PER_WEEK);
    const daysUntil = weeks * 7;

    if (direction === 'drawdown') {
        return {
            ...empty,
            declining: true,
            daysUntilFloor: daysUntil,
            floorHitDate: hitDate,
            simulatedPath,
            slopePerMs: initialRate / MS_PER_WEEK
        };
    }

    return {
        ...empty,
        rising: true,
        daysUntilCapacity: daysUntil,
        capacityHitDate: hitDate,
        simulatedPath,
        slopePerMs: initialRate / MS_PER_WEEK
    };
}

function resolveSlope(method, dataPoints) {
    const windowPoints = method.weeks ? dataPoints.slice(-method.weeks) : dataPoints;
    if (windowPoints.length < 2) return null;

    if (method.type === 'endpoint') return endpointSlope(dataPoints, method.weeks);
    if (method.type === 'regression') return regressionSlope(windowPoints);
    if (method.type === 'avgDelta') return averageWeeklySlope(dataPoints, method.weeks);
    if (method.type === 'weightedRegression') return weightedRegressionSlope(windowPoints, method.alpha ?? 0.2);

    return null;
}

function buildProjection(method, dataPoints, context) {
    const latest = dataPoints[dataPoints.length - 1];
    const { regime, drawdownModel, refillModel } = context;
    const base = {
        ...method,
        declining: false,
        rising: false,
        atOrBelowFloor: false,
        atOrAboveCapacity: false,
        slopePerMs: 0,
        daysUntilFloor: null,
        floorHitDate: null,
        daysUntilCapacity: null,
        capacityHitDate: null,
        curveType: null,
        quadraticCoeffs: null,
        simulatedPath: null,
        regime
    };

    if (method.type === 'levelRate') {
        const levelRate = calculateLevelRateProjection(dataPoints, drawdownModel, refillModel, regime);
        return { ...base, ...levelRate, curveType: 'levelRate' };
    }

    if (latest.value <= TECHNICAL_FLOOR) {
        return { ...base, atOrBelowFloor: true, declining: true, daysUntilFloor: 0, floorHitDate: latest.date };
    }

    if (latest.value >= FULL_CAPACITY) {
        return { ...base, atOrAboveCapacity: true, rising: true, daysUntilCapacity: 0, capacityHitDate: latest.date };
    }

    if (method.type === 'quadratic') {
        const windowPoints = dataPoints.slice(-method.weeks);
        const coeffs = fitQuadratic(windowPoints);
        if (!coeffs) return base;

        const slopePerMs = quadraticSlopePerMs(coeffs, latest.date);
        const quadraticBase = { ...base, slopePerMs, quadraticCoeffs: coeffs, curveType: 'quadratic' };

        if (slopePerMs < 0) {
            const daysUntilFloor = findQuadraticFloorDays(coeffs, latest);
            if (daysUntilFloor === null) return quadraticBase;

            return {
                ...quadraticBase,
                declining: true,
                daysUntilFloor: Math.ceil(daysUntilFloor),
                floorHitDate: new Date(latest.date.getTime() + daysUntilFloor * MS_PER_DAY)
            };
        }

        if (slopePerMs > 0) {
            const msUntilCapacity = (FULL_CAPACITY - latest.value) / slopePerMs;
            return {
                ...quadraticBase,
                rising: true,
                daysUntilCapacity: Math.ceil(msUntilCapacity / MS_PER_DAY),
                capacityHitDate: new Date(latest.date.getTime() + msUntilCapacity)
            };
        }

        return quadraticBase;
    }

    const slopePerMs = resolveSlope(method, dataPoints);
    if (slopePerMs === null || slopePerMs === 0) {
        return { ...base, slopePerMs: slopePerMs || 0 };
    }

    if (slopePerMs > 0) {
        const msUntilCapacity = (FULL_CAPACITY - latest.value) / slopePerMs;
        return {
            ...base,
            rising: true,
            slopePerMs,
            daysUntilCapacity: Math.ceil(msUntilCapacity / MS_PER_DAY),
            capacityHitDate: new Date(latest.date.getTime() + msUntilCapacity)
        };
    }

    const msUntilFloor = (TECHNICAL_FLOOR - latest.value) / slopePerMs;

    return {
        ...base,
        declining: true,
        slopePerMs,
        daysUntilFloor: Math.ceil(msUntilFloor / MS_PER_DAY),
        floorHitDate: new Date(latest.date.getTime() + msUntilFloor)
    };
}

function computeProjections(dataPoints) {
    const regime = detectRegime(dataPoints);
    const changes = computeWeeklyChanges(dataPoints);
    const drawdownModel = fitLevelRateModel(changes, 'drawdown');
    const refillModel = fitLevelRateModel(changes, 'refill');
    const context = { regime, drawdownModel, refillModel };

    return PROJECTION_METHODS.map(method => buildProjection(method, dataPoints, context));
}

function getDisplayedProjections(projections, regime) {
    if (regime === 'drawdown') {
        return projections
            .filter(projection => projection.declining && projection.floorHitDate)
            .sort((a, b) => a.daysUntilFloor - b.daysUntilFloor);
    }

    if (regime === 'refill') {
        return projections
            .filter(projection => projection.rising && projection.capacityHitDate)
            .sort((a, b) => a.daysUntilCapacity - b.daysUntilCapacity);
    }

    return [];
}

function projectionHitDate(projection) {
    return projection.declining ? projection.floorHitDate : projection.capacityHitDate;
}

function projectionHitDays(projection) {
    return projection.declining ? projection.daysUntilFloor : projection.daysUntilCapacity;
}

function projectionHitValue(projection) {
    return projection.declining ? TECHNICAL_FLOOR : FULL_CAPACITY;
}

function projectedValue(latest, slopePerMs, date) {
    return latest.value + slopePerMs * (date.getTime() - latest.date.getTime());
}

function buildProjectionPath(projection, latestPoint, chartMaxTime, getX, getY) {
    if (projection.curveType === 'quadratic' && projection.quadraticCoeffs) {
        const hitDate = projectionHitDate(projection);
        const hitValue = projectionHitValue(projection);
        const endTime = hitDate
            ? Math.min(hitDate.getTime(), chartMaxTime)
            : chartMaxTime;
        const stepMs = MS_PER_DAY * 2;
        let path = `M ${getX(latestPoint.date)} ${getY(latestPoint.value)}`;

        for (let t = latestPoint.date.getTime() + stepMs; t <= endTime; t += stepMs) {
            const date = new Date(t);
            const value = Math.min(FULL_CAPACITY, Math.max(TECHNICAL_FLOOR, quadraticValueAt(projection.quadraticCoeffs, date)));
            path += ` L ${getX(date)} ${getY(value)}`;
        }

        if (hitDate && hitDate.getTime() <= chartMaxTime) {
            path += ` L ${getX(hitDate)} ${getY(hitValue)}`;
        }

        return path;
    }

    if ((projection.curveType === 'levelRate' || projection.curveType === 'decay') && projection.simulatedPath?.length > 1) {
        const points = projection.simulatedPath.filter(point => point.date.getTime() <= chartMaxTime);
        let path = `M ${getX(points[0].date)} ${getY(points[0].value)}`;

        for (let i = 1; i < points.length; i++) {
            const value = Math.min(FULL_CAPACITY, Math.max(TECHNICAL_FLOOR, points[i].value));
            path += ` L ${getX(points[i].date)} ${getY(value)}`;
        }

        return path;
    }

    const hitDate = projectionHitDate(projection);
    const hitValue = projectionHitValue(projection);
    const endDate = hitDate
        ? new Date(Math.min(hitDate.getTime(), chartMaxTime))
        : new Date(chartMaxTime);
    const endValue = hitDate && hitDate.getTime() <= chartMaxTime
        ? hitValue
        : projectedValue(latestPoint, projection.slopePerMs, endDate);

    return `M ${getX(latestPoint.date)} ${getY(latestPoint.value)} L ${getX(endDate)} ${getY(Math.min(FULL_CAPACITY, Math.max(TECHNICAL_FLOOR, endValue)))}`;
}

function computeWeeklyChanges(dataPoints) {
    const changes = [];

    for (let i = 1; i < dataPoints.length; i++) {
        changes.push({
            date: dataPoints[i].date,
            delta: dataPoints[i].value - dataPoints[i - 1].value,
            level: dataPoints[i - 1].value
        });
    }

    return changes;
}

function detectRegime(dataPoints) {
    const changes = computeWeeklyChanges(dataPoints);
    if (changes.length === 0) return 'stable';

    const delta = changes[changes.length - 1].delta;
    if (delta < 0) return 'drawdown';
    if (delta > 0) return 'refill';
    return 'stable';
}

function inventoryBuffer(level, direction) {
    if (direction === 'drawdown') {
        if (level >= DRAWDOWN_DEGRADATION_ONSET) return 1;
        return Math.max(0, (level - TECHNICAL_FLOOR) / DRAWDOWN_SPAN);
    }
    return Math.max(0, (FULL_CAPACITY - level) / REFILL_SPAN);
}

function fitLevelRateModel(changes, direction) {
    const samples = changes
        .filter(change => direction === 'drawdown' ? change.delta < 0 : change.delta > 0)
        .map(change => ({
            buffer: inventoryBuffer(change.level, direction),
            magnitude: Math.abs(change.delta)
        }))
        .filter(sample => sample.buffer > 1e-6 && sample.magnitude > 0);

    if (samples.length === 0) return null;

    if (samples.length >= 3) {
        let sumX = 0;
        let sumY = 0;
        let sumXY = 0;
        let sumXX = 0;
        const n = samples.length;

        for (const sample of samples) {
            const x = Math.log(sample.buffer);
            const y = Math.log(sample.magnitude);
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumXX += x * x;
        }

        const denominator = n * sumXX - sumX * sumX;
        if (denominator !== 0) {
            const alpha = (n * sumXY - sumX * sumY) / denominator;
            const logK = (sumY - alpha * sumX) / n;
            const k = Math.exp(logK);
            if (Number.isFinite(k) && k > 0 && Number.isFinite(alpha) && alpha >= 0) {
                return { k, alpha };
            }
        }
    }

    let ratioSum = 0;
    for (const sample of samples) {
        ratioSum += sample.magnitude / sample.buffer;
    }

    return { k: ratioSum / samples.length, alpha: 1 };
}

function weeklyLevelRate(value, model, direction) {
    if (!model) return 0;
    const buffer = Math.max(0.15, inventoryBuffer(value, direction));
    const magnitude = model.k * Math.pow(buffer, model.alpha);
    return direction === 'drawdown' ? -magnitude : magnitude;
}

function drawdownBarFill(delta, prevDelta) {
    if (delta >= 0) return CHART.drawdownMild;
    if (prevDelta === null || prevDelta >= 0) return CHART.drawdownSteady;
    if (delta < prevDelta) return CHART.drawdownAccelerating;
    return CHART.drawdownMild;
}

function buildXAxisTicks(minTime, maxTime, maxLabels = MAX_X_LABELS) {
    const spanDays = (maxTime - minTime) / MS_PER_DAY;
    const monthStep = spanDays > 400 ? 3 : spanDays > 200 ? 2 : 1;
    const ticks = [];
    const cursor = new Date(minTime);
    cursor.setDate(1);

    while (cursor.getTime() <= maxTime) {
        if (cursor.getTime() >= minTime) ticks.push(new Date(cursor));
        cursor.setMonth(cursor.getMonth() + monthStep);
    }

    if (ticks.length > maxLabels) {
        const step = Math.ceil(ticks.length / maxLabels);
        return ticks.filter((_, index) => index % step === 0);
    }

    return ticks;
}

function formatWeeklyRate(slopePerMs) {
    const weeklyDiff = slopePerMs * MS_PER_DAY * 7;
    if (weeklyDiff === 0) return 'Stable';
    const prefix = weeklyDiff > 0 ? '+' : '';
    return `${prefix}${(weeklyDiff / 1000).toFixed(2)}M bbl/wk`;
}

function formatProjectionTarget(projection) {
    if (projection.atOrBelowFloor) return 'Already at certified floor';
    if (projection.atOrAboveCapacity) return 'Already at capacity';
    if (projection.declining) return `Certified floor on ${formatDate(projection.floorHitDate)}`;
    if (projection.rising) return `Capacity on ${formatDate(projection.capacityHitDate)}`;
    return 'Stable';
}

function formatLevelRateLabel(projection) {
    if (projection.type !== 'levelRate') return projection.label;
    if (projection.regime === 'refill') return 'Level-Dependent Refill';
    if (projection.regime === 'drawdown') return 'Level-Dependent Drawdown';
    return projection.label;
}

function projectionTooltip(projection) {
    return `${formatLevelRateLabel(projection)}\n${formatWeeklyRate(projection.slopePerMs)}\n${formatProjectionTarget(projection)}`;
}

function escapeAttr(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function dashedHitLine(className, x1, y1, x2, y2, tooltip) {
    return `
        <line class="${className}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />
        <line class="chart-hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" data-tooltip="${escapeAttr(tooltip)}" />
    `;
}

function dashedHitPath(className, stroke, pathD, tooltip) {
    return `
        <path class="${className}" stroke="${stroke}" d="${pathD}" />
        <path class="chart-hit" d="${pathD}" data-tooltip="${escapeAttr(tooltip)}" />
    `;
}

function bindChartTooltips(svg) {
    const tip = document.getElementById('chart-tooltip');
    const viewport = svg.closest('.chart-viewport');
    if (!tip || !viewport) return;

    tip.hidden = true;

    for (const hit of svg.querySelectorAll('[data-tooltip]')) {
        hit.addEventListener('pointerenter', event => {
            tip.textContent = hit.dataset.tooltip;
            tip.hidden = false;
            positionChartTooltip(tip, viewport, event);
        });
        hit.addEventListener('pointermove', event => {
            positionChartTooltip(tip, viewport, event);
        });
        hit.addEventListener('pointerleave', () => {
            tip.hidden = true;
        });
    }
}

function positionChartTooltip(tip, viewport, event) {
    const bounds = viewport.getBoundingClientRect();
    let left = event.clientX - bounds.left + 12;
    let top = event.clientY - bounds.top + 12;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.transform = 'none';

    const tipBounds = tip.getBoundingClientRect();
    if (tipBounds.right > bounds.right - 8) {
        left = event.clientX - bounds.left - tipBounds.width - 12;
    }
    if (tipBounds.bottom > bounds.bottom - 8) {
        top = event.clientY - bounds.top - tipBounds.height - 12;
    }
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
}

function updateVelocityStats(chartData, regime) {
    const velocityEl = document.getElementById('stat-velocity');
    const velocityLabelLong = document.getElementById('stat-velocity-label-long');
    const velocityLabelShort = document.getElementById('stat-velocity-label-short');
    const changes = computeWeeklyChanges(chartData);

    if (velocityLabelLong && velocityLabelShort) {
        velocityLabelLong.textContent = regime === 'refill' ? 'Refill Velocity' : 'Drawdown Velocity';
        velocityLabelShort.textContent = 'Velocity';
    }

    if (changes.length < 2) {
        velocityEl.textContent = '—';
        velocityEl.style.color = '';
        return;
    }

    const latest = changes[changes.length - 1].delta;
    const prior = changes[changes.length - 2].delta;

    if (regime === 'refill') {
        if (latest > prior) {
            velocityEl.textContent = 'ACCELERATING';
            velocityEl.style.color = 'var(--ant-success)';
        } else if (latest < prior) {
            velocityEl.textContent = 'DECELERATING';
            velocityEl.style.color = 'var(--ant-warning)';
        } else {
            velocityEl.textContent = 'STEADY';
            velocityEl.style.color = '';
        }
        return;
    }

    if (latest < prior) {
        velocityEl.textContent = 'ACCELERATING';
        velocityEl.style.color = 'var(--ant-danger)';
    } else if (latest > prior) {
        velocityEl.textContent = 'DECELERATING';
        velocityEl.style.color = 'var(--ant-success)';
    } else {
        velocityEl.textContent = 'STEADY';
        velocityEl.style.color = '';
    }
}

function updateHeaderStats(projections, chartData) {
    const daysEl = document.getElementById('stat-days-range');
    const dateEl = document.getElementById('stat-date-range');
    const legendContainer = document.getElementById('projection-legend');
    const legendTitle = document.getElementById('legend-title');
    const targetLabelLong = document.getElementById('stat-target-label-long');
    const targetLabelShort = document.getElementById('stat-target-label-short');
    const regime = projections[0]?.regime || detectRegime(chartData);
    const displayed = getDisplayedProjections(projections, regime);
    const atFloor = projections.find(projection => projection.atOrBelowFloor);
    const atCapacity = projections.find(projection => projection.atOrAboveCapacity);

    updateVelocityStats(chartData, regime);

    if (targetLabelLong && targetLabelShort) {
        if (regime === 'refill') {
            targetLabelLong.textContent = 'Days to Capacity (Range)';
            targetLabelShort.textContent = 'Capacity';
        } else {
            targetLabelLong.textContent = 'Days to Certified Floor (Range)';
            targetLabelShort.textContent = 'Floor';
        }
    }

    if (legendTitle) {
        if (regime === 'refill') legendTitle.textContent = 'Refill Model Projections';
        else if (regime === 'drawdown') legendTitle.textContent = 'Drawdown Model Projections';
        else legendTitle.textContent = 'Model Projection Rates';
    }

    if (regime === 'drawdown' && atFloor) {
        daysEl.textContent = 'At floor';
        dateEl.textContent = formatDate(atFloor.floorHitDate);
    } else if (regime === 'refill' && atCapacity) {
        daysEl.textContent = 'At capacity';
        dateEl.textContent = formatDate(atCapacity.capacityHitDate);
    } else if (displayed.length === 0) {
        daysEl.textContent = 'Stable';
        dateEl.textContent = regime === 'refill'
            ? 'No capacity fill projected'
            : 'No certified floor breach projected';
    } else {
        const days = displayed.map(projectionHitDays);
        const dates = displayed.map(projection => projectionHitDate(projection).getTime());
        const minDays = Math.min(...days);
        const maxDays = Math.max(...days);
        const minDateMs = Math.min(...dates);
        const maxDateMs = Math.max(...dates);

        daysEl.textContent = minDays === maxDays ? `${minDays}d` : `${minDays}d – ${maxDays}d`;
        dateEl.textContent = minDays === maxDays
            ? formatDate(new Date(minDateMs))
            : `${formatDate(new Date(minDateMs))} – ${formatDate(new Date(maxDateMs))}`;
    }

    legendContainer.innerHTML = displayed.map(projection => `
        <div class="legend-item">
            <div class="legend-color-dot" style="background-color: ${projection.color}"></div>
            <div class="legend-info">
                <div class="legend-name">${formatLevelRateLabel(projection)} (${formatWeeklyRate(projection.slopePerMs)})</div>
                <div class="legend-meta">${formatProjectionTarget(projection)}</div>
            </div>
        </div>
    `).join('');
}

function renderChart(dataPoints, projections) {
    const svg = document.getElementById('spr-chart');
    const layout = getChartLayout();
    const { width, height, paddingLeft, paddingRight, paddingTop, paddingBottom, maxXLabels, axisFontSize, dotRadius, floorDotRadius } = layout;
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;
    const inventoryHeight = plotHeight * (1 - DRAWDOWN_BAND_RATIO) - DRAWDOWN_BAND_GAP;
    const drawdownBandHeight = plotHeight * DRAWDOWN_BAND_RATIO;
    const drawdownBandTop = paddingTop + inventoryHeight + DRAWDOWN_BAND_GAP;
    const drawdownZeroY = drawdownBandTop + 2;

    const regime = projections[0]?.regime || detectRegime(dataPoints);
    const displayedProjections = getDisplayedProjections(projections, regime);
    const values = dataPoints.map(d => d.value);
    const latestValue = values[values.length - 1];
    const pathPeak = displayedProjections.reduce((peak, projection) => {
        if (projection.simulatedPath?.length) {
            const visible = projection.simulatedPath.filter((_, index) => index * 7 <= MAX_CHART_EXTENSION_DAYS);
            return Math.max(peak, ...visible.map(point => point.value));
        }

        const days = projectionHitDays(projection);
        if (days !== null && days <= MAX_CHART_EXTENSION_DAYS) {
            return Math.max(peak, projectionHitValue(projection));
        }

        return Math.max(peak, latestValue + projection.slopePerMs * MAX_CHART_EXTENSION_DAYS * MS_PER_DAY);
    }, Math.max(...values));

    let maxVal = Math.ceil(Math.max(...values, pathPeak) / 50000) * 50000;
    if (maxVal <= TECHNICAL_FLOOR) maxVal = TECHNICAL_FLOOR + 50000;
    const minVal = TECHNICAL_FLOOR - FLOOR_CHART_PADDING * (maxVal - TECHNICAL_FLOOR);
    const minTime = dataPoints[0].date.getTime();
    const maxTime = dataPoints[dataPoints.length - 1].date.getTime();
    const latestPoint = dataPoints[dataPoints.length - 1];
    const weeklyChanges = computeWeeklyChanges(dataPoints);

    let chartMaxTime = maxTime;
    if (displayedProjections.length) {
        const farthestHit = Math.max(...displayedProjections.map(projection => projectionHitDate(projection).getTime()));
        const targetEnd = farthestHit + CHART_PROJECTION_PADDING_DAYS * MS_PER_DAY;
        const extensionMs = Math.min(targetEnd - maxTime, MAX_CHART_EXTENSION_DAYS * MS_PER_DAY);
        chartMaxTime = maxTime + Math.max(extensionMs, 14 * MS_PER_DAY);
    } else {
        chartMaxTime = maxTime + (14 + CHART_PROJECTION_PADDING_DAYS) * MS_PER_DAY;
    }

    const getX = dateObj => paddingLeft + ((dateObj.getTime() - minTime) / (chartMaxTime - minTime)) * plotWidth;
    const getY = val => paddingTop + inventoryHeight - ((val - minVal) / (maxVal - minVal)) * inventoryHeight;
    const formatAxisValue = val => `${(val / 1000).toFixed(0)}M`;

    const negativeDeltas = weeklyChanges.filter(change => change.delta < 0).map(change => Math.abs(change.delta));
    const maxDrawdown = negativeDeltas.length ? Math.max(...negativeDeltas) : 1;
    const drawdownScale = (drawdownBandHeight - 6) / maxDrawdown;
    const avgWeekWidth = dataPoints.length > 1
        ? ((maxTime - minTime) / (dataPoints.length - 1) / (chartMaxTime - minTime)) * plotWidth * 0.58
        : 10;
    const barWidth = Math.max(3, Math.min(mobileBarCap(layout), avgWeekWidth));

    const axisStyle = `font-size:${axisFontSize}px`;
    const drawdownLabelStyle = `font-size:${Math.max(8, axisFontSize - 1)}px`;
    const showCapacityLine = regime === 'refill' && FULL_CAPACITY <= maxVal;

    let elementsHTML = `
        <rect class="drawdown-band-bg" x="${paddingLeft}" y="${drawdownBandTop}" width="${plotWidth}" height="${drawdownBandHeight}" />
        <line class="drawdown-zero-line" x1="${paddingLeft}" y1="${drawdownZeroY}" x2="${width - paddingRight}" y2="${drawdownZeroY}" />
        <text class="axis-text drawdown-axis-label" style="${drawdownLabelStyle}" x="${paddingLeft - 6}" y="${drawdownZeroY + 3}" text-anchor="end">0</text>
        <text class="axis-text drawdown-axis-label" style="${drawdownLabelStyle}" x="${paddingLeft - 6}" y="${drawdownBandTop + drawdownBandHeight - 2}" text-anchor="end">-${(maxDrawdown / 1000).toFixed(0)}M</text>
    `;

    weeklyChanges.forEach((change, index) => {
        if (change.delta >= 0) return;

        const barHeight = Math.abs(change.delta) * drawdownScale;
        const x = getX(change.date) - barWidth / 2;
        const prevDelta = index > 0 ? weeklyChanges[index - 1].delta : null;
        const fill = drawdownBarFill(change.delta, prevDelta);

        elementsHTML += `
            <rect class="drawdown-bar" x="${x}" y="${drawdownZeroY}" width="${barWidth}" height="${barHeight}" fill="${fill}" rx="1" />
        `;
    });

    for (let v = Math.ceil((TECHNICAL_FLOOR + 1) / 50000) * 50000; v <= maxVal; v += 50000) {
        if (Math.abs(v - DRAWDOWN_DEGRADATION_ONSET) < 1000) continue;
        const yPos = getY(v);
        elementsHTML += `
            <line class="grid-line" x1="${paddingLeft}" y1="${yPos}" x2="${width - paddingRight}" y2="${yPos}" />
            <text class="axis-text" style="${axisStyle}" x="${paddingLeft - 6}" y="${yPos + 4}" text-anchor="end">${formatAxisValue(v)}</text>
        `;
    }

    const floorY = getY(TECHNICAL_FLOOR);
    elementsHTML += `
        ${dashedHitLine('floor-line', paddingLeft, floorY, width - paddingRight, floorY, `SecDef certified floor\n${formatAxisValue(TECHNICAL_FLOOR)} bbl`)}
        <text class="axis-text" style="${axisStyle}" x="${paddingLeft - 6}" y="${floorY + 4}" text-anchor="end" fill="#f5222d">${formatAxisValue(TECHNICAL_FLOOR)}</text>
        <line class="drawdown-band-divider" x1="${paddingLeft}" y1="${drawdownBandTop - 4}" x2="${width - paddingRight}" y2="${drawdownBandTop - 4}" />
    `;

    if (DRAWDOWN_DEGRADATION_ONSET > minVal && DRAWDOWN_DEGRADATION_ONSET <= maxVal) {
        const degradationY = getY(DRAWDOWN_DEGRADATION_ONSET);
        elementsHTML += `
            ${dashedHitLine('degradation-line', paddingLeft, degradationY, width - paddingRight, degradationY, `DOE drawdown degradation onset\n${formatAxisValue(DRAWDOWN_DEGRADATION_ONSET)} bbl`)}
            <text class="axis-text" style="${axisStyle}" x="${paddingLeft - 6}" y="${degradationY + 4}" text-anchor="end" fill="#d48806">${formatAxisValue(DRAWDOWN_DEGRADATION_ONSET)}</text>
        `;
    }

    if (showCapacityLine) {
        const capacityY = getY(FULL_CAPACITY);
        elementsHTML += `
            ${dashedHitLine('capacity-line', paddingLeft, capacityY, width - paddingRight, capacityY, `Full SPR capacity\n${formatAxisValue(FULL_CAPACITY)} bbl`)}
            <text class="axis-text" style="${axisStyle}" x="${paddingLeft - 6}" y="${capacityY + 4}" text-anchor="end" fill="#52c41a">${formatAxisValue(FULL_CAPACITY)}</text>
        `;
    }

    for (const tick of buildXAxisTicks(minTime, chartMaxTime, maxXLabels)) {
        const xPos = getX(tick);
        const label = tick.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        elementsHTML += `
            <line class="grid-line" x1="${xPos}" y1="${paddingTop}" x2="${xPos}" y2="${height - paddingBottom}" />
            <text class="axis-text" style="${axisStyle}" x="${xPos}" y="${height - paddingBottom + 16}" text-anchor="middle">${label}</text>
        `;
    }

    let pathData = `M ${getX(dataPoints[0].date)} ${getY(dataPoints[0].value)}`;
    for (let i = 1; i < dataPoints.length; i++) {
        pathData += ` L ${getX(dataPoints[i].date)} ${getY(dataPoints[i].value)}`;
    }

    let projectionMarkup = '';
    for (const projection of displayedProjections) {
        const pathD = buildProjectionPath(projection, latestPoint, chartMaxTime, getX, getY);
        const hitDate = projectionHitDate(projection);
        const hitValue = projectionHitValue(projection);
        const showHitMarker = hitDate.getTime() <= chartMaxTime && hitValue >= minVal && hitValue <= maxVal;

        projectionMarkup += `
            ${dashedHitPath('projection-path', projection.color, pathD, projectionTooltip(projection))}
            ${showHitMarker ? `<circle cx="${getX(hitDate)}" cy="${getY(hitValue)}" r="${floorDotRadius}" fill="${projection.color}" />` : ''}
        `;
    }

    svg.innerHTML = `
        ${elementsHTML}
        <line class="axis-line" x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${height - paddingBottom}" />
        <line class="axis-line" x1="${paddingLeft}" y1="${height - paddingBottom}" x2="${width - paddingRight}" y2="${height - paddingBottom}" />
        <path class="historical-path" d="${pathData}" />
        ${projectionMarkup}
        <circle cx="${getX(latestPoint.date)}" cy="${getY(latestPoint.value)}" r="${dotRadius}" fill="${CHART.latestDot}" />
    `;

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    bindChartTooltips(svg);
}

function mobileBarCap(layout) {
    return layout.width < 400 ? 10 : 14;
}
