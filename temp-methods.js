
    /**
     * ============================================
     * 第六阶段：提取五组提示词（增强版）
     * ============================================
     * 同时兼容：
     *   1. 纯文本形式（提示词 X：格式）
     *   2. 代码块包裹形式（<plaintext>代码块）
     *   3. 数字标题格式（X 标题）
     */

    /**
     * 从豆包回复中提取五组提示词
     * @param {string} response - 豆包的完整回复文本
     * @returns {Object} - 提取结果 { success: boolean, prompts: array, message: string }
     */
    extractPrompts(response) {
        logger.info('开始提取五组提示词...');
        logger.info(`回复内容长度: ${response.length} 字符`);

        try {
            if (!response || response.length < 50) {
                logger.error('❌ 回复内容太短，无法提取提示词');
                return {
                    success: false,
                    prompts: [],
                    message: '回复内容太短，无法提取提示词'
                };
            }

            // 预处理：移除用户发送的提示词请求，找到AI回复的起始位置
            let aiResponse = this.extractAIResponse(response);
            logger.info(`AI回复部分长度: ${aiResponse.length} 字符`);

            const prompts = [];

            // ========================================
            // 策略1：提取"提示词 X："格式（最常见）
            // ========================================
            // 匹配：提示词1：、提示词 1：、提示词一：等
            const promptPattern = /提示词\s*([一二三四五12345])[：:\s]+\n?\s*([^\n]*?)(?:\n|$)([\s\S]*?)(?=提示词\s*[一二三四五12345][：:\s]+|第\s*[一二三四五12345]\s*[组組]|$)/gi;
            let matches = [...aiResponse.matchAll(promptPattern)];

            if (matches.length >= 5) {
                logger.info(`✅ 找到 ${matches.length} 组提示词（按"提示词 X"格式）`);

                for (let i = 0; i < 5 && i < matches.length; i++) {
                    const match = matches[i];
                    const promptNum = match[1];
                    let title = match[2] ? match[2].trim() : '';
                    let content = match[3] ? match[3].trim() : '';

                    // 提取代码块中的内容
                    const codeBlockMatch = content.match(/```(?:plaintext|text)?\s*\n?([\s\S]*?)```/i);
                    if (codeBlockMatch) {
                        content = codeBlockMatch[1].trim();
                    }

                    let fullPrompt = title && title.length > 0 && !title.toLowerCase().includes('plaintext')
                        ? `${title}\n${content}`
                        : content;

                    fullPrompt = this.cleanPromptContent(fullPrompt);

                    if (fullPrompt.length > 30) {
                        prompts.push(fullPrompt);
                        logger.info(`  提示词 ${promptNum}: ${fullPrompt.substring(0, 60)}...`);
                    }
                }
            }

            // ========================================
            // 策略2：提取"第 X 组"格式
            // ========================================
            if (prompts.length < 5) {
                prompts.length = 0;
                logger.info('尝试按"第 X 组"格式提取...');

                const groupPattern = /第\s*([一二三四五12345])\s*[组組]?[：:\s]+\n?\s*([^\n]*?)(?:\n|$)([\s\S]*?)(?=第\s*[一二三四五12345]\s*[组組]?[：:\s]+|提示词\s*[12345][：:\s]+|$)/gi;
                matches = [...aiResponse.matchAll(groupPattern)];

                if (matches.length >= 5) {
                    logger.info(`✅ 找到 ${matches.length} 组提示词（按"第 X 组"格式）`);

                    for (let i = 0; i < 5 && i < matches.length; i++) {
                        const match = matches[i];
                        const groupNum = match[1];
                        let title = match[2] ? match[2].trim() : '';
                        let content = match[3] ? match[3].trim() : '';

                        const codeBlockMatch = content.match(/```(?:plaintext|text)?\s*\n?([\s\S]*?)```/i);
                        if (codeBlockMatch) {
                            content = codeBlockMatch[1].trim();
                        }

                        let fullPrompt = title && title.length > 0 && !title.toLowerCase().includes('plaintext')
                            ? `${title}\n${content}`
                            : content;

                        fullPrompt = this.cleanPromptContent(fullPrompt);

                        if (fullPrompt.length > 30) {
                            prompts.push(fullPrompt);
                            logger.info(`  第 ${groupNum} 组: ${fullPrompt.substring(0, 60)}...`);
                        }
                    }
                }
            }

            // ========================================
            // 策略3：提取"X. 标题"或"X 标题"格式
            // ========================================
            if (prompts.length < 5) {
                prompts.length = 0;
                logger.info('尝试按"X. 标题"格式提取...');

                // 匹配：1. 标题、1、标题、1）标题 等
                const numPattern = /(?:^|\n)([12345])[\.．、\s]+([^\n]*?)(?:\n|$)([\s\S]*?)(?=(?:^|\n)[12345][\.．、\s]+|提示词\s*[12345][：:\s]+|第\s*[一二三四五12345]\s*[组組]|$)/gm;
                matches = [...aiResponse.matchAll(numPattern)];

                if (matches.length >= 5) {
                    logger.info(`✅ 找到 ${matches.length} 组提示词（按"X. 标题"格式）`);

                    for (let i = 0; i < 5 && i < matches.length; i++) {
                        const match = matches[i];
                        const num = match[1];
                        let title = match[2] ? match[2].trim() : '';
                        let content = match[3] ? match[3].trim() : '';

                        const codeBlockMatch = content.match(/```(?:plaintext|text)?\s*\n?([\s\S]*?)```/i);
                        if (codeBlockMatch) {
                            content = codeBlockMatch[1].trim();
                        }

                        let fullPrompt = title && title.length > 0
                            ? `${title}\n${content}`
                            : content;

                        fullPrompt = this.cleanPromptContent(fullPrompt);

                        if (fullPrompt.length > 30) {
                            prompts.push(fullPrompt);
                            logger.info(`  [${num}] ${fullPrompt.substring(0, 60)}...`);
                        }
                    }
                }
            }

            // ========================================
            // 策略4：按代码块提取
            // ========================================
            if (prompts.length < 5) {
                prompts.length = 0;
                logger.info('尝试从代码块中提取...');

                const codeBlockPattern = /```(?:plaintext|text)?\s*\n?([\s\S]*?)(?:```|$)/gi;
                const codeBlocks = [...aiResponse.matchAll(codeBlockPattern)];

                if (codeBlocks.length >= 5) {
                    logger.info(`✅ 找到 ${codeBlocks.length} 个代码块`);

                    for (let i = 0; i < 5 && i < codeBlocks.length; i++) {
                        let content = codeBlocks[i][1].trim();
                        content = this.cleanPromptContent(content);

                        if (content.length > 30) {
                            prompts.push(content);
                            logger.info(`  代码块 ${i + 1}: ${content.substring(0, 60)}...`);
                        }
                    }
                }
            }

            // ========================================
            // 策略5：智能段落分割（兜底）
            // ========================================
            if (prompts.length < 5) {
                prompts.length = 0;
                logger.info('使用智能段落分割策略...');

                const segments = aiResponse
                    .split(/\n{2,}/)
                    .map(s => s.trim())
                    .filter(s => s.length > 50 && !s.match(/^```/));

                const promptKeywords = ['3D', '渲染', '海报', '场景', '画面', '镜头', '光影', '风格', '视角', '构图'];
                const scored = segments.map(seg => {
                    let score = 0;
                    promptKeywords.forEach(kw => {
                        if (seg.includes(kw)) score += 10;
                    });
                    score += Math.min(seg.length / 20, 30);
                    if (seg.includes('帮我参考') || seg.includes('生成五组')) score -= 100;
                    return { seg, score };
                });

                scored.sort((a, b) => b.score - a.score);

                for (let i = 0; i < 5 && i < scored.length; i++) {
                    let content = this.cleanPromptContent(scored[i].seg);
                    if (content.length > 30) {
                        prompts.push(content);
                    }
                }
            }

            // ========================================
            // 验证结果
            // ========================================
            if (prompts.length >= 5) {
                logger.info(`✅ 已提取到 ${prompts.length} 组提示词`);

                const finalPrompts = prompts.slice(0, 5).map((p, index) => ({
                    id: index + 1,
                    content: p.substring(0, 1500),
                    preview: p.substring(0, 80) + '...'
                }));

                this.lastExtractedPrompts = finalPrompts;

                logger.info('提取结果摘要:');
                finalPrompts.forEach((p, i) => {
                    logger.info(`  [${i + 1}] ${p.preview}`);
                });

                return {
                    success: true,
                    prompts: finalPrompts,
                    message: `成功提取 ${finalPrompts.length} 组提示词`
                };
            } else {
                logger.error(`❌ 提取失败：只找到 ${prompts.length} 组提示词，需要5组`);
                return {
                    success: false,
                    prompts: prompts.map((p, index) => ({
                        id: index + 1,
                        content: p,
                        preview: p.substring(0, 80) + '...'
                    })),
                    message: `只提取到 ${prompts.length} 组提示词，需要5组`
                };
            }

        } catch (error) {
            logger.error(`❌ 提取提示词失败: ${error.message}`);
            return {
                success: false,
                prompts: [],
                message: `提取失败: ${error.message}`
            };
        }
    }

    /**
     * 从完整响应中提取AI回复部分
     * 过滤掉用户发送的提示词请求和引导语
     */
    extractAIResponse(response) {
        // 找到AI回复的起始位置
        const userMarkers = [
            '帮我参考这张图',
            '生成五组不同画面提示词',
            '画面直观、主题明确'
        ];

        let aiStartIndex = 0;

        for (const marker of userMarkers) {
            const index = response.indexOf(marker);
            if (index !== -1) {
                const afterMarker = response.substring(index);
                const aiStartMatch = afterMarker.match(/(第\s*[一二三四五12345]\s*[组組]|提示词\s*[一二三四五12345]|[一二三四五12345][\.．、\s]+|我参考)/);
                if (aiStartMatch) {
                    const relativeIndex = afterMarker.indexOf(aiStartMatch[0]);
                    const absoluteIndex = index + relativeIndex;
                    if (absoluteIndex > aiStartIndex) {
                        aiStartIndex = absoluteIndex;
                    }
                }
            }
        }

        let aiResponse = response.substring(aiStartIndex);

        // 过滤引导语
        const introPatterns = [
            /^我参考.*?(?:为你创作|生成|提供)/,
            /^根据.*?参考图/,
            /^以下是.*?5组/,
            /^这是.*?提示词/,
            /^(?:好的|好的，|OK，|没问题，)/
        ];

        for (const pattern of introPatterns) {
            aiResponse = aiResponse.replace(pattern, '');
        }

        return aiResponse.trim();
    }

    /**
     * 清理提示词内容
     * 移除代码块标记、复制按钮文本等无关内容
     */
    cleanPromptContent(content) {
        return content
            .replace(/```(?:plaintext|text)?\s*\n?/gi, '')
            .replace(/```/g, '')
            .replace(/<plaintext>/gi, '')
            .replace(/复制/g, '')
            .replace(/复制代码/g, '')
            .replace(/^\s*[\*\-•]\s*/gm, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
