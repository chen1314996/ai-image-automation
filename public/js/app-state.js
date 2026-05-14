// 全局状态和默认配置。页面上多个按钮都会读写这里的 config。
        // Global config
        const config = {
            referenceFolder: 'D:\\工作\\自动化工作流1\\批量产图\\输入',
            saveFolder: 'D:\\工作\\自动化工作流1\\批量产图\\输出',
            legilUrl: 'https://lumos.diandian.info/legil/image-ai/image-to-image',
            legilReferenceFolder: 'D:\\工作\\自动化工作流1\\批量产图\\参考图',
            workflowBrowserMode: 'headless',
            resizeInputFolder: 'D:\\工作\\自动化工作流1\\Legil批量改尺寸\\输入',
            resizeOutputFolder: 'D:\\工作\\自动化工作流1\\Legil批量改尺寸\\输出',
            resizeBrowserMode: 'headless',
            creativeOutputFolder: 'D:\\工作\\自动化工作流1\\创意拓展\\输出',
            creativeReferenceFolder: '',
            creativeBrowserMode: 'headed',
            renameInputFolder: 'D:\\工作\\自动化工作流1\\创意拓展\\输出',
            renameOutputFolder: 'D:\\工作\\自动化工作流1\\创意拓展\\重命名输出',
            renameFixedPrefix: 'GOFCNIM',
            renameStartNumber: '28930',
            renameRegionText: 'BJ',
            renameChannelText: '广点通',
            renamePrimaryTag: '题材',
            renameSecondaryTag: '载具',
            resizeBatchInputFolder: 'D:\\工作\\自动化工作流1\\创意拓展\\重命名输出',
            resizeBatchOutputFolder: 'D:\\工作\\自动化工作流1\\重命名\\改尺寸',
            resizeBatchTargetSize: '800x800',
            logoBatchInputFolder: 'D:\\工作\\自动化工作流1\\重命名\\改尺寸',
            logoBatchOutputFolder: 'D:\\工作\\自动化工作流1\\重命名\\加LOGO',
            logoBatchFileName: '1-国内LOGO模板-800x800.png',
            packageBatchInputFolder: 'D:\\工作\\自动化工作流1\\重命名\\加LOGO',
            packageBatchOutputFolder: 'D:\\工作\\自动化工作流1\\重命名\\一键打包',
            resizePromptTemplate: '',
            creativePrompts: [],
            creativeTableFileName: '',
            doubaoPromptTemplate: '',
            doubaoModelId: '',
            legilGeneration: {
                imageModel: 'nano-banana-2',
                aspectRatio: '1:1',
                resolution: '2K',
                outputQuantity: 1
            },
            resizeLegilGeneration: {
                imageModel: 'nano-banana-2',
                aspectRatio: '16:9',
                resolution: '1K',
                outputQuantity: 1
            },
            creativeLegilGeneration: {
                imageModel: 'nano-banana-2',
                aspectRatio: '1:1',
                resolution: '1K',
                outputQuantity: 1
            },
            notifications: {
                feishuEnabled: true,
                taskCompletionEnabled: true,
                serverStartupEnabled: true,
                staleProgressEnabled: true,
                staleThresholdMinutes: 15,
                notificationCooldownMinutes: 10,
                legilScreenshotEnabled: true,
                autoRecoveryEnabled: true,
                pauseOnConsecutiveFailures: true,
                consecutiveFailureThreshold: 3,
                watchdogAutoRestartEnabled: true
            }
        };

        const folderDefaults = {
            referenceFolder: 'D:\\工作\\自动化工作流1\\批量产图\\输入',
            legilReferenceFolder: 'D:\\工作\\自动化工作流1\\批量产图\\参考图',
            saveFolder: 'D:\\工作\\自动化工作流1\\批量产图\\输出',
            resizeInputFolder: 'D:\\工作\\自动化工作流1\\Legil批量改尺寸\\输入',
            resizeOutputFolder: 'D:\\工作\\自动化工作流1\\Legil批量改尺寸\\输出',
            creativeOutputFolder: 'D:\\工作\\自动化工作流1\\创意拓展\\输出',
            creativeReferenceFolder: '',
            renameInputFolder: 'D:\\工作\\自动化工作流1\\创意拓展\\输出',
            renameOutputFolder: 'D:\\工作\\自动化工作流1\\创意拓展\\重命名输出',
            resizeBatchInputFolder: 'D:\\工作\\自动化工作流1\\创意拓展\\重命名输出',
            resizeBatchOutputFolder: 'D:\\工作\\自动化工作流1\\重命名\\改尺寸',
            logoBatchInputFolder: 'D:\\工作\\自动化工作流1\\重命名\\改尺寸',
            logoBatchOutputFolder: 'D:\\工作\\自动化工作流1\\重命名\\加LOGO',
            packageBatchInputFolder: 'D:\\工作\\自动化工作流1\\重命名\\加LOGO',
            packageBatchOutputFolder: 'D:\\工作\\自动化工作流1\\重命名\\一键打包'
        };
        const folderHistoryKey = 'ai-image-automation-folder-history-v1';
        const folderHistoryLimit = 8;

        // SSE connection
        let eventSource = null;
        let progressInterval = null;
        let resizeStatusInterval = null;
        let creativeStatusInterval = null;
        let creativeLastRunIndexes = [];
        let creativeResumeIndexes = [];
        let creativeResumeInfo = null;
        let creativeAgentFiles = [];
        let creativeAgentLastResult = null;
        let creativeAgentServerStatus = null;
        let creativeAgentCurrentRunId = '';
        let creativeAgentStatusInterval = null;
        let workflowResumeInfo = null;
        const maxLogEntries = 1000;

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            addLog('系统初始化完成', 'system');
            initFolderControls();
            connectLogStream();
            checkBrowserStatus();
            loadLegilRefFolderConfig();
            loadWorkflowConfig();
            loadNotificationConfig();
            loadDoubaoConfig();
            loadLegilGenerationConfig();
            loadResizeConfig();
            loadCreativeConfig().finally(refreshCreativeResumeControls);
            loadCreativeAgentStatus();
            refreshWorkflowResumeControls();
            const promptTextarea = document.getElementById('doubaoPromptTemplate');
            if (promptTextarea) {
                promptTextarea.addEventListener('input', updateDoubaoPromptCount);
            }
            const resizePromptTextarea = document.getElementById('resizePromptTemplate');
            if (resizePromptTextarea) {
                resizePromptTextarea.addEventListener('input', updateResizePromptCount);
                resizePromptTextarea.addEventListener('blur', () => saveResizeConfig({ silent: true }));
            }
            initCreativeTableDropzone();
            if (typeof initRenamePage === 'function') {
                initRenamePage();
            }
            if (typeof initResizeBatchPanel === 'function') {
                initResizeBatchPanel();
            }
            if (typeof initLogoBatchPanel === 'function') {
                initLogoBatchPanel();
            }
            if (typeof initPackageBatchPanel === 'function') {
                initPackageBatchPanel();
            }
        });

        // Logging
