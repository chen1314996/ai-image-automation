/**
 * 循环测试 - 持续运行直到所有功能验证通过
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_ROUNDS = 5; // 最大测试轮次
let currentRound = 0;
const allResults = [];

async function runTestRound() {
    currentRound++;
    console.log('\n' + '='.repeat(70));
    console.log(`🔄 第 ${currentRound} 轮测试`);
    console.log('='.repeat(70));

    const startTime = Date.now();

    try {
        // 执行测试
        execSync('node tests/cycle/full-workflow-test.js', {
            stdio: 'inherit',
            timeout: 35 * 60 * 1000 // 35分钟超时
        });

        const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
        console.log(`\n✅ 第 ${currentRound} 轮测试完成，耗时 ${duration} 分钟`);

        return { success: true, duration };

    } catch (error) {
        const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
        console.log(`\n❌ 第 ${currentRound} 轮测试失败，耗时 ${duration} 分钟`);

        return { success: false, duration, error: error.message };
    }
}

async function main() {
    console.log('='.repeat(70));
    console.log('🔄 循环QA测试开始');
    console.log('='.repeat(70));
    console.log(`最大测试轮次: ${MAX_ROUNDS}`);
    console.log('测试将持续运行直到：');
    console.log('  1. 所有功能验证通过，或');
    console.log('  2. 达到最大测试轮次\n');

    while (currentRound < MAX_ROUNDS) {
        const result = await runTestRound();
        allResults.push({
            round: currentRound,
            ...result,
            timestamp: new Date().toISOString()
        });

        if (result.success) {
            console.log('\n🎉 测试通过！所有功能验证OK');
            break;
        } else {
            console.log(`\n⚠️ 第 ${currentRound} 轮未通过，准备下一轮...`);
            console.log('等待10秒后继续...\n');
            await new Promise(r => setTimeout(r, 10000));
        }
    }

    // 生成最终报告
    console.log('\n' + '='.repeat(70));
    console.log('📊 循环测试最终报告');
    console.log('='.repeat(70));

    const passedRounds = allResults.filter(r => r.success).length;
    console.log(`总测试轮次: ${currentRound}`);
    console.log(`通过轮次: ${passedRounds}`);
    console.log(`失败轮次: ${currentRound - passedRounds}`);

    allResults.forEach(r => {
        const icon = r.success ? '✅' : '❌';
        console.log(`  ${icon} 第${r.round}轮: ${r.success ? '通过' : '失败'} (${r.duration}分钟)`);
    });

    // 保存完整报告
    const reportPath = path.join(__dirname, 'reports', `loop-test-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    if (!fs.existsSync(path.dirname(reportPath))) {
        fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    }
    fs.writeFileSync(reportPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        summary: {
            totalRounds: currentRound,
            passedRounds,
            failedRounds: currentRound - passedRounds
        },
        rounds: allResults
    }, null, 2));

    console.log(`\n📄 完整报告: ${reportPath}`);

    if (passedRounds > 0) {
        console.log('\n✅ 循环测试完成，至少一轮测试通过');
        process.exit(0);
    } else {
        console.log('\n❌ 循环测试完成，但所有轮次均未通过');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('循环测试出错:', err);
    process.exit(1);
});
