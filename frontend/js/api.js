/**
 * B站关注管理工具 - API 客户端
 */
class BiliAPI {
    constructor(baseURL = '') {
        this.baseURL = baseURL;
    }

    async _request(method, path, body = null) {
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (body) {
            options.body = JSON.stringify(body);
        }

        const resp = await fetch(`${this.baseURL}${path}`, options);
        const data = await resp.json();

        if (!resp.ok) {
            throw new Error(data.detail || `请求失败 (${resp.status})`);
        }
        if (data.code !== 0 && data.code !== undefined) {
            throw new Error(data.message || '接口返回错误');
        }
        return data;
    }

    // ===== 登录/登出 =====
    async login(sessdata, bili_jct) {
        return this._request('POST', '/api/login', { sessdata, bili_jct });
    }

    async logout() {
        return this._request('POST', '/api/logout');
    }

    // ===== 用户信息 =====
    async getUserInfo() {
        return this._request('GET', '/api/user/info');
    }

    // ===== 关注列表 =====
    async getFollowings(pn = 1, ps = 50, orderType = '') {
        const params = new URLSearchParams({ pn, ps, order_type: orderType });
        return this._request('GET', `/api/followings?${params}`);
    }

    async getAllFollowings(useCache = true) {
        const params = new URLSearchParams({ use_cache: useCache });
        return this._request('GET', `/api/followings/all?${params}`);
    }

    // ===== 分组 =====
    async getFollowTags() {
        return this._request('GET', '/api/followings/tags');
    }

    // ===== 分析 =====
    async analyzeFollowings() {
        return this._request('GET', '/api/followings/analyze');
    }

    // ===== 取关 =====
    async unfollow(fid) {
        return this._request('POST', '/api/unfollow', { fid });
    }

    async batchUnfollow(fids) {
        return this._request('POST', '/api/unfollow/batch', { fids });
    }

    // ===== 用户名片 =====
    async getUserCard(mid) {
        return this._request('GET', `/api/user/card/${mid}`);
    }

    // ===== 数据增强 =====
    async startEnrichment() {
        return this._request('POST', '/api/followings/enrich');
    }

    async getEnrichmentStatus() {
        return this._request('GET', '/api/followings/enrich/status');
    }

    async getEnrichedFollowings() {
        return this._request('GET', '/api/followings/enriched');
    }

    async stopEnrichment() {
        return this._request('POST', '/api/followings/enrich/stop');
    }
}

// 全局实例
const api = new BiliAPI();
