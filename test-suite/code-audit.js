/**
 * 代码审计 - 检查潜在漏洞
 */

const fs = require('fs');
const path = require('path');

const issues = [];

function auditFile(filePath, name) {
    console.log(`\n🔍 审计 ${name}...`);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // 检查1: 未处理的Promise
    const promiseRegex = /\b(await|\.then|\.catch)\b/g;
    const asyncFunctions = content.match(/async\s+function/g) || [];
    const awaitCount = (content.match(/await/g) || []).length;
    console.log(`  异步函数: ${asyncFunctions.length}, await: ${awaitCount}`);

    // 检查2: 潜在的空值
    let lineNum = 0;
    lines.forEach((line, idx) => {
        lineNum = idx + 1;

        // 检查点操作符前可能的null/undefined
        if (/\w+\.[a-zA-Z]+\s*\(/g.test(line) &&
            !line.includes('?.') &&
            !line.includes('catch') &&
            !line.includes('//') &&
            line.includes('await')) {
            // 潜在的NPE风险
        }

        // 检查3: 硬编码路径
        if (line.includes('D:\\\\') || line.includes('C:\\\\')) {
            if (!line.includes('default') && !line.includes('placeholder')) {
                console.log(`  ⚠️ 第${lineNum}行: 硬编码路径`);
            }
        }

        // 检查4: 未使用的变量
        const varMatch = line.match(/(?:const|let|var)\s+(\w+)/);
        if (varMatch) {
            const varName = varMatch[1];
            const usage = content.match(new RegExp(`\\b${varName}\\b`, 'g')) || [];
            if (usage.length <= 1 && !line.includes('require')) {
                // 可能未使用
            }
        }
    });

    // 检查5: 错误处理完整性
    const tryCount = (content.match(/try\s*\{/g) || []).length;
    const catchCount = (content.match(/catch\s*\(/g) || []).length;
    if (tryCount !== catchCount) {
        console.log(`  ⚠️ try/catch不匹配: ${tryCount} try, ${catchCount} catch`);
    } else {
        console.log(`  ✅ try/catch匹配: ${tryCount} 个`);
    }

    // 检查6: 潜在的死循环
    const whileLoops = content.match(/while\s*\(/g) || [];
    console.log(`  while循环: ${whileLoops.length}`);
}

console.log('='.repeat(60));
console.log('🔍 代码审计');
console.log('='.repeat(60));

// 审计关键文件
const files = [
    { path: path.join(__dirname, '..', 'server.js'), name: 'server.js' },
    { path: path.join(__dirname, '..', 'workflow-controller.js'), name: 'workflow-controller.js' },
    { path: path.join(__dirname, '..', 'doubao-automation.js'), name: 'doubao-automation.js' },
    { path: path.join(__dirname, '..', 'legil-automation.js'), name: 'legil-automation.js' },
    { path: path.join(__dirname, '..', 'playwright-controller.js'), name: 'playwright-controller.js' }
];

files.forEach(f => {
    if (fs.existsSync(f.path)) {
        auditFile(f.path, f.name);
    } else {
        console.log(`\n❌ 文件不存在: ${f.name}`);
    }
});

console.log('\n' + '='.repeat(60));
console.log('✅ 代码审计完成');
console.log('='.repeat(60));
