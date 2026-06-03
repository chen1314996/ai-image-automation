function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
}

function toNumber(value) {
    return isFiniteNumber(value) ? Number(value) : null;
}

function sortedValues(items, key) {
    return items
        .map(item => toNumber(item && item[key]))
        .filter(value => value !== null)
        .sort((a, b) => a - b);
}

function quantile(values, q) {
    if (!values.length) return null;
    if (values.length === 1) return values[0];
    const index = (values.length - 1) * q;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return values[lower];
    return values[lower] + (values[upper] - values[lower]) * (index - lower);
}

function metricStats(items, key) {
    const values = sortedValues(items, key);
    return {
        count: values.length,
        p25: quantile(values, 0.25),
        median: quantile(values, 0.5),
        p75: quantile(values, 0.75),
        p90: quantile(values, 0.9)
    };
}

const D0_GOOD_FLOOR = 0.002;
const D0_STRONG_FLOOR = 0.005;

function buildHealthContext(materials = []) {
    return {
        spend: metricStats(materials, 'spend'),
        ctr: metricStats(materials, 'ctr'),
        cvr: metricStats(materials, 'cvr'),
        cpi: metricStats(materials, 'cpi'),
        ipm: metricStats(materials, 'ipm'),
        d0IapRoi: metricStats(materials, 'd0IapRoi')
    };
}

function metricAtLeast(value, baseline) {
    return value !== null && baseline !== null && value >= baseline;
}

function metricAtMost(value, baseline) {
    return value !== null && baseline !== null && value <= baseline;
}

function clampScore(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
}

function healthLevel(score) {
    if (score >= 78) return { key: 'excellent', label: '高健康', className: 'is-excellent' };
    if (score >= 64) return { key: 'good', label: '健康', className: 'is-good' };
    if (score >= 48) return { key: 'watch', label: '观察', className: 'is-watch' };
    if (score >= 34) return { key: 'risk', label: '风险', className: 'is-risk' };
    return { key: 'bad', label: '高风险', className: 'is-bad' };
}

function classifyMaterial(material = {}, context = buildHealthContext([])) {
    const spend = toNumber(material.spend);
    const d0 = toNumber(material.d0IapRoi);
    const cpi = toNumber(material.cpi);
    const ipm = toNumber(material.ipm);
    const ctr = toNumber(material.ctr);
    const cvr = toNumber(material.cvr);
    const highSpend = metricAtLeast(spend, context.spend.p75);
    const veryHighSpend = metricAtLeast(spend, context.spend.p90);
    const d0Ready = d0 !== null;
    const d0GoodLine = Math.max(context.d0IapRoi.median || 0, D0_GOOD_FLOOR);
    const d0StrongLine = Math.max(context.d0IapRoi.p75 || 0, D0_STRONG_FLOOR);
    const d0Strong = d0Ready && d0 >= d0StrongLine;
    const d0Good = d0Ready && d0 >= d0GoodLine;
    const d0Weak = d0Ready && d0 < d0GoodLine;
    const cpiGood = metricAtMost(cpi, context.cpi.median);
    const cpiStrong = metricAtMost(cpi, context.cpi.p25);
    const cpiWeak = metricAtLeast(cpi, context.cpi.p75);
    const ipmGood = metricAtLeast(ipm, context.ipm.median);
    const ipmStrong = metricAtLeast(ipm, context.ipm.p75);
    const ipmWeak = ipm !== null && context.ipm.p25 !== null && ipm < context.ipm.p25;
    const ctrHigh = metricAtLeast(ctr, context.ctr.p75);
    const ctrLow = ctr !== null && context.ctr.p25 !== null && ctr < context.ctr.p25;
    const cvrHigh = metricAtLeast(cvr, context.cvr.p75);
    const cvrLow = cvr !== null && context.cvr.p25 !== null && cvr < context.cvr.p25;

    let score = 50;
    const reasons = [];

    if (d0Strong) {
        score += 28;
        reasons.push('D0 ROI 位于头部区间');
    } else if (d0Good) {
        score += 18;
        reasons.push('D0 ROI 高于中位');
    } else if (d0Weak) {
        score -= 22;
        reasons.push('D0 ROI 低于中位');
    } else if (!d0Ready) {
        score -= highSpend ? 12 : 4;
        reasons.push('D0 ROI 暂无数据');
    }

    if (cpiStrong) {
        score += 12;
        reasons.push('CPI 位于低成本区间');
    } else if (cpiGood) {
        score += 7;
        reasons.push('CPI 优于中位');
    } else if (cpiWeak) {
        score -= 10;
        reasons.push('CPI 偏高');
    }

    if (ipmStrong) {
        score += 10;
        reasons.push('IPM 位于头部区间');
    } else if (ipmGood) {
        score += 6;
        reasons.push('IPM 高于中位');
    } else if (ipmWeak) {
        score -= 7;
        reasons.push('IPM 偏弱');
    }

    if (ctrHigh && cvrLow) {
        score -= 8;
        reasons.push('CTR 高但 CVR 弱');
    } else if (ctrLow && (cvrHigh || d0Good)) {
        score += 4;
        reasons.push('点击弱但转化或回收有支撑');
    }

    if (veryHighSpend && d0Weak) {
        score -= 10;
        reasons.push('高消耗低 D0 ROI');
    }

    let tag = { key: 'roi_observation', label: '回收观察中', className: 'is-watch' };
    let action = '继续观察 D0 ROI，避免直接放大复刻。';

    if (highSpend && d0Good && (cpiGood || ipmGood)) {
        tag = { key: 'high_spend_high_roi', label: '高消耗高回收', className: 'is-excellent' };
        action = '优先拆解复刻，保留核心画面机制。';
    } else if (highSpend && (d0Weak || (!d0Ready && (cpiWeak || ipmWeak)))) {
        tag = { key: 'high_spend_low_roi', label: '高消耗低回收', className: 'is-risk' };
        action = '减少重复投放，先复盘画面承诺与转化落差。';
    } else if (!highSpend && d0Good && (cpiGood || ipmGood)) {
        tag = { key: 'low_spend_potential', label: '低消耗高潜力', className: 'is-good' };
        action = '建议小预算加测，验证能否放量。';
    } else if (ctrHigh && (cvrLow || cpiWeak)) {
        tag = { key: 'click_strong_convert_weak', label: '点击强转化弱', className: 'is-watch' };
        action = '保留吸睛元素，重做转化承诺和落地一致性。';
    } else if (ctrLow && (cvrHigh || d0Good)) {
        tag = { key: 'convert_strong_click_weak', label: '转化强点击弱', className: 'is-good' };
        action = '强化首屏钩子，提高点击入口。';
    } else if (d0Ready && d0Good) {
        tag = { key: 'replicable', label: '可拆解复刻', className: 'is-good' };
        action = '提取有效变量，进入方向迭代池。';
    } else if (d0Ready && d0Weak && highSpend) {
        tag = { key: 'pause_repeat', label: '暂停复刻', className: 'is-bad' };
        action = '停止简单复刻，换视觉机制后再测。';
    }

    const level = healthLevel(score);
    return {
        score: clampScore(score),
        level,
        tag,
        action,
        reasons: reasons.slice(0, 5)
    };
}

module.exports = {
    buildHealthContext,
    classifyMaterial,
    metricStats,
    isFiniteNumber,
    toNumber
};
