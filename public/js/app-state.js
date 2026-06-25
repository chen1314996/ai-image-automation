// 全局状态和默认配置。页面上多个按钮都会读写这里的 config。
        // Global config
        const config = {
            referenceFolder: 'D:\\工作\\自动化工作流1\\批量产图\\输入',
            saveFolder: 'D:\\工作\\自动化工作流1\\批量产图\\输出',
            legilUrl: 'https://lumos.diandian.info/legil/image-ai/image-to-image',
            jimengUrl: 'https://jimeng.jianying.com/ai-tool/generate?workspace=12721326029068&type=image',
            legilReferenceFolder: 'D:\\工作\\自动化工作流1\\批量产图\\参考图',
            tablePromptReferenceFolder: 'D:\\工作\\自动化工作流1\\批量产图\\参考图',
            tablePromptOutputFolder: 'D:\\工作\\自动化工作流1\\批量产图\\输出',
            workflowBrowserMode: 'headless',
            resizeInputFolder: 'D:\\工作\\自动化工作流1\\改尺寸交付\\源图输入',
            resizeOutputFolder: 'D:\\工作\\自动化工作流1\\改尺寸交付\\输出',
            resizeProvider: 'legil',
            resizeBrowserMode: 'headless',
            creativeOutputFolder: 'D:\\工作\\自动化工作流1\\创意拓展\\输出',
            creativeReferenceFolder: 'D:\\工作\\自动化工作流1\\创意拓展\\参考图',
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
            resizeBatchOutputFolder: 'D:\\工作\\自动化工作流1\\重命名\\本地标准化',
            resizeBatchTargetSize: '800x800',
            logoBatchInputFolder: 'D:\\工作\\自动化工作流1\\重命名\\本地标准化',
            logoBatchOutputFolder: 'D:\\工作\\自动化工作流1\\重命名\\加LOGO',
            logoBatchFileName: '1-国内LOGO模板-800x800.png',
            packageBatchInputFolder: 'D:\\工作\\自动化工作流1\\重命名\\加LOGO',
            packageBatchOutputFolder: 'D:\\工作\\自动化工作流1\\重命名\\一键打包',
            resizePromptTemplate: '请进行 AI 尺寸适配，保持主体与卖点清晰，按目标画幅重新构图。',
            deliveryInputFolder: 'D:\\工作\\自动化工作流1\\改尺寸交付\\源图输入',
            deliveryOutputFolder: 'D:\\工作\\自动化工作流1\\改尺寸交付\\输出',
            deliveryProcessMode: 'full-delivery',
            deliveryCandidateCount: 1,
            deliveryTargetSizes: ['800x800', '1280x720', '1080x1920'],
            deliveryCandidateCountsBySize: {
                '800x800': 1,
                '1280x720': 1,
                '1080x1920': 1
            },
            deliveryLogoFolder: 'D:\\工作\\GOF\\LOGO模版',
            deliveryNamingPrefix: 'GOFCNIM',
            deliveryStartNumber: '28930',
            deliveryRegionText: 'BJ',
            deliveryChannelText: '广点通',
            deliveryPrimaryTag: '题材',
            deliverySecondaryTag: '载具',
            deliveryTertiaryTag: '',
            deliveryTagLists: {
                primary: ['题材'],
                secondary: ['载具'],
                tertiary: []
            },
            creativePrompts: [],
            creativeTableFileName: '',
            doubaoPromptTemplate: '',
            doubaoModelId: '',
            workflowPromptGeneration: {
                provider: 'lumos',
                lumos: {
                    model: '',
                    baseUrl: '',
                    provider: '',
                    promptTemplate: '',
                    apiKeyConfigured: false,
                    apiKeySource: ''
                }
            },
            legilGeneration: {
                imageModel: 'nano-banana-2',
                aspectRatio: '1:1',
                resolution: '2K',
                outputQuantity: 1
            },
            legilModelParameterProfiles: {},
            resizeLegilGeneration: {
                imageModel: 'nano-banana-2',
                aspectRatio: '1:1',
                aspectRatios: ['1:1', '16:9', '9:16'],
                resolution: '1K',
                outputQuantity: 1
            },
            resizeJimengGeneration: {
                imageModel: 'image-5-lite',
                aspectRatio: '16:9',
                aspectRatios: ['16:9'],
                resolution: '2k',
                outputQuantity: 4,
                concurrency: 1,
                pollTimeoutSeconds: 900
            },
            creativeLegilGeneration: {
                imageModel: 'nano-banana-2',
                aspectRatio: '1:1',
                resolution: '2K',
                outputQuantity: 4
            },
            creativePromptStyle: 'cinematic_photo',
            creativePromptStyleOptions: [
                { value: 'cinematic_photo', label: '电影感真实摄影质感' },
                { value: 'commercial_3d', label: '3D卡通商业广告海报' },
                { value: 'style_free', label: '不限风格' }
            ],
            notifications: {
                feishuEnabled: true,
                taskCompletionEnabled: true,
                serverStartupEnabled: true,
                staleProgressEnabled: true,
                staleThresholdMinutes: 30,
                notificationCooldownMinutes: 10,
                legilScreenshotEnabled: true,
                autoRecoveryEnabled: true,
                pauseOnConsecutiveFailures: true,
                consecutiveFailureThreshold: 5,
                watchdogAutoRestartEnabled: true
            }
        };

        const DEFAULT_LEGIL_PARAMETER_PROFILE = {
            defaultAspectRatio: '1:1',
            defaultResolution: '2K',
            defaultOutputQuantity: 1,
            aspectRatios: ['1:1', '1:4', '1:8', '2:3', '3:4', '4:5', '9:16', '21:9', '16:9', '5:4', '4:3', '3:2', '8:1', '4:1'],
            resolutions: ['512px', '1K', '2K', '4K'],
            outputQuantities: [1, 2, 3, 4],
            outputQuantityControl: 'button'
        };

        const GPT_IMAGE_LEGIL_PARAMETER_PROFILE = {
            defaultAspectRatio: '1:1',
            defaultResolution: '2K',
            defaultOutputQuantity: 1,
            aspectRatios: ['1:1', '2:3', '3:4', '4:5', '9:16', '16:9', '5:4', '4:3', '3:2', '智能比例'],
            resolutions: ['1K', '2K'],
            outputQuantities: [1, 2, 3, 4],
            outputQuantityControl: 'slider'
        };

        function getLegilModelParameterProfile(modelValue, profiles = config.legilModelParameterProfiles) {
            const model = String(modelValue || '').trim();
            const profile = profiles && profiles[model]
                ? profiles[model]
                : (['gpt-image-2', 'gpt-image-1'].includes(model)
                    ? GPT_IMAGE_LEGIL_PARAMETER_PROFILE
                    : DEFAULT_LEGIL_PARAMETER_PROFILE);
            return {
                defaultAspectRatio: profile.defaultAspectRatio || DEFAULT_LEGIL_PARAMETER_PROFILE.defaultAspectRatio,
                defaultResolution: profile.defaultResolution || DEFAULT_LEGIL_PARAMETER_PROFILE.defaultResolution,
                defaultOutputQuantity: Number(profile.defaultOutputQuantity) || DEFAULT_LEGIL_PARAMETER_PROFILE.defaultOutputQuantity,
                aspectRatios: Array.isArray(profile.aspectRatios) && profile.aspectRatios.length
                    ? profile.aspectRatios.slice()
                    : DEFAULT_LEGIL_PARAMETER_PROFILE.aspectRatios.slice(),
                resolutions: Array.isArray(profile.resolutions) && profile.resolutions.length
                    ? profile.resolutions.slice()
                    : DEFAULT_LEGIL_PARAMETER_PROFILE.resolutions.slice(),
                outputQuantities: Array.isArray(profile.outputQuantities) && profile.outputQuantities.length
                    ? profile.outputQuantities.slice()
                    : DEFAULT_LEGIL_PARAMETER_PROFILE.outputQuantities.slice(),
                outputQuantityControl: profile.outputQuantityControl || DEFAULT_LEGIL_PARAMETER_PROFILE.outputQuantityControl
            };
        }

        function normalizeLegilSettingsForModel(settings = {}, profiles = config.legilModelParameterProfiles) {
            const source = settings && typeof settings === 'object' ? settings : {};
            const imageModel = String(source.imageModel || 'nano-banana-2');
            const profile = getLegilModelParameterProfile(imageModel, profiles);
            const aspectRatio = profile.aspectRatios.includes(String(source.aspectRatio))
                ? String(source.aspectRatio)
                : profile.defaultAspectRatio;
            const resolution = profile.resolutions.includes(String(source.resolution))
                ? String(source.resolution)
                : profile.defaultResolution;
            const outputQuantityValue = Number(source.outputQuantity);
            const outputQuantity = profile.outputQuantities.includes(outputQuantityValue)
                ? outputQuantityValue
                : profile.defaultOutputQuantity;
            const rawAspectRatios = Array.isArray(source.aspectRatios) && source.aspectRatios.length
                ? source.aspectRatios
                : [aspectRatio];
            const aspectRatios = Array.from(new Set(rawAspectRatios.map(item => String(item || '').trim())))
                .filter(item => profile.aspectRatios.includes(item));

            return {
                ...source,
                imageModel,
                aspectRatio: aspectRatios[0] || aspectRatio,
                aspectRatios: aspectRatios.length ? aspectRatios : [aspectRatio],
                resolution,
                outputQuantity
            };
        }

        const folderDefaults = {
            referenceFolder: 'D:\\工作\\自动化工作流1\\批量产图\\输入',
            legilReferenceFolder: 'D:\\工作\\自动化工作流1\\批量产图\\参考图',
            saveFolder: 'D:\\工作\\自动化工作流1\\批量产图\\输出',
            tablePromptReferenceFolder: 'D:\\工作\\自动化工作流1\\批量产图\\参考图',
            tablePromptOutputFolder: 'D:\\工作\\自动化工作流1\\批量产图\\输出',
            resizeInputFolder: 'D:\\工作\\自动化工作流1\\改尺寸交付\\源图输入',
            resizeOutputFolder: 'D:\\工作\\自动化工作流1\\改尺寸交付\\输出',
            creativeOutputFolder: 'D:\\工作\\自动化工作流1\\创意拓展\\输出',
            creativeReferenceFolder: 'D:\\工作\\自动化工作流1\\创意拓展\\参考图',
            renameInputFolder: 'D:\\工作\\自动化工作流1\\创意拓展\\输出',
            renameOutputFolder: 'D:\\工作\\自动化工作流1\\创意拓展\\重命名输出',
            resizeBatchInputFolder: 'D:\\工作\\自动化工作流1\\创意拓展\\重命名输出',
            resizeBatchOutputFolder: 'D:\\工作\\自动化工作流1\\重命名\\本地标准化',
            logoBatchInputFolder: 'D:\\工作\\自动化工作流1\\重命名\\本地标准化',
            logoBatchOutputFolder: 'D:\\工作\\自动化工作流1\\重命名\\加LOGO',
            packageBatchInputFolder: 'D:\\工作\\自动化工作流1\\重命名\\加LOGO',
            packageBatchOutputFolder: 'D:\\工作\\自动化工作流1\\重命名\\一键打包',
            deliveryInputFolder: 'D:\\工作\\自动化工作流1\\改尺寸交付\\源图输入',
            deliveryOutputFolder: 'D:\\工作\\自动化工作流1\\改尺寸交付\\输出'
        };
        const folderHistoryKey = 'ai-image-automation-folder-history-v1';
        const folderHistoryLimit = 8;

        // SSE connection
        let eventSource = null;
        let progressInterval = null;
        let resizeStatusInterval = null;
        let resizeResumeInfo = null;
        let creativeStatusInterval = null;
        let creativeLastRunIndexes = [];
        let creativeResumeIndexes = [];
        let creativeResumeInfo = null;
        let creativeAgentFiles = [];
        let creativeAgentLastResult = null;
        let creativeAgentServerStatus = null;
        let creativeAgentCurrentRunId = '';
        let creativeAgentStatusInterval = null;
        let runCenterStatusInterval = null;
        let workflowResumeInfo = null;
        const maxLogEntries = 1000;

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            addLog('系统初始化完成', 'system');
            moveGlobalConfigCards();
            initFolderControls();
            connectLogStream();
            checkBrowserStatus();
            loadLegilRefFolderConfig();
            loadWorkflowConfig();
            loadNotificationConfig();
            loadDoubaoConfig();
            loadLegilGenerationConfig();
            loadCreativeConfig().finally(refreshCreativeResumeControls);
            loadCreativeAgentStatus();
            if (typeof initRunCenter === 'function') {
                initRunCenter();
            }
            if (typeof initTablePromptBatch === 'function') {
                initTablePromptBatch();
            }
            refreshWorkflowResumeControls();
            const promptTextarea = document.getElementById('doubaoPromptTemplate');
            if (promptTextarea) {
                promptTextarea.addEventListener('input', updateDoubaoPromptCount);
            }
            const lumosPromptTextarea = document.getElementById('lumosPromptTemplate');
            if (lumosPromptTextarea) {
                lumosPromptTextarea.addEventListener('input', updateLumosPromptCount);
            }
            if (typeof initDeliveryPage === 'function') {
                initDeliveryPage();
            }
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
