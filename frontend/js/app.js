/**
 * B站关注管理工具 - 主应用逻辑
 */
(function () {
    'use strict';

    // ==================== 状态管理 ====================
    const state = {
        userInfo: null,
        followings: [],          // 当前页关注列表
        allFollowings: [],       // 全量关注（分析用）
        analysisData: null,
        currentPage: 1,
        totalPages: 1,
        totalFollowings: 0,
        pageSize: 50,
        searchQuery: '',
        filterType: 'all',
        partitionFilter: 'all',  // 分区过滤
        fansFilter: 'all',       // 粉丝数过滤
        batchSelected: new Set(),
        batchFiltered: [],
        charts: {},              // Chart.js 实例
        enriched: false,         // 是否已加载详细数据
        enriching: false,        // 是否正在加载
        enrichedFollowings: [],  // 增强后的全量数据
        partitions: [],          // 可选分区列表
        sortType: 'default',     // 排序方式
    };

    // ==================== API 客户端 ====================
    const BASE_URL = 'http://localhost:8000/api';

    const api = {
        async request(endpoint, options = {}) {
            const url = `${BASE_URL}${endpoint}`;
            const res = await fetch(url, options);
            const data = await res.json();
            if (!res.ok || data.code !== 0) {
                throw new Error(data.message || data.detail || '请求失败');
            }
            return data;
        },

        async login(sessdata, bili_jct) {
            return this.request('/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessdata, bili_jct }),
            });
        },

        async getQrcode() {
            return this.request('/login/qrcode');
        },

        async pollQrcode(qrcodeKey) {
            return this.request(`/login/qrcode/poll?qrcode_key=${qrcodeKey}`);
        },

        async logout() {
            return this.request('/logout', { method: 'POST' });
        },

        async getUserInfo() {
            return this.request('/user/info');
        },

        async getFollowings(pn, ps, order = '') {
            return this.request(`/followings?pn=${pn}&ps=${ps}&order_type=${order}`);
        },

        async getAllFollowings(useCache = true) {
            return this.request(`/followings/all?use_cache=${useCache}`);
        },

        async analyzeFollowings() {
            return this.request('/followings/analyze');
        },

        async unfollow(fid) {
            return this.request('/unfollow', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fid }),
            });
        },

        async batchUnfollow(fids) {
            return this.request('/unfollow/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fids }),
            });
        },

        async batchRefreshEnrichment(mids) {
            return this.request('/followings/enrich/batch_refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mids }),
            });
        },

        async getUserCard(mid) {
            return this.request(`/user/card/${mid}`);
        },

        async startEnrichment() {
            return this.request('/followings/enrich', { method: 'POST' });
        },

        async stopEnrichment() {
            return this.request('/followings/enrich/stop', { method: 'POST' });
        },

        async getEnrichmentStatus() {
            return this.request('/followings/enrich/status');
        },

        async getEnrichedFollowings() {
            return this.request('/followings/enriched');
        },
    };

    // ==================== DOM 引用 ====================
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // ==================== 工具函数 ====================
    function showToast(message, type = 'info') {
        const container = $('#toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'toastOut 0.3s ease-in forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function formatNumber(n) {
        if (n >= 10000) return (n / 10000).toFixed(1) + '万';
        return n.toString();
    }

    function formatTime(timestamp) {
        if (!timestamp) return '未知';
        const d = new Date(timestamp * 1000);
        return d.toLocaleDateString('zh-CN');
    }

    function formatFans(n) {
        if (n < 0) return '未知';
        if (n >= 10000) return (n / 10000).toFixed(1) + '万粉';
        return n + '粉';
    }

    function matchTimeRange(timestamp, range) {
        if (range === 'all') return true;
        if (!timestamp || timestamp === 0) return false;

        const now = Date.now() / 1000;
        const diff = now - timestamp;
        const month = 30 * 86400;

        if (range === '1m') return diff < month;
        if (range === '1m-3m') return diff >= month && diff < 3 * month;
        if (range === '3m-6m') return diff >= 3 * month && diff < 6 * month;
        if (range === '6m-1y') return diff >= 6 * month && diff < 12 * month;
        if (range === 'gt1y') return diff >= 12 * month;
        return false;
    }

    function matchFansRange(fans, range) {
        if (range === 'all' || fans < 0) return true;
        switch (range) {
            case 'lt1k': return fans < 1000;
            case '1k-1w': return fans >= 1000 && fans < 10000;
            case '1w-10w': return fans >= 10000 && fans < 100000;
            case '10w-100w': return fans >= 100000 && fans < 1000000;
            case 'gt100w': return fans >= 1000000;
            default: return true;
        }
    }

    function debounce(fn, delay = 300) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    }

    // ==================== 视图切换 ====================
    function switchView(viewName) {
        $$('.view').forEach(v => v.classList.remove('active'));
        $$('.nav-item').forEach(n => n.classList.remove('active'));

        const view = $(`#view-${viewName}`);
        const nav = $(`[data-view="${viewName}"]`);
        if (view) view.classList.add('active');
        if (nav) nav.classList.add('active');

        // 按视图加载数据
        if (viewName === 'dashboard') loadDashboard();
        if (viewName === 'followlist') loadFollowList();
    }

    // ==================== Cookie 解析 ====================
    function parseCookieString(cookieStr) {
        const result = { sessdata: '', bili_jct: '' };
        if (!cookieStr) return result;

        // 支持多种格式：
        // 1. 标准 Cookie: "key1=val1; key2=val2"
        // 2. 每行一个: "key1=val1\nkey2=val2"
        // 3. 带引号的值
        const pairs = cookieStr
            .replace(/\n/g, '; ')
            .split(/;\s*/)
            .filter(Boolean);

        for (const pair of pairs) {
            const eqIdx = pair.indexOf('=');
            if (eqIdx === -1) continue;
            const key = pair.substring(0, eqIdx).trim();
            let val = pair.substring(eqIdx + 1).trim();
            // 去掉可能的引号
            if (val.startsWith('"') && val.endsWith('"')) {
                val = val.slice(1, -1);
            }

            if (key === 'SESSDATA') result.sessdata = val;
            if (key === 'bili_jct') result.bili_jct = val;
        }
        return result;
    }

    function maskValue(val) {
        if (!val) return '-';
        if (val.length <= 8) return val;
        return val.substring(0, 4) + '****' + val.substring(val.length - 4);
    }

    // ==================== 登录处理 ====================
    // ==================== 登录处理 ====================
    let qrcodeTimer = null;
    let loginPollTimer = null;

    function initLogin() {
        const form = $('#login-form');
        const cookieInput = $('#cookie-input');
        const parsedFields = $('#parsed-fields');
        const loginBtn = $('#login-btn');
        const tabs = $$('.login-tab');
        const contents = $$('.login-content');

        // Tab 切换
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tab;

                // 切换样式
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                contents.forEach(c => {
                    c.style.display = c.id === `tab-${target}` ? 'block' : 'none';
                    if (c.id === `tab-${target}`) c.classList.add('active');
                    else c.classList.remove('active');
                });

                // 逻辑处理
                if (target === 'qrcode') {
                    startQrcodeLogin();
                } else {
                    stopQrcodeLogin();
                }
            });
        });

        // 初始启动扫码
        if ($('.login-tab.active').dataset.tab === 'qrcode') {
            startQrcodeLogin();
        }

        // 刷新二维码
        $('#refresh-qrcode').addEventListener('click', startQrcodeLogin);

        // 实时解析 Cookie
        cookieInput.addEventListener('input', () => {
            const raw = cookieInput.value.trim();
            const parsed = parseCookieString(raw);

            const sessdataEl = $('#parsed-sessdata');
            const bilijctEl = $('#parsed-bilijct');
            const sessdataVal = $('#parsed-sessdata-val');
            const bilijctVal = $('#parsed-bilijct-val');

            if (!raw) {
                parsedFields.style.display = 'none';
                loginBtn.disabled = true;
                return;
            }

            parsedFields.style.display = 'flex';

            // SESSDATA 状态
            if (parsed.sessdata) {
                sessdataEl.className = 'parsed-item success';
                sessdataVal.textContent = maskValue(parsed.sessdata);
            } else {
                sessdataEl.className = 'parsed-item error';
                sessdataVal.textContent = '未找到';
            }

            // bili_jct 状态
            if (parsed.bili_jct) {
                bilijctEl.className = 'parsed-item success';
                bilijctVal.textContent = maskValue(parsed.bili_jct);
            } else {
                bilijctEl.className = 'parsed-item error';
                bilijctVal.textContent = '未找到';
            }

            // 两者都有才启用按钮
            loginBtn.disabled = !(parsed.sessdata && parsed.bili_jct);
        });

        // 提交登录
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const parsed = parseCookieString(cookieInput.value.trim());
            const errEl = $('#login-error');
            const btnText = form.querySelector('.btn-text');
            const btnLoading = form.querySelector('.btn-loading');

            if (!parsed.sessdata || !parsed.bili_jct) {
                errEl.textContent = 'Cookie中缺少 SESSDATA 或 bili_jct';
                return;
            }

            errEl.textContent = '';
            btnText.style.display = 'none';
            btnLoading.style.display = 'inline-flex';
            loginBtn.disabled = true;

            try {
                const result = await api.login(parsed.sessdata, parsed.bili_jct);
                state.userInfo = result.data;
                onLoginSuccess();
            } catch (err) {
                errEl.textContent = err.message;
            } finally {
                btnText.style.display = 'inline';
                btnLoading.style.display = 'none';
                loginBtn.disabled = false;
            }
        });
    }

    async function startQrcodeLogin() {
        stopQrcodeLogin();

        const qrBox = $('#login-qrcode');
        const statusEl = $('#qrcode-status');
        const mask = $('#qrcode-mask');
        const expire = $('#qrcode-expire');

        qrBox.innerHTML = '';
        mask.style.display = 'none';
        expire.style.display = 'none';
        statusEl.textContent = '正在获取二维码...';

        try {
            const res = await api.getQrcode();
            const { url, qrcode_key } = res.data;

            // 生成二维码
            new QRCode(qrBox, {
                text: url,
                width: 160,
                height: 160,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.L
            });

            statusEl.textContent = '请打开手机 Bilibili 扫码';

            // 开始轮询
            pollLoginStatus(qrcode_key);

        } catch (err) {
            statusEl.textContent = '获取二维码失败: ' + err.message;
        }
    }

    function stopQrcodeLogin() {
        if (loginPollTimer) {
            clearTimeout(loginPollTimer);
            loginPollTimer = null;
        }
    }

    async function pollLoginStatus(qrcodeKey) {
        try {
            const res = await api.request(`/login/qrcode/poll?qrcode_key=${qrcodeKey}`);
            const data = res.data;

            if (data.status === 'success') {
                $('#qrcode-mask').style.display = 'flex';
                $('#qrcode-status').textContent = '登录成功！正在跳转...';

                // 获取到的用户信息已在 data.user_info 中
                if (data.user_info) {
                    state.userInfo = data.user_info;
                    setTimeout(onLoginSuccess, 1000);
                } else {
                    // 如果没有用户信息，尝试重新获取
                    const info = await api.getUserInfo();
                    state.userInfo = info.data;
                    setTimeout(onLoginSuccess, 1000);
                }
                return;
            } else if (data.status === 'scanned') {
                $('#qrcode-mask').style.display = 'flex';
                $('#qrcode-status').textContent = '已扫描，请在手机上确认';
            } else if (data.status === 'expired') {
                $('#qrcode-expire').style.display = 'flex';
                $('#qrcode-status').textContent = '二维码已过期';
                return;
            }

            // 继续轮询
            loginPollTimer = setTimeout(() => pollLoginStatus(qrcodeKey), 2000);

        } catch (err) {
            console.error('Poll error:', err);
            // 失败重试
            loginPollTimer = setTimeout(() => pollLoginStatus(qrcodeKey), 3000);
        }
    }

    function onLoginSuccess() {
        // 更新侧边栏用户信息
        $('#sidebar-avatar').src = state.userInfo.face;
        $('#sidebar-username').textContent = state.userInfo.uname;
        $('#sidebar-uid').textContent = `UID: ${state.userInfo.mid}`;

        // 切换视图
        $('#login-view').classList.remove('active');
        $('#app-view').style.display = 'flex';

        showToast(`欢迎回来，${state.userInfo.uname}！`, 'success');
        loadDashboard();
    }

    // ==================== 仪表盘 ====================
    async function loadDashboard() {
        if (!state.userInfo) return;

        // 基础统计
        $('#stat-following-val').textContent = formatNumber(state.userInfo.following);
        $('#stat-follower-val').textContent = formatNumber(state.userInfo.follower);
        $('#stat-level-val').textContent = `Lv.${state.userInfo.level || 0}`;

        // 加载分析数据用于图表
        try {
            const analysisResp = await api.analyzeFollowings();
            state.analysisData = analysisResp.data;

            // 互关数量
            $('#stat-mutual-val').textContent = formatNumber(
                state.analysisData.relation_types?.mutual || 0
            );

            // 绘制图表
            renderDashboardCharts(state.analysisData);
        } catch (err) {
            console.warn('加载分析数据失败:', err);
            $('#stat-mutual-val').textContent = '-';
        }
    }

    function renderDashboardCharts(data) {
        // 配置 Chart.js 全局样式
        Chart.defaults.color = '#8b8ba0';
        Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
        Chart.defaults.font.family = "'Inter', sans-serif";

        // 认证分布饼图
        renderPieChart('chart-official', {
            labels: ['个人认证', '机构认证', '无认证'],
            data: [
                data.official_types?.personal || 0,
                data.official_types?.org || 0,
                data.official_types?.none || 0,
            ],
            colors: ['#00D1FF', '#7C5CFC', '#2a2a45'],
        });

        // 关注关系饼图
        renderPieChart('chart-relation', {
            labels: ['互相关注', '单向关注', '特别关注'],
            data: [
                data.relation_types?.mutual || 0,
                data.relation_types?.one_way || 0,
                data.relation_types?.special || 0,
            ],
            colors: ['#7C5CFC', '#FB7299', '#FFB347'],
        });
    }

    function renderPieChart(canvasId, { labels, data, colors, onClick }) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // 销毁旧图表
        if (state.charts[canvasId]) {
            state.charts[canvasId].destroy();
        }

        state.charts[canvasId] = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: colors,
                    borderWidth: 0,
                    hoverOffset: 8,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 16,
                            usePointStyle: true,
                            pointStyleWidth: 10,
                            font: { size: 12 },
                        },
                    },
                },
            },
        });

        if (onClick) {
            canvas.style.cursor = 'pointer';
            canvas.onclick = (evt) => {
                const points = state.charts[canvasId].getElementsAtEventForMode(evt, 'nearest', { intersect: true }, false);
                if (points.length > 0) {
                    onClick(labels[points[0].index]);
                }
            };
        }
    }

    function renderBarChart(canvasId, { labels, data, onClick }) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        if (state.charts[canvasId]) {
            state.charts[canvasId].destroy();
        }

        // 生成渐变色
        const colors = data.map((_, i) => {
            const hue = (i * 25 + 200) % 360;
            return `hsla(${hue}, 75%, 60%, 0.85)`;
        });

        state.charts[canvasId] = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: colors,
                    borderWidth: 0,
                    borderRadius: 4,
                }],
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#8b8ba0' },
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: '#e0e0e0', font: { size: 12 } },
                    },
                },
            },
        });

        if (onClick) {
            canvas.style.cursor = 'pointer';
            canvas.onclick = (evt) => {
                const points = state.charts[canvasId].getElementsAtEventForMode(evt, 'nearest', { intersect: true }, false);
                if (points.length > 0) {
                    onClick(labels[points[0].index]);
                }
            };
        }
    }

    // ==================== 关注列表 ====================
    async function loadFollowList() {
        const container = $('#follow-list-container');
        container.innerHTML = `
            <div class="loading-state">
                <span class="spinner large"></span>
                <p>加载关注列表中...</p>
            </div>`;

        try {
            // 尝试加载本地 Enriched 数据（如果尚未加载）
            if (!state.enriched) {
                try {
                    const resp = await api.getEnrichedFollowings();
                    const list = resp.data.list;
                    if (list && list.length > 0) {
                        state.allFollowings = list;
                        state.enrichedFollowings = list;
                        state.enriched = true;
                        // 优先使用后端返回的分区数据
                        if (resp.data.partitions && resp.data.partitions.length > 0) {
                            state.partitions = resp.data.partitions;
                        } else {
                            // 计算分区列表 (fallback)
                            const parts = new Set();
                            state.enrichedFollowings.forEach(f => {
                                if (f.main_partition) parts.add(f.main_partition);
                            });
                            state.partitions = Array.from(parts);
                        }

                        populatePartitionDropdowns();

                        // 更新 UI 状态
                        const progress = $('#enrich-progress');
                        if (progress) progress.style.display = 'none';
                        const enrichBtn = $('#load-enriched-btn');
                        if (enrichBtn) {
                            enrichBtn.disabled = false;
                            enrichBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> 全量刷新详情`;
                        }
                        $('#enrich-progress').style.display = 'none';
                        $('#follow-partition-filter').style.display = '';
                        $('#follow-fans-filter').style.display = '';
                        $('#follow-sort').style.display = '';
                        $('#follow-time-filter').style.display = '';
                    }
                } catch (e) {
                    console.log('No cached enriched data found, using normal mode');
                }
            }

            // 如果已有增强数据，使用客户端过滤和分页
            if (state.enriched && state.enrichedFollowings.length > 0) {
                renderEnrichedFollowList();
                return;
            }

            const resp = await api.getFollowings(state.currentPage, state.pageSize);
            state.followings = resp.data.list || [];
            state.totalFollowings = resp.data.total || 0;
            state.totalPages = Math.ceil(state.totalFollowings / state.pageSize);

            renderFollowList();
            renderPagination();
        } catch (err) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>加载失败: ${err.message}</p>
                </div>`;
            showToast(err.message, 'error');
        }
    }

    function getFilteredEnrichedList() {
        let list = [...state.enrichedFollowings];

        // 搜索过滤
        if (state.searchQuery) {
            const q = state.searchQuery.toLowerCase();
            list = list.filter(f =>
                f.uname?.toLowerCase().includes(q) ||
                f.sign?.toLowerCase().includes(q)
            );
        }
        // 基本过滤
        list = filterFollowings(list, state.filterType);
        // 分区过滤
        if (state.partitionFilter !== 'all') {
            list = list.filter(f => f.main_partition === state.partitionFilter);
        }
        // 粉丝数过滤
        if (state.fansFilter !== 'all') {
            list = list.filter(f => matchFansRange(f.fans ?? -1, state.fansFilter));
        }
        // 更新时间过滤
        if (state.timeFilter && state.timeFilter !== 'all') {
            list = list.filter(f => matchTimeRange(f.last_pub_time, state.timeFilter));
        }

        // 排序
        if (state.sortType !== 'default') {
            list.sort((a, b) => {
                const valA = (key) => (key === 'fans' ? (a.fans ?? -1) : (a.last_pub_time ?? 0));
                const valB = (key) => (key === 'fans' ? (b.fans ?? -1) : (b.last_pub_time ?? 0));

                switch (state.sortType) {
                    case 'fans_desc': return valB('fans') - valA('fans');
                    case 'fans_asc': return valA('fans') - valB('fans');
                    case 'pub_desc': return valB('pub') - valA('pub');
                    case 'pub_asc': return valA('pub') - valB('pub');
                    default: return 0;
                }
            });
        }
        return list;
    }

    function renderEnrichedFollowList() {
        const list = getFilteredEnrichedList();

        state.totalFollowings = list.length;
        state.totalPages = Math.ceil(list.length / state.pageSize);
        if (state.currentPage > state.totalPages) state.currentPage = 1;

        // 分页
        const start = (state.currentPage - 1) * state.pageSize;
        const pageList = list.slice(start, start + state.pageSize);

        const container = $('#follow-list-container');
        if (pageList.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5-2 4-2 4 2 4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                    <p>没有找到匹配的关注 (共${state.enrichedFollowings.length}人)</p>
                </div>`;
        } else {
            container.innerHTML = pageList.map(f => createFollowCard(f)).join('');

            // 绑定事件
            bindFollowItemEvents(container);
        }
        renderPagination();
        updateSelectionUI();
    }

    function bindFollowItemEvents(container) {
        // 取关按钮
        container.querySelectorAll('.btn-unfollow').forEach(btn => {
            btn.addEventListener('click', () => {
                const mid = parseInt(btn.dataset.mid);
                const name = btn.dataset.name;
                confirmUnfollow(mid, name);
            });
        });

        // 复选框
        container.querySelectorAll('.follow-item-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const mid = parseInt(e.target.dataset.mid);
                if (e.target.checked) {
                    state.selectedMids.add(mid);
                } else {
                    state.selectedMids.delete(mid);
                }
                updateSelectionUI();
            });
        });
    }

    function renderFollowList() {
        const container = $('#follow-list-container');
        let list = state.followings;

        // 搜索过滤
        if (state.searchQuery) {
            const q = state.searchQuery.toLowerCase();
            list = list.filter(f =>
                f.uname?.toLowerCase().includes(q) ||
                f.sign?.toLowerCase().includes(q)
            );
        }

        // 类型过滤
        list = filterFollowings(list, state.filterType);

        if (list.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5-2 4-2 4 2 4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                    <p>没有找到匹配的关注</p>
                </div>`;
            return;
        }

        container.innerHTML = list.map(f => createFollowCard(f)).join('');

        bindFollowItemEvents(container);
        updateSelectionUI();
    }

    function filterFollowings(list, type) {
        switch (type) {
            case 'mutual':
                return list.filter(f => f.attribute === 6);
            case 'one_way':
                return list.filter(f => f.attribute !== 6);
            case 'special':
                return list.filter(f => f.special === 1);
            case 'official':
                return list.filter(f => {
                    const t = f.official_verify?.type;
                    return t === 0 || t === 1;
                });
            case 'vip':
                return list.filter(f => f.vip?.vipType > 0);
            default:
                return list;
        }
    }

    function createFollowCard(f) {
        const tags = [];
        if (f.attribute === 6) tags.push('<span class="tag tag-mutual">互关</span>');
        if (f.special === 1) tags.push('<span class="tag tag-special">特别关注</span>');
        if (f.official_verify?.type === 0) tags.push('<span class="tag tag-official">个人认证</span>');
        if (f.official_verify?.type === 1) tags.push('<span class="tag tag-official">机构认证</span>');
        if (f.vip?.vipType === 2) tags.push('<span class="tag tag-vip">年度大会员</span>');
        else if (f.vip?.vipType === 1) tags.push('<span class="tag tag-vip">月度大会员</span>');

        // 增强数据标签
        const metaTags = [];
        if (f.main_partition) {
            metaTags.push(`<span class="tag tag-partition">${f.main_partition}</span>`);
        }
        if (f.fans !== undefined && f.fans >= 0) {
            metaTags.push(`<span class="tag tag-fans">${formatFans(f.fans)}</span>`);
        }
        if (f.last_pub_time) {
            const date = formatTime(f.last_pub_time);
            metaTags.push(`<span class="tag tag-time">最晚更新: ${date}</span>`);
        }

        const sign = f.sign ? f.sign.substring(0, 50) : '暂无签名';
        const followDate = f.mtime ? `关注于 ${formatTime(f.mtime)}` : '';

        const isSelected = state.selectedMids.has(f.mid);

        return `
        <div class="follow-card" data-mid="${f.mid}" style="position:relative; padding-left: 40px;">
            <div class="card-select" style="position:absolute; left:12px; top:50%; transform:translateY(-50%); z-index:10;">
                 <input type="checkbox" class="follow-item-checkbox" data-mid="${f.mid}" ${isSelected ? 'checked' : ''} style="transform:scale(1.2); cursor:pointer;">
            </div>
            <img class="follow-avatar" src="${f.face}" alt="${f.uname}" loading="lazy"
                 onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%232a2a45%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2260%22 text-anchor=%22middle%22 fill=%22%238b8ba0%22 font-size=%2240%22>${f.uname?.[0] || '?'}</text></svg>'">
            <div class="follow-info">
                <div class="follow-name">
                    <a href="https://space.bilibili.com/${f.mid}" target="_blank" style="color:var(--text-primary);text-decoration:none;">${f.uname}</a>
                </div>
                <div class="follow-sign" title="${f.sign || ''}">${sign}</div>
                <div class="follow-tags">${tags.join('')}${followDate ? `<span class="tag" style="color:var(--text-muted);font-size:0.65rem;">${followDate}</span>` : ''}</div>
                ${metaTags.length ? `<div class="follow-meta-row">${metaTags.join('')}</div>` : ''}
            </div>
            <div class="follow-actions">
                <button class="btn-unfollow" data-mid="${f.mid}" data-name="${f.uname}">取关</button>
            </div>
        </div>`;
    }

    // 更新选择UI状态（全选框和批量按钮）
    function updateSelectionUI() {
        // 当前展示列表（全量或过滤后的全量，非分页也可以）
        // 注意：全选是指当前符合筛选条件的所有项，不仅仅是当前页
        let currentList = [];
        if (state.enriched) {
            // 筛选后的列表
            const list = state.enrichedFollowings;
            // 应用了所有筛选条件吗？ renderEnrichedFollowList 里我们是在渲染前 slice
            // 我们需要 access 到 `filteredList`。
            // 由于 renderEnrichedFollowList 内部 logic 是局部变量，我们需要把 filteredResult 存到 state 或者在这里重新计算？
            // 重新计算太浪费。应该在 render 时把 currentFilteredList 存一下。
        }

        const count = state.selectedMids.size;
        const unfollowBtn = $('#follow-batch-unfollow');
        if (unfollowBtn) {
            unfollowBtn.disabled = count === 0;
            unfollowBtn.textContent = count > 0 ? `取关 (${count})` : '批量取关';
        }
        const refreshBtn = $('#follow-batch-refresh');
        if (refreshBtn) {
            refreshBtn.disabled = count === 0;
            refreshBtn.textContent = count > 0 ? `刷新 (${count})` : '批量刷新';
        }

        // 更新全选框状态
        const selectAll = $('#follow-select-all');
        if (selectAll) {
            // 如果当前列表所有项都在 selectedMids 中，则全选
            // 这里逻辑稍微复杂，待会在 render 里调用 updateSelectionUI 时传入 list
        }
    }

    function renderPagination() {
        const container = $('#follow-pagination');
        if (state.totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        let html = '';
        const current = state.currentPage;
        const total = state.totalPages;

        // 上一页
        html += `<button class="page-btn" ${current <= 1 ? 'disabled' : ''} data-page="${current - 1}">‹</button>`;

        // 页码
        const range = getPageRange(current, total);
        for (const p of range) {
            if (p === '...') {
                html += `<span class="page-btn" style="cursor:default;border:none;">…</span>`;
            } else {
                html += `<button class="page-btn ${p === current ? 'active' : ''}" data-page="${p}">${p}</button>`;
            }
        }

        // 下一页
        html += `<button class="page-btn" ${current >= total ? 'disabled' : ''} data-page="${current + 1}">›</button>`;

        container.innerHTML = html;

        container.querySelectorAll('.page-btn[data-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = parseInt(btn.dataset.page);
                if (page >= 1 && page <= total) {
                    state.currentPage = page;
                    loadFollowList();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            });
        });
    }

    function getPageRange(current, total) {
        if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
        const pages = [];
        pages.push(1);
        if (current > 3) pages.push('...');
        for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
            pages.push(i);
        }
        if (current < total - 2) pages.push('...');
        pages.push(total);
        return pages;
    }

    // ==================== 单个取关 ====================
    function confirmUnfollow(mid, name) {
        const modal = $('#confirm-modal');
        $('#confirm-title').textContent = '确认取消关注';
        $('#confirm-message').textContent = `确定要取消关注 "${name}" 吗？`;
        modal.style.display = 'flex';

        const okBtn = $('#confirm-ok');
        const cancelBtn = $('#confirm-cancel');

        const cleanup = () => {
            modal.style.display = 'none';
            okBtn.replaceWith(okBtn.cloneNode(true));
            cancelBtn.replaceWith(cancelBtn.cloneNode(true));
        };

        $('#confirm-cancel').addEventListener('click', cleanup, { once: true });
        $('#confirm-ok').addEventListener('click', async () => {
            cleanup();
            try {
                await api.unfollow(mid);
                showToast(`已取消关注 ${name}`, 'success');
                // 从列表中移除
                const card = document.querySelector(`.follow-card[data-mid="${mid}"]`);
                if (card) {
                    card.style.animation = 'fadeOut 0.3s ease forwards';
                    setTimeout(() => card.remove(), 300);
                }
                state.totalFollowings--;
                if (state.userInfo) state.userInfo.following--;
                // 同步移除增强数据
                if (state.enrichedFollowings) {
                    state.enrichedFollowings = state.enrichedFollowings.filter(f => f.mid !== mid);
                }
            } catch (err) {
                showToast(`取关失败: ${err.message}`, 'error');
            }
        }, { once: true });
    }

    // ==================== 数据分析 ====================
    async function loadAnalysis() {
        const statusEl = $('#analysis-status');
        const contentEl = $('#analysis-content');
        const btn = $('#load-analysis');

        statusEl.textContent = '正在加载全部关注数据，请稍候...';
        btn.disabled = true;

        try {
            // 先加载全量关注
            const allResp = await api.getAllFollowings(false);
            state.allFollowings = allResp.data || [];

            // 请求分析
            const analysisResp = await api.analyzeFollowings();
            state.analysisData = analysisResp.data;

            statusEl.textContent = `✅ 分析完成，共 ${state.analysisData.total} 个关注`;
            contentEl.style.display = 'block';

            renderAnalysis(state.analysisData);
        } catch (err) {
            statusEl.textContent = `❌ 加载失败: ${err.message}`;
            showToast(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    function renderAnalysis(data) {
        // 基础摘要
        $('#analysis-total').textContent = data.total;
        $('#analysis-special').textContent = data.relation_types?.special || 0;

        // 增强统计
        const partDist = data.partition_distribution || {};
        const validParts = Object.entries(partDist).filter(([k]) => k !== '未知' && k !== '获取失败');
        if (validParts.length > 0) {
            $('#analysis-partitions').textContent = validParts.length;
            const topPart = validParts.reduce((a, b) => a[1] > b[1] ? a : b);
            $('#analysis-top-partition').textContent = topPart[0];
        }

        // 最多粉丝的UP主
        const enriched = state.enrichedFollowings || [];
        const withFans = enriched.filter(f => f.fans != null && f.fans >= 0);
        if (withFans.length > 0) {
            const topUp = withFans.reduce((a, b) => a.fans > b.fans ? a : b);
            $('#analysis-max-fans').textContent = topUp.uname || formatFans(topUp.fans);
        }

        // 图表
        renderDetailCharts(data);
    }

    function renderDetailCharts(data) {
        Chart.defaults.color = '#8b8ba0';
        Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';

        // 时间趋势图
        const timeDist = data.time_distribution || {};
        const timeLabels = Object.keys(timeDist);
        const timeValues = Object.values(timeDist);

        if (state.charts['chart-timeline']) state.charts['chart-timeline'].destroy();
        state.charts['chart-timeline'] = new Chart($('#chart-timeline'), {
            type: 'bar',
            data: {
                labels: timeLabels,
                datasets: [{
                    label: '关注人数',
                    data: timeValues,
                    backgroundColor: 'rgba(251, 114, 153, 0.6)',
                    borderColor: '#FB7299',
                    borderWidth: 1,
                    borderRadius: 4,
                    maxBarThickness: 24,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            maxRotation: 45,
                            font: { size: 10 },
                        },
                    },
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0,
                            font: { size: 11 },
                        },
                    },
                },
            },
        });

        // 认证分布
        renderPieChart('chart-official-detail', {
            labels: ['个人认证', '机构认证', '无认证'],
            data: [
                data.official_types?.personal || 0,
                data.official_types?.org || 0,
                data.official_types?.none || 0,
            ],
            colors: ['#00D1FF', '#7C5CFC', '#2a2a45'],
        });

        // 大会员分布
        renderPieChart('chart-vip', {
            labels: ['年度大会员', '月度大会员', '非大会员'],
            data: [
                data.vip_types?.yearly || 0,
                data.vip_types?.monthly || 0,
                data.vip_types?.none || 0,
            ],
            colors: ['#FFB347', '#FC9DB7', '#2a2a45'],
        });

        // 关系分布
        renderPieChart('chart-relation-detail', {
            labels: ['互相关注', '单向关注', '特别关注'],
            data: [
                data.relation_types?.mutual || 0,
                data.relation_types?.one_way || 0,
                data.relation_types?.special || 0,
            ],
            colors: ['#7C5CFC', '#FB7299', '#FFB347'],
        });

        // 分区分布（横向柱状图，去掉"未知"和"获取失败"）
        const partData = data.partition_distribution || {};
        const partEntries = Object.entries(partData)
            .filter(([k]) => k !== '未知' && k !== '获取失败')
            .slice(0, 15); // 最多显示15个
        if (partEntries.length > 0) {
            renderBarChart('chart-partition', {
                labels: partEntries.map(([k]) => k),
                data: partEntries.map(([, v]) => v),
                onClick: (label) => {
                    // 跳转到关注列表并设置分区过滤
                    state.partitionFilter = label;
                    state.currentPage = 1;
                    $('#follow-partition-filter').value = label;
                    switchView('followlist');
                    if (state.enriched) renderEnrichedFollowList();
                },
            });
        }

        // 粉丝数分布
        const fansData = data.fans_distribution || {};
        const fansEntries = Object.entries(fansData).filter(([k]) => k !== '未知');
        // 标签到过滤值的映射
        const fansLabelToFilter = {
            '< 1千': 'lt1k',
            '1千~1万': '1k-1w',
            '1万~10万': '1w-10w',
            '10万~100万': '10w-100w',
            '> 100万': 'gt100w',
        };
        if (fansEntries.length > 0) {
            renderPieChart('chart-fans', {
                labels: fansEntries.map(([k]) => k),
                data: fansEntries.map(([, v]) => v),
                colors: ['#4fc3f7', '#7C5CFC', '#FFB347', '#FB7299', '#00D1FF'],
                onClick: (label) => {
                    const filterVal = fansLabelToFilter[label] || 'all';
                    state.fansFilter = filterVal;
                    state.currentPage = 1;
                    $('#follow-fans-filter').value = filterVal;
                    switchView('followlist');
                    if (state.enriched) renderEnrichedFollowList();
                },
            });
        }

        // 投稿时间分布
        const pubData = data.pub_time_distribution || {};
        // 映射
        const pubLabelMap = {
            'within_1m': '1个月内更新',
            '1m_3m': '1~3个月未更新',
            '3m_6m': '3~6个月未更新',
            '6m_1y': '6个月~1年未更新',
            'gt_1y': '1年以上未更新',
        };
        const pubFilterMap = {
            'within_1m': '1m',
            '1m_3m': '1m-3m',
            '3m_6m': '3m-6m',
            '6m_1y': '6m-1y',
            'gt_1y': 'gt1y',
        };
        const pubLabels = ['within_1m', '1m_3m', '3m_6m', '6m_1y', 'gt_1y']
            .filter(k => pubData[k] > 0);

        if (pubLabels.length > 0) {
            renderBarChart('chart-pub-time', {
                labels: pubLabels.map(k => pubLabelMap[k]),
                data: pubLabels.map(k => pubData[k]),
                onClick: (label) => {
                    // 反向查找key
                    const key = Object.keys(pubLabelMap).find(k => pubLabelMap[k] === label);
                    if (key) {
                        const filterVal = pubFilterMap[key] || 'all';
                        state.timeFilter = filterVal;
                        state.currentPage = 1;
                        $('#follow-time-filter').value = filterVal;
                        switchView('followlist');
                        if (state.enriched) renderEnrichedFollowList();
                    }
                }
            });
        }
    }

    // ==================== 批量管理 ====================
    async function applyBatchFilter() {
        const filters = {
            specialFollow: $('#filter-special-follow').checked,
            normalFollow: $('#filter-normal-follow').checked,
            missingEnrich: $('#filter-missing-enrich') ? $('#filter-missing-enrich').checked : false,
            partition: $('#batch-partition-filter').value,
            fansRange: $('#batch-fans-filter').value,
            timeRange: $('#batch-time-filter').value,
        };

        // 确保已加载全量数据
        const sourceData = state.enriched ? state.enrichedFollowings : state.allFollowings;
        if (sourceData.length === 0) {
            showToast('正在加载关注列表...', 'info');
            try {
                const resp = await api.getAllFollowings(true);
                state.allFollowings = resp.data || [];
            } catch (err) {
                showToast(`加载失败: ${err.message}`, 'error');
                return;
            }
        }

        let filtered = [...(state.enriched ? state.enrichedFollowings : state.allFollowings)];

        // 特别/普通关注 过滤
        if (filters.specialFollow && !filters.normalFollow) {
            filtered = filtered.filter(f => f.special === 1);
        } else if (!filters.specialFollow && filters.normalFollow) {
            filtered = filtered.filter(f => f.special !== 1);
        }
        // 如果都选或都不选，则不过滤此项

        // 详细数据为空 过滤
        if (filters.missingEnrich) {
            filtered = filtered.filter(f => {
                const noFans = f.fans === undefined || f.fans === -1;
                const noPartition = !f.main_partition || f.main_partition === '未知' || f.main_partition === '获取失败';
                // 只要粉丝数或分区数据缺失/无效，就视为数据为空
                return noFans || noPartition;
            });
        }

        // 高级过滤：分区
        if (filters.partition !== 'all') {
            filtered = filtered.filter(f => f.main_partition === filters.partition);
        }
        // 高级过滤：粉丝数
        if (filters.fansRange !== 'all') {
            filtered = filtered.filter(f => matchFansRange(f.fans ?? -1, filters.fansRange));
        }
        // 高级过滤：更新时间
        if (filters.timeRange !== 'all') {
            filtered = filtered.filter(f => matchTimeRange(f.last_pub_time, filters.timeRange));
        }

        state.batchFiltered = filtered;
        state.batchSelected = new Set(filtered.map(f => f.mid));

        renderBatchList();
    }

    function renderBatchList() {
        const results = $('#batch-results');
        const listEl = $('#batch-list');
        results.style.display = 'block';

        if (state.batchFiltered.length === 0) {
            listEl.innerHTML = '<div class="empty-state"><p>没有匹配条件的关注</p></div>';
            updateBatchCount();
            return;
        }

        listEl.innerHTML = state.batchFiltered.map(f => {
            const selected = state.batchSelected.has(f.mid);
            const tags = [];
            if (f.attribute === 6) tags.push('<span class="tag tag-mutual" style="font-size:0.65rem;">互关</span>');
            if (f.official_verify?.type >= 0 && f.official_verify?.type <= 1) {
                tags.push('<span class="tag tag-official" style="font-size:0.65rem;">认证</span>');
            }

            return `
            <div class="batch-item ${selected ? 'selected' : ''}" data-mid="${f.mid}">
                <div class="batch-check"></div>
                <img src="${f.face}" alt="${f.uname}" loading="lazy"
                     onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%232a2a45%22 width=%22100%22 height=%22100%22/></svg>'">
                <div class="batch-item-info">
                    <div class="batch-item-name">${f.uname}</div>
                    <div class="batch-item-tags">${tags.join('')}</div>
                </div>
            </div>`;
        }).join('');

        // 绑定点击切换
        listEl.querySelectorAll('.batch-item').forEach(item => {
            item.addEventListener('click', () => {
                const mid = parseInt(item.dataset.mid);
                if (state.batchSelected.has(mid)) {
                    state.batchSelected.delete(mid);
                    item.classList.remove('selected');
                } else {
                    state.batchSelected.add(mid);
                    item.classList.add('selected');
                }
                updateBatchCount();
            });
        });

        updateBatchCount();
    }

    function updateBatchCount() {
        const count = state.batchSelected.size;
        $('#batch-count').textContent = `已选择 ${count} 个用户`;
        const actionDisabled = count === 0;
        $('#batch-unfollow-btn').disabled = actionDisabled;
        if ($('#batch-refresh-btn')) {
            $('#batch-refresh-btn').disabled = actionDisabled;
        }
    }

    function selectAllBatch() {
        state.batchSelected = new Set(state.batchFiltered.map(f => f.mid));
        $$('.batch-item').forEach(item => item.classList.add('selected'));
        updateBatchCount();
    }

    function deselectAllBatch() {
        state.batchSelected.clear();
        $$('.batch-item').forEach(item => item.classList.remove('selected'));
        updateBatchCount();
    }

    async function executeBatchUnfollow() {
        const fids = Array.from(state.batchSelected);
        if (fids.length === 0) return;

        const modal = $('#confirm-modal');
        $('#confirm-title').textContent = '⚠️ 批量取关确认';
        $('#confirm-message').textContent = `确定要取消关注选中的 ${fids.length} 个用户吗？此操作不可撤销！`;
        modal.style.display = 'flex';

        const okBtn = $('#confirm-ok');
        const cancelBtn = $('#confirm-cancel');

        const cleanup = () => {
            modal.style.display = 'none';
            okBtn.replaceWith(okBtn.cloneNode(true));
            cancelBtn.replaceWith(cancelBtn.cloneNode(true));
        };

        $('#confirm-cancel').addEventListener('click', cleanup, { once: true });
        $('#confirm-ok').addEventListener('click', async () => {
            cleanup();
            await runBatchUnfollow(fids);
        }, { once: true });
    }

    async function runBatchUnfollow(fids) {
        const progressEl = $('#batch-progress');
        const progressBar = $('#progress-bar');
        const progressText = $('#progress-text');
        const progressLog = $('#progress-log');

        progressEl.style.display = 'block';
        progressLog.innerHTML = '';

        const total = fids.length;
        let completed = 0;
        let success = 0;
        let failed = 0;

        // 逐个发送取关请求（避免触发风控）
        for (const fid of fids) {
            try {
                await api.unfollow(fid);
                success++;
                const name = state.batchFiltered.find(f => f.mid === fid)?.uname || fid;
                progressLog.innerHTML += `<div class="log-success">✓ 已取关 ${name}</div>`;
            } catch (err) {
                failed++;
                const name = state.batchFiltered.find(f => f.mid === fid)?.uname || fid;
                progressLog.innerHTML += `<div class="log-error">✗ 取关 ${name} 失败: ${err.message}</div>`;
            }

            completed++;
            const pct = Math.round((completed / total) * 100);
            progressBar.style.width = pct + '%';
            progressText.textContent = `${completed} / ${total}`;
            progressLog.scrollTop = progressLog.scrollHeight;

            // 延迟防风控
            if (completed < total) {
                await new Promise(r => setTimeout(r, 1200));
            }
        }

        showToast(`批量取关完成: ${success} 成功, ${failed} 失败`, success > 0 ? 'success' : 'error');

        // 清除缓存，重新加载
        state.allFollowings = [];
        state.batchFiltered = [];
        state.batchSelected.clear();
        $('#batch-results').style.display = 'none';

        // 同步更新enriched数据
        if (state.enriched && state.enrichedFollowings.length > 0) {
            const removedSet = new Set(fids.filter((_, i) => i < success));
            state.enrichedFollowings = state.enrichedFollowings.filter(f => !removedSet.has(f.mid));
        }

        if (state.userInfo) {
            state.userInfo.following -= success;
        }
    }

    // ==================== 数据增强 ====================
    async function startEnrichment() {
        if (state.enriching) return;
        state.enriching = true;

        const btn = $('#load-enriched-btn');
        const progress = $('#enrich-progress');
        const bar = $('#enrich-bar');
        const text = $('#enrich-progress-text');

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> 正在连接B站...';
        progress.style.display = 'flex';

        try {
            await api.startEnrichment();
            pollEnrichmentStatus();
        } catch (err) {
            showToast('启动增强失败: ' + err.message, 'error');
            btn.disabled = false;
            btn.innerHTML = '从B站刷新';
            progress.style.display = 'none';
            state.enriching = false;
        }
    }

    async function stopEnrichment() {
        try {
            await api.stopEnrichment();
            showToast('已停止加载，已获取的数据已保存', 'info');
        } catch (err) {
            showToast('停止失败: ' + err.message, 'error');
        }
        const btn = $('#load-enriched-btn');
        btn.disabled = false;
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> 继续加载`;
        $('#enrich-progress').style.display = 'none';
        state.enriching = false;
    }

    let _lastPartialFetch = 0;

    let _pollIdleCount = 0;
    async function pollEnrichmentStatus() {
        const bar = $('#enrich-bar');
        const text = $('#enrich-progress-text');
        const btn = $('#load-enriched-btn');
        const progress = $('#enrich-progress');

        try {
            const resp = await api.getEnrichmentStatus();
            const s = resp.data;

            if (s.status === 'running') {
                _pollIdleCount = 0; // 重置计数器
                const pct = s.total > 0 ? Math.round((s.current / s.total) * 100) : 0;
                if (bar) bar.style.width = pct + '%';
                if (text) text.textContent = `正在从B站刷新... ${s.current}/${s.total} (${pct}%)`;

                // 更新批量操作进度条（如果可见）
                const batchProgress = $('#batch-progress');
                if (batchProgress && batchProgress.offsetParent) {
                    const pb = $('#progress-bar');
                    const pt = $('#progress-text');
                    if (pb) pb.style.width = pct + '%';
                    if (pt) pt.textContent = `${s.current} / ${s.total}`;
                }

                // 每10秒拉取一次部分数据
                const now = Date.now();
                if (now - _lastPartialFetch > 10000 && s.current > 0) {
                    _lastPartialFetch = now;
                    loadPartialEnrichedData();
                }

                setTimeout(pollEnrichmentStatus, 2000);
            } else if (s.status === 'done') {
                _pollIdleCount = 0;
                state.enriching = false;
                onEnrichmentComplete();

                // 批量操作完成
                const batchProgress = $('#batch-progress');
                if (batchProgress && batchProgress.offsetParent) {
                    batchProgress.style.display = 'none';
                    showToast('批量刷新完成！', 'success');
                    await applyBatchFilter();
                }
            } else if (s.status === 'error' || s.status === 'cancelled') {
                _pollIdleCount = 0;
                state.enriching = false;
                loadPartialEnrichedData();
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> 从B站刷新`;
                }
                if (progress) progress.style.display = 'none';

                const batchProgress = $('#batch-progress');
                if (batchProgress && batchProgress.offsetParent) {
                    batchProgress.style.display = 'none';
                    showToast(s.status === 'cancelled' ? '已停止刷新' : '刷新出错', 'warning');
                }
            } else {
                // idle 状态：可能是初始化中，最多等待 3 次
                _pollIdleCount++;
                if (_pollIdleCount <= 3) {
                    setTimeout(pollEnrichmentStatus, 2000);
                } else {
                    // 超过等待次数，认为任务未启动，停止轮询
                    _pollIdleCount = 0;
                    state.enriching = false;
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> 从B站刷新`;
                    }
                    if (progress) progress.style.display = 'none';
                }
            }
        } catch (err) {
            showToast('查询进度失败: ' + err.message, 'error');
            state.enriching = false;
            if (btn) btn.disabled = false;
            if (progress) progress.style.display = 'none';
        }
    }

    async function executeBatchRefresh() {
        const mids = Array.from(state.batchSelected);
        if (mids.length === 0) return;

        const btn = $('#batch-refresh-btn');
        btn.disabled = true;

        try {
            await api.batchRefreshEnrichment(mids);

            // 显示进度 UI
            const progressBar = $('#batch-progress');
            progressBar.style.display = 'block';
            progressBar.querySelector('h3').textContent = '正在刷新数据...';
            $('#progress-text').textContent = `0 / ${mids.length}`;
            $('#progress-bar').style.width = '0%';
            $('#progress-log').innerHTML = '';

            // 复用 enrich 状态监控
            state.enriching = true;
            pollEnrichmentStatus();

        } catch (err) {
            showToast('启动刷新失败: ' + err.message, 'error');
            btn.disabled = false;
        }
    }

    async function loadPartialEnrichedData() {
        try {
            const resp = await api.getEnrichedFollowings();
            state.enrichedFollowings = resp.data.list || [];
            state.partitions = resp.data.partitions || [];
            state.enriched = true;

            // 更新分区下拉
            populatePartitionDropdowns();

            // 显示过滤器
            $('#follow-partition-filter').style.display = '';
            $('#follow-fans-filter').style.display = '';
            $('#follow-sort').style.display = '';

            // 刷新列表
            renderEnrichedFollowList();
        } catch (err) {
            // 静默失败，部分数据可能还没准备好
        }
    }

    async function onEnrichmentComplete() {
        const btn = $('#load-enriched-btn');
        const progress = $('#enrich-progress');

        try {
            const resp = await api.getEnrichedFollowings();
            state.enrichedFollowings = resp.data.list || [];
            state.partitions = resp.data.partitions || [];
            state.enriched = true;
            state.enriching = false;

            // 更新分区下拉菜单
            populatePartitionDropdowns();

            // 显示分区/粉丝数过滤器
            $('#follow-partition-filter').style.display = '';
            $('#follow-fans-filter').style.display = '';
            $('#follow-sort').style.display = '';
            $('#follow-time-filter').style.display = '';

            // 更新批量管理提示
            const tag = $('#batch-enrich-tag');
            if (tag) {
                tag.textContent = '✓ 已加载';
                tag.style.color = 'var(--color-success)';
            }

            // 刷新主列表视图
            renderEnrichedFollowList();

            // 刷新批量管理列表
            applyBatchFilter();

            btn.disabled = false;
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> 从B站刷新`;
            progress.style.display = 'none';

            showToast('详细数据加载完成', 'success');

            // 重新渲染关注列表
            state.currentPage = 1;
            loadFollowList();

            // 检查数据完整性（是否包含新字段）
            const hasMissingFields = state.enrichedFollowings.some(f =>
                (f.fans >= 0 && f.total_videos > 0 && !f.last_pub_time)
            );

            if (hasMissingFields) {
                showToast('发现部分数据缺少更新时间，请重新点击"加载详细数据"进行补全', 'info');
                // 强制显示加载按钮
                btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> 补全数据`;
                btn.disabled = false;
                $('#batch-enrich-tag').textContent = '⚠ 数据不全';
                $('#batch-enrich-tag').style.color = 'var(--color-warning)';
            }

        } catch (err) {
            showToast('获取增强数据失败: ' + err.message, 'error');
            btn.disabled = false;
            btn.innerHTML = '加载详细数据';
            progress.style.display = 'none';
            state.enriching = false;
        }
    }

    function populatePartitionDropdowns() {
        const options = state.partitions.map(p => `<option value="${p}">${p}</option>`).join('');
        const baseOptions = '<option value="all">全部分区</option>' + options;

        // 关注列表的分区下拉
        const followSelect = $('#follow-partition-filter');
        followSelect.innerHTML = baseOptions;
        followSelect.value = state.partitionFilter;

        // 批量管理的分区下拉
        const batchSelect = $('#batch-partition-filter');
        batchSelect.innerHTML = baseOptions;
    }

    // ==================== 事件绑定 ====================
    function initEventListeners() {
        // 侧边栏导航
        $$('.nav-item').forEach(nav => {
            nav.addEventListener('click', (e) => {
                e.preventDefault();
                switchView(nav.dataset.view);
            });
        });

        // 登出
        $('#logout-btn').addEventListener('click', async () => {
            try {
                await api.logout();
            } catch (e) { /* ignore */ }
            state.userInfo = null;
            state.allFollowings = [];
            state.followings = [];
            state.analysisData = null;
            state.enriched = false;
            state.enriching = false;
            state.enrichedFollowings = [];
            state.partitions = [];
            state.partitionFilter = 'all';
            state.fansFilter = 'all';
            $('#app-view').style.display = 'none';
            $('#login-view').classList.add('active');
            // 清空表单
            $('#cookie-input').value = '';
            $('#parsed-fields').style.display = 'none';
            $('#login-btn').disabled = true;
            // 重置UI
            const enrichBtn = $('#load-enriched-btn');
            enrichBtn.disabled = false;
            enrichBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> 加载详细数据`;
            $('#enrich-progress').style.display = 'none';
            $('#follow-partition-filter').style.display = 'none';
            $('#follow-fans-filter').style.display = 'none';
            $('#follow-sort').style.display = 'none';
            $('#follow-time-filter').style.display = 'none';
            showToast('已退出登录', 'info');
        });

        // 关闭程序
        const shutdownBtn = $('#shutdown-btn');
        if (shutdownBtn) {
            shutdownBtn.addEventListener('click', async () => {
                if (confirm('确定要关闭程序吗？服务将停止。')) {
                    try {
                        // 发送关闭请求（不等待响应，因为服务器可能会立即关闭导致网络错误）
                        fetch('/api/system/shutdown', { method: 'POST' }).catch(() => { });

                        // 显示关闭界面
                        const mask = document.createElement('div');
                        mask.style.position = 'fixed';
                        mask.style.top = '0';
                        mask.style.left = '0';
                        mask.style.width = '100%';
                        mask.style.height = '100%';
                        mask.style.background = 'rgba(12, 12, 29, 0.95)';
                        mask.style.color = '#e8e8ef';
                        mask.style.display = 'flex';
                        mask.style.flexDirection = 'column';
                        mask.style.justifyContent = 'center';
                        mask.style.alignItems = 'center';
                        mask.style.zIndex = '9999';
                        mask.style.fontFamily = 'Inter, sans-serif';
                        mask.innerHTML = `
                            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#FF5252" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 24px;">
                                <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                                <line x1="12" y1="2" x2="12" y2="12"></line>
                            </svg>
                            <h1 style="font-size: 24px; margin-bottom: 8px;">服务已关闭</h1>
                            <p style="color: #8b8ba0;">您可以安全地关闭此窗口了</p>
                        `;
                        document.body.appendChild(mask);

                        // 尝试关闭窗口
                        setTimeout(() => window.close(), 1000);
                    } catch (e) {
                        console.error(e);
                    }
                }
            });
        }


        // 搜索
        $('#follow-search').addEventListener('input', debounce((e) => {
            state.searchQuery = e.target.value.trim();
            if (state.enriched) {
                state.currentPage = 1;
                renderEnrichedFollowList();
            } else {
                renderFollowList();
            }
        }));

        // 基本过滤
        $('#follow-filter').addEventListener('change', (e) => {
            state.filterType = e.target.value;
            state.currentPage = 1;
            if (state.enriched) renderEnrichedFollowList();
            else renderFollowList();
        });

        // 排序
        $('#follow-sort').addEventListener('change', (e) => {
            state.sortType = e.target.value;
            state.currentPage = 1;
            if (state.enriched) renderEnrichedFollowList();
        });

        // 分区过滤
        $('#follow-partition-filter').addEventListener('change', (e) => {
            state.partitionFilter = e.target.value;
            state.currentPage = 1;
            if (state.enriched) renderEnrichedFollowList();
        });

        // 粉丝数过滤
        $('#follow-fans-filter').addEventListener('change', (e) => {
            state.fansFilter = e.target.value;
            state.currentPage = 1;
            if (state.enriched) renderEnrichedFollowList();
        });

        // 更新时间过滤
        $('#follow-time-filter').addEventListener('change', (e) => {
            state.timeFilter = e.target.value;
            state.currentPage = 1;
            if (state.enriched) renderEnrichedFollowList();
        });

        // 加载详细数据
        $('#load-enriched-btn').addEventListener('click', startEnrichment);
        $('#stop-enrich-btn').addEventListener('click', stopEnrichment);

        // 刷新关注列表
        $('#refresh-followings').addEventListener('click', () => {
            state.currentPage = 1;
            // Force re-load behavior
            state.enriched = false;
            state.enrichedFollowings = [];
            loadFollowList();
        });

        // 分析
        $('#load-analysis').addEventListener('click', loadAnalysis);

        // 批量操作
        $('#apply-filter').addEventListener('click', applyBatchFilter);
        $('#select-all-batch').addEventListener('click', selectAllBatch);
        $('#deselect-all-batch').addEventListener('click', deselectAllBatch);
        $('#batch-unfollow-btn').addEventListener('click', executeBatchUnfollow);
        if ($('#batch-refresh-btn')) {
            $('#batch-refresh-btn').addEventListener('click', executeBatchRefresh);
        }
        if ($('#stop-batch-btn')) {
            $('#stop-batch-btn').addEventListener('click', stopEnrichment);
        }

        // ==================== 关注列表批量操作 ====================
        const followSelectAll = $('#follow-select-all');
        if (followSelectAll) {
            followSelectAll.addEventListener('change', (e) => {
                const checked = e.target.checked;
                let targetList = [];
                if (state.enriched) {
                    targetList = getFilteredEnrichedList();
                } else {
                    let list = state.followings;
                    if (state.searchQuery) {
                        const q = state.searchQuery.toLowerCase();
                        list = list.filter(f => f.uname?.toLowerCase().includes(q) || f.sign?.toLowerCase().includes(q));
                    }
                    list = filterFollowings(list, state.filterType);
                    targetList = list;
                }

                targetList.forEach(f => {
                    if (checked) state.selectedMids.add(f.mid);
                    else state.selectedMids.delete(f.mid);
                });

                document.querySelectorAll('.follow-item-checkbox').forEach(cb => {
                    // Update only visible checkboxes
                    cb.checked = checked;
                });
                updateSelectionUI();
            });
        }

        const followBatchUnfollow = $('#follow-batch-unfollow');
        if (followBatchUnfollow) {
            followBatchUnfollow.addEventListener('click', async () => {
                const mids = Array.from(state.selectedMids);
                if (mids.length === 0) return;

                if (!confirm(`确定要批量取消关注选中的 ${mids.length} 个UP主吗？`)) return;

                try {
                    followBatchUnfollow.disabled = true;
                    followBatchUnfollow.textContent = '正在处理...';

                    const resp = await api.batchUnfollow(mids);

                    showToast(`批量取关操作已提交`, 'success');
                    state.selectedMids.clear();

                    // Reload
                    if (state.enriched) {
                        state.enrichedFollowings = state.enrichedFollowings.filter(f => !mids.includes(f.mid));
                        state.allFollowings = state.allFollowings.filter(f => !mids.includes(f.mid));
                        renderEnrichedFollowList();
                    } else {
                        loadFollowList();
                    }
                } catch (e) {
                    showToast(`操作失败: ${e.message}`, 'error');
                    loadFollowList();
                } finally {
                    updateSelectionUI();
                }
            });
        }

        const followBatchRefresh = $('#follow-batch-refresh');
        if (followBatchRefresh) {
            followBatchRefresh.addEventListener('click', async () => {
                const mids = Array.from(state.selectedMids);
                if (mids.length === 0) return;

                try {
                    followBatchRefresh.disabled = true;
                    followBatchRefresh.textContent = '正在启动...';

                    await api.batchRefreshEnrichment(mids);
                    showToast(`批量刷新已启动`, 'success');

                    // 显示进度 UI
                    const progressBar = $('#batch-progress');
                    if (progressBar) {
                        progressBar.style.display = 'block';
                        progressBar.querySelector('h3').textContent = '正在刷新选中数据...';
                        $('#progress-text').textContent = `0 / ${mids.length}`;
                        $('#progress-bar').style.width = '0%';
                        $('#progress-log').innerHTML = '';
                    }

                    state.enriching = true;
                    pollEnrichmentStatus();
                } catch (e) {
                    showToast(`刷新失败: ${e.message}`, 'error');
                } finally {
                    updateSelectionUI();
                }
            });
        }
    }

    // ==================== 初始化 ====================
    function init() {
        if (!state.selectedMids) state.selectedMids = new Set();
        initLogin();
        initEventListeners();

        // 添加 fadeOut 动画样式
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeOut {
                from { opacity: 1; transform: translateX(0); }
                to { opacity: 0; transform: translateX(-20px); height: 0; padding: 0; margin: 0; overflow: hidden; }
            }
        `;
        document.head.appendChild(style);
    }

    // DOM Ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
